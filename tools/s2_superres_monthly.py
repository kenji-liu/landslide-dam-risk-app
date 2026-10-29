#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentinel-2 逐月超解析（視覺輔助圖層）：10 m -> 2.5 m
======================================================
為「堰塞湖緊急調查與風險評估平台」的空間研判頁產製 `tc_sr` 疊合圖層。

流程
  1. 由 regions_wgs84.geojson 的崩積區＋壩區水域＋殘壩區自動決定壩區 AOI，
     取成「正方形、邊長為 128 像素倍數」的 UTM 51N（EPSG:32651）10 m 網格。
     （sen2sr.predict_large 以 X.shape[1] 配置輸出陣列，輸入必須是正方形。）
  2. 以 PySTAC 查 Microsoft Planetary Computer 的 Sentinel-2 L2A（同月、同圖幅 51QUG），
     讀 B04/B03/B02/B08（模型輸入）＋ B11/SCL（去雲用）。
  3. 去雲規則沿用平台月監測：SCL 遮除雲、雲影、卷雲，另以光譜檢核補判，遮罩外擴 20 m。
     同月 ≥3 景時再做多景檢核（temporal_refine）：還原被誤判為雲的亮白崩積土石（藍光與近紅外皆亮者仍判為雲）。
  4. 單景最佳（best，預設）或月中位數合成（composite）。
  5. 雲遮像元先以鄰近有效值填補再進模型（避免遮罩邊界出現 0 值振鈴），輸出後以遮罩還原為透明。
  6. SEN2SRLite NonReference_RGBN_x4 推論（輸入波段順序 B04, B03, B02, B08）。
  7. 輸出 RGBA WebP（透明＝雲遮，不做超解析）到 docs/assets/sentinel2/sr/，
     並更新 sidecar 索引 sr_index.json（不改動月監測產製的 sentinel2_monthly.json，
     避免月產製程式重寫該檔時把超解析欄位洗掉）。

安裝
  pip install numpy pillow pyproj pystac-client planetary-computer odc-stac rasterio
  pip install torch mlstac sen2sr          # 僅 --model sen2sr 需要

用法
  python tools/s2_superres_monthly.py --months 2025-10 2025-11
  python tools/s2_superres_monthly.py --from 2025-06            # 到 sentinel2_monthly.json 的最新可用月
  python tools/s2_superres_monthly.py --months 2026-09 --mode composite --qa
  python tools/s2_superres_monthly.py --months 2026-09 --model bicubic   # 不用 AI 的對照組

重要限制（也會寫入 sr_index.json 並顯示在網站）
  - 超解析是模型「推估」的紋理，不是量測。不可用於 AL/VL/VD 圈繪、面積、沖淤量、NDVI/NDWI、
    新生水域或新生崩塌偵測；這些仍以原始 10 m 與 UAV 為準。
  - 模型權重來自 ESA OpenSR（SEN2SR），非針對台灣山區訓練，崩塌裸岩、礫石河道、陰影處
    可能出現不存在的邊界或紋理，上線前請以 UAV 正射影像比對。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
from PIL import Image

# ----------------------------------------------------------------------------
# 路徑與常數
# ----------------------------------------------------------------------------
REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "docs"
REGIONS_GEOJSON = DOCS / "assets/sentinel2/regions_wgs84.geojson"
MONTHLY_JSON = DOCS / "assets/sentinel2/sentinel2_monthly.json"
OUT_DIR = DOCS / "assets/sentinel2/sr"
INDEX_JSON = OUT_DIR / "sr_index.json"
MODEL_DIR = REPO / "tools/_models"
QA_DIR = REPO / "tools/_sr_qa"

UTM_CRS = "EPSG:32651"          # 馬太鞍溪位於 UTM 51N，圖幅 51QUG
PIXEL_M = 10.0
SCALE = 4                       # SEN2SRLite RGBN x4
PATCH = 128                     # 模型固定 128x128 patch
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION = "sentinel-2-l2a"
SEN2SR_PACKAGE = "sen2sr 0.8.5"
MODEL_VARIANT = "NonReference_RGBN_x4"
MODEL_URL = ("https://huggingface.co/tacofoundation/sen2sr/resolve/main/"
             f"SEN2SRLite/{MODEL_VARIANT}/mlm.json")

# 模型輸入波段順序（官方 README：B04, B03, B02, B08 = R, G, B, NIR）
MODEL_BANDS = ["B04", "B03", "B02", "B08"]
AUX_BANDS = ["B11", "SCL"]
SCL_INVALID = (0, 1, 3, 8, 9, 10)   # 無資料、飽和、雲影、雲（中/高）、卷雲
CLOUD_BUFFER_PX = 2                 # 外擴 20 m

SR_NOTE = ("AI 推估紋理，僅供目視參考，不可用於量測或圈繪；"
           "透明處為雲遮，未做超解析。判釋與計算請以原始 10 m 與 UAV 為準。")


# ----------------------------------------------------------------------------
# 幾何：AOI、UTM 網格、角點
# ----------------------------------------------------------------------------
def _iter_xy(coords):
    if isinstance(coords, (list, tuple)):
        if coords and isinstance(coords[0], (int, float)):
            yield coords[0], coords[1]
        else:
            for c in coords:
                yield from _iter_xy(c)


def compute_aoi(regions_path: Path, ids, margin_m: float, size_px: int | None):
    """回傳 dict(x0, y0, x1, y1, size_px, bbox_ll)，單位為 UTM 公尺，格點對齊 10 m。"""
    from pyproj import Transformer

    to_utm = Transformer.from_crs("EPSG:4326", UTM_CRS, always_xy=True)
    data = json.loads(regions_path.read_text(encoding="utf-8"))
    xs, ys = [], []
    found = set()
    for feat in data["features"]:
        if feat["properties"].get("id") in ids:
            found.add(feat["properties"]["id"])
            for lon, lat in _iter_xy(feat["geometry"]["coordinates"]):
                x, y = to_utm.transform(lon, lat)
                xs.append(x)
                ys.append(y)
    missing = set(ids) - found
    if missing:
        raise SystemExit(f"regions_wgs84.geojson 找不到區域 id：{sorted(missing)}")
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    need_px = (max(w, h) + 2 * margin_m) / PIXEL_M
    if size_px is None:
        size_px = int(math.ceil(need_px / PATCH) * PATCH)
    half = size_px * PIXEL_M / 2
    x0 = math.floor((cx - half) / PIXEL_M) * PIXEL_M
    y0 = math.floor((cy - half) / PIXEL_M) * PIXEL_M
    x1 = x0 + size_px * PIXEL_M
    y1 = y0 + size_px * PIXEL_M
    to_ll = Transformer.from_crs(UTM_CRS, "EPSG:4326", always_xy=True)
    lons, lats = zip(*[to_ll.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))])
    return {
        "x0": x0, "y0": y0, "x1": x1, "y1": y1, "size_px": size_px,
        "need_px": need_px, "polygon_wh_m": (w, h),
        "bbox_ll": [min(lons), min(lats), max(lons), max(lats)],
    }


def corners_latlng(aoi):
    """左上、右上、左下角的 [lat, lng]，格式同 sentinel2_monthly.json 的 view.corners_ll。"""
    from pyproj import Transformer

    to_ll = Transformer.from_crs(UTM_CRS, "EPSG:4326", always_xy=True)
    out = []
    for x, y in ((aoi["x0"], aoi["y1"]), (aoi["x1"], aoi["y1"]), (aoi["x0"], aoi["y0"])):
        lon, lat = to_ll.transform(x, y)
        out.append([round(lat, 6), round(lon, 6)])
    return out


# ----------------------------------------------------------------------------
# 影像處理（純 numpy，不需網路，可單元測試）
# ----------------------------------------------------------------------------
def dilate(mask: np.ndarray, px: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(px):
        p = np.pad(out, 1)
        out = (p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
               | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:])
    return out


def invalid_mask(scl: np.ndarray, b02: np.ndarray, b08: np.ndarray, b11: np.ndarray,
                 nodata: np.ndarray) -> np.ndarray:
    """True＝不可用（雲、雲影、卷雲、無資料）。反射率輸入須為 0~1 尺度。"""
    bad = np.isin(scl, SCL_INVALID) | nodata
    # 光譜檢核補判 SCL 漏判的雲（與平台月監測相同門檻）
    spectral = ((b02 > 0.2) & (b11 < 0.9 * b02) & (b08 > 0.25)) | (b02 > 0.5)
    bad |= spectral
    return dilate(bad, CLOUD_BUFFER_PX)


def fill_invalid(arr: np.ndarray, invalid: np.ndarray, max_iter: int = 400) -> np.ndarray:
    """以鄰近有效像元平均逐圈向內填補，避免 0 值進入模型。arr: (C,H,W)。"""
    out = np.where(invalid[None], 0.0, arr).astype(np.float32)
    known = ~invalid
    if not known.any():
        return out
    for _ in range(max_iter):
        if known.all():
            break
        pk = np.pad(known.astype(np.float32), 1)
        po = np.pad(out * known[None], ((0, 0), (1, 1), (1, 1)))
        cnt = np.zeros(known.shape, np.float32)
        acc = np.zeros(out.shape, np.float32)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                if dy == 1 and dx == 1:
                    continue
                cnt += pk[dy:dy + known.shape[0], dx:dx + known.shape[1]]
                acc += po[:, dy:dy + known.shape[0], dx:dx + known.shape[1]]
        newly = (~known) & (cnt > 0)
        if not newly.any():
            break
        out[:, newly] = acc[:, newly] / cnt[newly]
        known = known | newly
    if not known.all():
        for b in range(out.shape[0]):
            out[b][~known] = np.median(out[b][known])
    return out


def dn_to_reflectance(dn: np.ndarray, baseline: float) -> np.ndarray:
    """L2A DN -> 反射率。處理基線 >= 04.00（2022-01-25 起）有 +1000 偏移需扣除。"""
    offset = 1000.0 if baseline >= 4.0 else 0.0
    return np.clip((dn.astype(np.float32) - offset) / 10000.0, 0.0, 1.5)


def upsample_bicubic(arr: np.ndarray, scale: int) -> np.ndarray:
    """對照組：雙三次內插。arr: (C,H,W) float32。"""
    c, h, w = arr.shape
    out = np.empty((c, h * scale, w * scale), np.float32)
    for i in range(c):
        im = Image.fromarray(arr[i].astype(np.float32), mode="F")
        out[i] = np.asarray(im.resize((w * scale, h * scale), Image.BICUBIC), dtype=np.float32)
    return out


def to_rgba(sr: np.ndarray, invalid10: np.ndarray, max_refl: float, gamma: float) -> np.ndarray:
    """sr: (4,H*4,W*4) 反射率，通道順序 R,G,B,NIR。回傳 uint8 RGBA，雲遮處 alpha=0。"""
    rgb = np.clip(sr[:3] / max_refl, 0.0, 1.0) ** gamma
    rgb = np.transpose((rgb * 255.0 + 0.5).astype(np.uint8), (1, 2, 0))
    inv_hr = np.kron(invalid10.astype(np.uint8), np.ones((SCALE, SCALE), np.uint8)).astype(bool)
    alpha = np.where(inv_hr, 0, 255).astype(np.uint8)
    return np.dstack([rgb, alpha])


# ----------------------------------------------------------------------------
# 資料取得（需網路：Planetary Computer）
# ----------------------------------------------------------------------------
def month_range(month: str):
    y, m = map(int, month.split("-"))
    start = dt.date(y, m, 1)
    end = dt.date(y + (m == 12), (m % 12) + 1, 1)
    return start, end


def search_items(aoi, month: str, tile: str | None, max_cloud: float):
    import planetary_computer
    import pystac_client

    client = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    start, end = month_range(month)
    search = client.search(
        collections=[COLLECTION],
        bbox=aoi["bbox_ll"],
        datetime=f"{start.isoformat()}/{(end - dt.timedelta(days=1)).isoformat()}",
        query={"eo:cloud_cover": {"lt": max_cloud}},
    )
    items = list(search.item_collection())
    if tile:
        items = [i for i in items if i.properties.get("s2:mgrs_tile") == tile]
    return sorted(items, key=lambda i: i.datetime)


def load_scene(item, aoi):
    """讀單景 AOI，回傳 dict(refl=(4,H,W) 反射率, invalid=(H,W) bool, date, baseline)。"""
    import odc.stac
    from odc.geo.geobox import GeoBox

    gbox = GeoBox.from_bbox((aoi["x0"], aoi["y0"], aoi["x1"], aoi["y1"]),
                            crs=UTM_CRS, resolution=PIXEL_M)
    ds = odc.stac.load([item], bands=MODEL_BANDS + AUX_BANDS, geobox=gbox)
    n = aoi["size_px"]
    dn = {b: np.asarray(ds[b].isel(time=0).values) for b in MODEL_BANDS + AUX_BANDS}
    for b, v in dn.items():
        if v.shape != (n, n):
            raise RuntimeError(f"{item.id} 波段 {b} 尺寸 {v.shape} != {(n, n)}，網格未對齊")
    nodata = np.zeros((n, n), bool)
    for b in MODEL_BANDS:
        v = dn[b].astype(np.float64)
        nodata |= (v == 0) | ~np.isfinite(v)
    baseline = float(item.properties.get("s2:processing_baseline", "0") or 0)
    refl = np.stack([dn_to_reflectance(np.nan_to_num(dn[b], nan=0), baseline) for b in MODEL_BANDS])
    b11 = dn_to_reflectance(np.nan_to_num(dn["B11"], nan=0), baseline)
    scl = np.nan_to_num(dn["SCL"], nan=0).astype(np.uint8)
    inv = invalid_mask(scl, refl[2], refl[3], b11, nodata)
    b02 = refl[2]
    cloudlike = np.isin(scl, (8, 9, 10)) | ((b02 > 0.2) & (b11 < 0.9 * b02) & (refl[3] > 0.25)) | (b02 > 0.5)
    hard = nodata | np.isin(scl, (0, 1, 3))
    return {"refl": refl, "invalid": inv, "date": item.datetime.date().isoformat(),
            "baseline": baseline, "id": item.id, "cloudlike": cloudlike, "hard": hard}


TEMPORAL_MIN_SCENES = 3      # 同月至少 3 景才做多景檢核
TEMPORAL_CLEAR_DB02 = 0.04   # 被判為雲、但藍光不比當月中位數亮超過此值 → 視為亮白裸露地（崩積土石），還原
BRIGHT_CLOUD_B02 = 0.30      # 藍光與近紅外都亮 → 雲（崩積土石近紅外約 0.1–0.3，雲 > 0.4），不受多景還原影響
BRIGHT_CLOUD_B08 = 0.40


def temporal_refine(scenes):
    """同月多景檢核：只用來還原被誤判為雲的亮白崩積土石，不新增遮罩。

    壩區崩積土石亮白，常被 SCL 判為中度雲（8）或光譜補判誤抓。雲會移動、地面不會，
    所以被判為雲、但藍光（B02）與當月各景逐像元中位數差不多的像元，視為地面還原。
    藍光與近紅外同時很亮的像元（BRIGHT_CLOUD_*）一律維持為雲。
    薄霧亮度增加通常 < 0.04，無法可靠分辨，未處理。
    不足 TEMPORAL_MIN_SCENES 景時維持原遮罩。回傳還原像元比例（各景平均）。
    """
    if len(scenes) < TEMPORAL_MIN_SCENES or any("cloudlike" not in s for s in scenes):
        return None
    stack = np.stack([np.where(s["hard"], np.nan, s["refl"][2]) for s in scenes])
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        ground = np.nanmedian(stack, axis=0)
    ok = np.isfinite(ground)
    cleared = 0.0
    for s in scenes:
        b02, b08 = s["refl"][2], s["refl"][3]
        bright = (b02 > BRIGHT_CLOUD_B02) & (b08 > BRIGHT_CLOUD_B08)
        restore = s["cloudlike"] & ok & (b02 - np.where(ok, ground, 0) <= TEMPORAL_CLEAR_DB02) & ~bright
        new = dilate(s["hard"] | (s["cloudlike"] & ~restore) | bright, CLOUD_BUFFER_PX)
        cleared += float((s["invalid"] & ~new).mean())
        s["invalid"] = new
    return cleared / len(scenes)


def pick_scene(scenes, mode: str, min_valid: float):
    """依模式回傳 (refl, invalid, meta) 或 None（有效面積不足）。"""
    if not scenes:
        return None
    if mode == "best":
        best = max(scenes, key=lambda s: 1 - s["invalid"].mean())
        valid = 1 - best["invalid"].mean()
        if valid < min_valid:
            return None
        return best["refl"], best["invalid"], {
            "mode": "best", "scenes": [best["date"]], "valid_pct": round(valid * 100, 1)}
    stack = np.stack([np.where(s["invalid"][None], np.nan, s["refl"]) for s in scenes])
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)       # 全月皆雲遮的像元會出現 All-NaN slice
        med = np.nanmedian(stack, axis=0).astype(np.float32)
    inv = np.isnan(med).any(axis=0)
    valid = 1 - inv.mean()
    if valid < min_valid:
        return None
    return np.nan_to_num(med, nan=0.0), inv, {
        "mode": "composite", "scenes": [s["date"] for s in scenes], "valid_pct": round(valid * 100, 1)}


# ----------------------------------------------------------------------------
# 模型
# ----------------------------------------------------------------------------
class Sen2SRModel:
    def __init__(self, device: str = "auto"):
        import mlstac
        import torch

        self.torch = torch
        self.device = torch.device(
            ("cuda" if torch.cuda.is_available() else "cpu") if device == "auto" else device)
        target = MODEL_DIR / f"SEN2SRLite_{MODEL_VARIANT}"
        if not (target / "mlm.json").exists():
            mlstac.download(file=MODEL_URL, output_dir=str(target))
        self.model = mlstac.load(str(target)).compiled_model(device=self.device)

    def __call__(self, x: np.ndarray, overlap: int = 32) -> np.ndarray:
        import sen2sr

        torch = self.torch
        X = torch.from_numpy(x).float().to(self.device)
        X = torch.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        with torch.no_grad():
            y = sen2sr.predict_large(model=self.model, X=X, overlap=overlap)
        return np.clip(y.detach().cpu().numpy(), 0.0, 1.5).astype(np.float32)


def run_model(kind: str, x: np.ndarray, holder: dict, device: str) -> np.ndarray:
    if kind == "bicubic":
        return upsample_bicubic(x, SCALE)
    if "m" not in holder:
        holder["m"] = Sen2SRModel(device)
    return holder["m"](x)


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def save_webp(rgba: np.ndarray, path: Path, quality: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path, "WEBP", quality=quality, method=6, exact=True)
    return path.stat().st_size


def save_qa(refl, invalid10, sr, path: Path, max_refl: float, gamma: float):
    """左：原始 10 m（最近鄰放大）；右：超解析。雲遮處顯示為灰。僅供內部比對，不發布。"""
    left = to_rgba(np.repeat(np.repeat(refl, SCALE, axis=1), SCALE, axis=2), invalid10, max_refl, gamma)
    right = to_rgba(sr, invalid10, max_refl, gamma)
    bg = np.full(left.shape[:2] + (3,), 128, np.uint8)

    def comp(a):
        al = a[..., 3:4] / 255.0
        return (a[..., :3] * al + bg * (1 - al)).astype(np.uint8)

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.hstack([comp(left), comp(right)])).save(path, "PNG", optimize=True)


def load_index():
    if INDEX_JSON.exists():
        return json.loads(INDEX_JSON.read_text(encoding="utf-8"))
    return {"schema_version": 1, "months": {}}


def write_index(idx, aoi, model_kind):
    idx.update({
        "schema_version": 1,
        "updated_at": dt.date.today().isoformat(),
        "title": "Sentinel-2 超解析 2.5 m（視覺輔助）",
        "model": ("SEN2SRLite " + MODEL_VARIANT) if model_kind == "sen2sr" else "bicubic（對照組，非 AI）",
        "package": SEN2SR_PACKAGE,
        "resolution_m": PIXEL_M / SCALE,
        "crs": UTM_CRS,
        "size_px": aoi["size_px"] * SCALE,
        "bounds_lonlat": [round(v, 6) for v in aoi["bbox_ll"]],
        "corners_ll": corners_latlng(aoi),   # 左上、右上、左下 [lat, lng]；UTM 網格
        "note": SR_NOTE,
    })
    idx["months"] = dict(sorted(idx["months"].items()))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_JSON.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def months_to_run(args):
    if args.months:
        return args.months
    last = None
    if MONTHLY_JSON.exists():
        last = json.loads(MONTHLY_JSON.read_text(encoding="utf-8")).get("latest_usable_month")
    last = last or dt.date.today().strftime("%Y-%m")
    y, m = map(int, args.from_month.split("-"))
    ly, lm = map(int, last.split("-"))
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        y, m = y + (m == 12), (m % 12) + 1
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--months", nargs="+", metavar="YYYY-MM", help="指定月份")
    ap.add_argument("--from", dest="from_month", default="2025-06", metavar="YYYY-MM",
                    help="未指定 --months 時，從此月跑到最新可用月（預設 2025-06，事件期間）")
    ap.add_argument("--mode", choices=["best", "composite"], default="best",
                    help="best＝單景最佳（模型以單景訓練，建議）；composite＝月中位數合成")
    ap.add_argument("--min-valid", type=float, default=0.60, help="AOI 有效像元比例下限，不足則略過該月")
    ap.add_argument("--model", choices=["sen2sr", "bicubic"], default="sen2sr")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--tile", default="51QUG", help="限定 MGRS 圖幅；空字串＝不限")
    ap.add_argument("--max-cloud", type=float, default=90.0, help="STAC 查詢的整景雲量上限（%）")
    ap.add_argument("--aoi-ids", nargs="+", default=["debris", "dam_water_zone", "residual"])
    ap.add_argument("--margin", type=float, default=50.0, help="AOI 外擴公尺")
    ap.add_argument("--size-px", type=int, default=None, help="強制 AOI 邊長像素（需為 128 倍數）")
    ap.add_argument("--max-refl", type=float, default=0.30, help="真色顯示拉伸：此反射率對應 255")
    ap.add_argument("--gamma", type=float, default=0.8)
    ap.add_argument("--quality", type=int, default=82, help="WebP 品質")
    ap.add_argument("--qa", action="store_true", help="另存 原始/超解析 並排 PNG 到 tools/_sr_qa/（不發布）")
    ap.add_argument("--force", action="store_true", help="已存在的月份也重做")
    ap.add_argument("--dry-aoi", action="store_true", help="只計算並顯示 AOI 與角點，不下載")
    args = ap.parse_args(argv)

    if args.size_px is not None and args.size_px % PATCH:
        raise SystemExit(f"--size-px 必須是 {PATCH} 的倍數")
    aoi = compute_aoi(REGIONS_GEOJSON, args.aoi_ids, args.margin, args.size_px)
    side = aoi["size_px"] * PIXEL_M / 1000
    print(f"AOI：{aoi['size_px']}x{aoi['size_px']} px（{side:.2f} km 見方），"
          f"輸出 {aoi['size_px'] * SCALE}x{aoi['size_px'] * SCALE} px @ {PIXEL_M / SCALE} m；"
          f"區域外框 {aoi['polygon_wh_m'][0] / 1000:.2f}x{aoi['polygon_wh_m'][1] / 1000:.2f} km，"
          f"需求 {aoi['need_px']:.0f} px")
    print("角點（左上、右上、左下 lat,lng）：", corners_latlng(aoi))
    if args.dry_aoi:
        return 0

    idx = load_index()
    holder: dict = {}
    todo = months_to_run(args)
    print(f"待處理 {len(todo)} 個月：{todo[0]} … {todo[-1]}" if todo else "沒有待處理月份")
    done = skipped = 0
    for month in todo:
        out_png = OUT_DIR / f"{month}_tc_sr.webp"
        if out_png.exists() and month in idx["months"] and not args.force:
            print(f"[{month}] 已存在，略過（--force 可重做）")
            continue
        items = search_items(aoi, month, args.tile or None, args.max_cloud)
        if not items:
            print(f"[{month}] 查無影像，略過")
            skipped += 1
            continue
        scenes = [load_scene(i, aoi) for i in items]
        tr = temporal_refine(scenes)
        if tr:
            print(f"[{month}] 同月 {len(scenes)} 景檢核：還原被誤判為雲的亮白裸露地 {tr * 100:.1f}%（各景平均）")
        picked = pick_scene(scenes, args.mode, args.min_valid)
        if picked is None:
            best = max(1 - s["invalid"].mean() for s in scenes)
            print(f"[{month}] 有效面積不足（最佳 {best * 100:.0f}% < {args.min_valid * 100:.0f}%），略過")
            idx["months"].pop(month, None)
            skipped += 1
            continue
        refl, inv, meta = picked
        x = fill_invalid(refl, inv)
        sr = run_model(args.model, x, holder, args.device)
        rgba = to_rgba(sr, inv, args.max_refl, args.gamma)
        size = save_webp(rgba, out_png, args.quality)
        if args.qa:
            save_qa(refl, inv, sr, QA_DIR / f"{month}_compare.png", args.max_refl, args.gamma)
        meta.update({"url": f"./assets/sentinel2/sr/{month}_tc_sr.webp", "size_kb": round(size / 1024)})
        idx["months"][month] = meta
        write_index(idx, aoi, args.model)     # 每月寫一次，中途中斷也不會丟進度
        print(f"[{month}] {meta['mode']} {meta['scenes']} 有效 {meta['valid_pct']}% → {size / 1024:.0f} KB")
        if size > 1_500_000:
            print(f"  ⚠ 檔案偏大（{size / 1e6:.1f} MB），可降低 --quality")
        done += 1
    if todo:
        write_index(idx, aoi, args.model)
    try:
        shown = INDEX_JSON.relative_to(REPO)
    except ValueError:
        shown = INDEX_JSON
    print(f"完成 {done} 個月，略過 {skipped} 個月。索引：{shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
