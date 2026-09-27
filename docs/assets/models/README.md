# 馬太鞍溪三維地形模型

本次成果為既有 DSM 網格化及同日正射影像貼圖，沒有新增航測，也沒有以 NISAR／RGB 重新反演高程。

| 模型 | 高程來源 | 來源格網 | 展示網格 | 高程基準 |
|---|---|---:|---:|---|
| matayan_20250920 | 使用者提供之 2025-09-20 UAV DSM | 0.1 m | 5 m | TWVD2001 |
| matayan_20250930 | 使用者提供之 2025-09-30 UAV DSM | 0.1 m | 5 m | TWVD2001 |
| matayan_cop30 | Copernicus GLO-30，主要觀測年代 2011–2015 | 約 30 m | 30 m | EGM2008 |

UAV 日期依原始檔名，來源 GeoTIFF 記錄 Pix4Dmatic 1.83.0、TWD97 / TM2 zone 121 + TWVD2001。Copernicus DSM 可能以較早資料補洞，本成果未取得逐像元觀測日期。兩者垂直基準不同，沒有直接差分。

## 檔案

- `.glb`：包含幾何、法線、貼圖座標與 JPEG 紋理，可由 Blender、Three.js 等讀取。
- `_dsm.tif`：同模型網格的 Cloud Optimized GeoTIFF，供 GIS 載入。
- `_metadata.json`：原始檔名、座標、範圍、日期、格網、面數、SHA-256 與使用限制。
- `_texture.jpg` / `_preview.jpg`：同日正射影像經重採樣後的貼圖與預覽。
- `manifest.json`：檢視器資料清單。
- `validation.json`：GLB／展示 DSM 轉換一致性檢查；**不是高程測量精度報告**。

## GLB 座標

單位為公尺，右手座標系：X 向東、Y 向上、Z 向南。所有模型共用原點：

```text
E0 = 281000 m
N0 = 2621500 m
H0 = 600 m
E = E0 + X
N = N0 - Z
H = H0 + Y
```

GLB 保留 1× 原比例。網頁垂直倍率只影響顯示，點選高程會反算回原值。匯出視角圖會附資料日期、網格間距與倍率。

## 產製與檢核

1. 以 GDAL 水平重採樣到 EPSG:3826，UAV 採 average、衛星參考採 bilinear。保留既有高程，不進行垂直基準轉換。
2. 有效格點轉為局部公尺座標；僅保留三個頂點均有效、相鄰格點構成的三角形。NoData 不填補。
3. 同日正射影像投影至同一模型範圍後縮製貼圖。沒有把不同日期的影像混用。
4. 檢查每一 GLB 頂點與展示 DSM 高程一致、索引有效、法線與 UV 正確、不跨越空缺，並核對 SHA-256。

由專案根目錄執行 `tools/build_terrain_models.py --source-dir <來源資料夾> --satellite <Copernicus GeoTIFF>`，需要 GDAL、numpy、Pillow；再執行 `tools/verify_terrain_models.py`。使用 QGIS 隨附 Python 可重現。

## 解讀範圍

來源格網與展示網格都不等於垂直精度。尚未重新檢核控制點、穩定地表配準、水體遮罩及 LoD，因此不能把兩期模型視覺差異直接換算成正式沖淤量。水面、林冠、邊界可能有重建誤差；沒有水下河床地形。這是由單一高程表面建立的 2.5D 網格，不是包含懸垂面或背面幾何的完整攝影測量模型。

Copernicus 參考模型源自公開既有 DSM，不能代表 2025 年壩體的新地形。來源：[Copernicus Data Space](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)。

Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.

Three.js 0.170.0 為 MIT 授權；網站自帶必要模組及 LICENSE，不依賴外部 CDN 載入三維功能。

