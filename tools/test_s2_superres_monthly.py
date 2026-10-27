#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
s2_superres_monthly.py 的離線測試（不需網路、不需 torch / 模型權重）。
  python tools/test_s2_superres_monthly.py
以合成影像驗證：反射率換算、去雲遮罩、填補、單景/合成挑選、遮罩與高解析對齊、
WebP 輸出、sidecar 索引、重跑略過、雲量不足略過。
不驗證：Planetary Computer 查詢/讀取（search_items、load_scene）與 SEN2SR 模型推論。
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("s2sr", HERE / "s2_superres_monthly.py")
s2sr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s2sr)

rng = np.random.default_rng(7)
N = 512


def synthetic_scene(date, cloud_frac, seed=0):
    """合成地表：森林綠＋一塊亮裸地；左側 cloud_frac 寬度為雲（SCL=9，反射率高）。"""
    r = np.random.default_rng(seed)
    refl = np.empty((4, N, N), np.float32)           # R,G,B,NIR
    base = r.normal(0, 0.004, (N, N)).astype(np.float32)
    refl[0] = 0.03 + base
    refl[1] = 0.06 + base
    refl[2] = 0.03 + base
    refl[3] = 0.35 + base
    refl[:, 200:300, 100:240] = np.array([0.25, 0.24, 0.22, 0.28], np.float32)[:, None, None]  # 裸地
    scl = np.full((N, N), 4, np.uint8)
    w = int(N * cloud_frac)
    if w:
        refl[:, :, :w] = 0.6
        scl[:, :w] = 9
    b11 = np.full((N, N), 0.15, np.float32)
    b11[200:300, 100:240] = 0.35          # 裸岩的短波紅外高於藍光，不應被光譜補判誤當雲
    nodata = np.zeros((N, N), bool)
    inv = s2sr.invalid_mask(scl, refl[2], refl[3], b11, nodata)
    return {"refl": refl, "invalid": inv, "date": date, "baseline": 5.11, "id": f"S2_{date}"}


def test_reflectance_offset():
    dn = np.array([1000, 1500, 11000], np.uint16)
    assert np.allclose(s2sr.dn_to_reflectance(dn, 5.11), [0.0, 0.05, 1.0])      # 基線 >= 4：扣 1000
    assert np.allclose(s2sr.dn_to_reflectance(dn, 3.0), [0.1, 0.15, 1.1])       # 舊基線不扣


def test_invalid_mask_and_dilation():
    scl = np.full((64, 64), 4, np.uint8)
    scl[30, 30] = 9
    z = np.full((64, 64), 0.05, np.float32)
    m = s2sr.invalid_mask(scl, z, z + 0.3, z, np.zeros((64, 64), bool))
    assert m[30, 30] and m[28, 28] and m[32, 32] and not m[27, 27] and not m[33, 33]   # 外擴 2 px = 20 m
    assert m.sum() == 25
    # 光譜補判：SCL 判為有效但藍光極亮
    bright = np.full((64, 64), 0.05, np.float32)
    bright[10, 10] = 0.6
    m2 = s2sr.invalid_mask(np.full((64, 64), 4, np.uint8), bright, z + 0.3, z, np.zeros((64, 64), bool))
    assert m2[10, 10]


def test_fill_invalid():
    arr = np.full((4, 128, 128), 0.2, np.float32)
    arr[:, 40:90, 40:90] = 0.0
    inv = np.zeros((128, 128), bool)
    inv[40:90, 40:90] = True
    out = s2sr.fill_invalid(arr, inv)
    assert np.allclose(out, 0.2, atol=1e-5), "大洞應被鄰近值填成 0.2，不可殘留 0"
    out_all = s2sr.fill_invalid(arr, np.ones((128, 128), bool))     # 全部無效不應當掉
    assert np.isfinite(out_all).all()


def test_pick_scene():
    clear = synthetic_scene("2025-10-05", 0.10, 1)
    cloudy = synthetic_scene("2025-10-15", 0.70, 2)
    refl, inv, meta = s2sr.pick_scene([cloudy, clear], "best", 0.6)
    assert meta["scenes"] == ["2025-10-05"] and meta["valid_pct"] > 80
    assert s2sr.pick_scene([cloudy], "best", 0.6) is None                # 有效面積不足 → 略過
    refl, inv, meta = s2sr.pick_scene([cloudy, clear], "composite", 0.6)
    # 兩景左側都有雲（clear 景約 10%），聯集無效約 10.5% → 有效約 89.5%，仍高於單景 best 的 83.9%
    assert meta["mode"] == "composite" and len(meta["scenes"]) == 2 and 85 < meta["valid_pct"] < 95


def test_mask_alignment_in_rgba():
    refl = synthetic_scene("2025-10-05", 0.0)["refl"]
    inv = np.zeros((N, N), bool)
    inv[100, 50] = True
    sr = s2sr.upsample_bicubic(refl, s2sr.SCALE)
    assert sr.shape == (4, N * 4, N * 4)
    rgba = s2sr.to_rgba(sr, inv, 0.30, 0.8)
    assert rgba.shape == (N * 4, N * 4, 4) and rgba.dtype == np.uint8
    assert (rgba[400:404, 200:204, 3] == 0).all()                        # 10 m 的 (100,50) → 2.5 m 的 4x4 區塊
    assert rgba[399, 200, 3] == 255 and rgba[404, 200, 3] == 255 and rgba[400, 199, 3] == 255 and rgba[400, 204, 3] == 255
    assert rgba[..., 3].sum() == (rgba.shape[0] * rgba.shape[1] - 16) * 255


def test_month_loop_end_to_end():
    """以假的 search_items / load_scene 與 bicubic 模型跑完整月迴圈。"""
    scenes_by_month = {
        "2025-10": [synthetic_scene("2025-10-05", 0.10, 1), synthetic_scene("2025-10-20", 0.50, 2)],
        "2025-11": [synthetic_scene("2025-11-09", 0.80, 3)],          # 雲太多
        "2025-12": [],                                                # 查無影像
    }
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        s2sr.OUT_DIR = td / "sr"
        s2sr.INDEX_JSON = s2sr.OUT_DIR / "sr_index.json"
        s2sr.QA_DIR = td / "qa"
        calls = {"n": 0}

        class Fake:  # 讓 search_items 回傳「項目」＝月份字串，load_scene 再查表
            pass

        s2sr.search_items = lambda aoi, month, tile, mc: [f"{month}#{i}" for i in range(len(scenes_by_month[month]))]
        s2sr.load_scene = lambda item, aoi: (calls.__setitem__("n", calls["n"] + 1)
                                              or scenes_by_month[item.split("#")[0]][int(item.split("#")[1])])
        rc = s2sr.main(["--months", "2025-10", "2025-11", "2025-12", "--model", "bicubic", "--qa"])
        assert rc == 0
        idx = json.loads(s2sr.INDEX_JSON.read_text(encoding="utf-8"))
        assert list(idx["months"]) == ["2025-10"], idx["months"].keys()
        e = idx["months"]["2025-10"]
        assert e["mode"] == "best" and e["scenes"] == ["2025-10-05"] and e["url"].endswith("2025-10_tc_sr.webp")
        assert idx["resolution_m"] == 2.5 and idx["size_px"] == 2048 and len(idx["corners_ll"]) == 3
        assert "AI 推估" in idx["note"] and idx["model"].startswith("bicubic")
        img = Image.open(s2sr.OUT_DIR / "2025-10_tc_sr.webp")
        assert img.mode == "RGBA" and img.size == (2048, 2048)
        a = np.asarray(img)
        assert (a[:, :40, 3] == 0).all() and (a[:, 300:, 3] == 255).all()      # 左側 10% 為雲 → 透明
        assert (s2sr.QA_DIR / "2025-10_compare.png").exists()
        before = calls["n"]
        s2sr.main(["--months", "2025-10", "--model", "bicubic"])                # 已存在 → 略過，不應再讀影像
        assert calls["n"] == before, "重跑不應重新讀取已完成的月份"
        print(f"  輸出 {e['size_kb']} KB（合成影像，真實地形通常較大）")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("PASS", t.__name__)
    print(f"{len(tests)} 項通過")
    sys.exit(0)
