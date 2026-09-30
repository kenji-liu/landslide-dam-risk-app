const form = document.querySelector("#assessmentForm");
const summaryCards = document.querySelector("#summaryCards");
const stabilityResults = document.querySelector("#stabilityResults");
const hydroResults = document.querySelector("#hydroResults");
const recommendation = document.querySelector("#recommendation");
const reportText = document.querySelector("#reportText");
const aiSummary = document.querySelector("#aiSummary");
const expertFindings = document.querySelector("#expertFindings");
const aiQuestion = document.querySelector("#aiQuestion");
const aiReply = document.querySelector("#aiReply");
const storageSummary = document.querySelector("#storageSummary");
const model3dSummary = document.querySelector("#model3dSummary");

const pageTitles = {
  dashboard: "專家總覽",
  survey: "調查參數",
  risk: "風險演算",
  storage: "庫容剖面",
  model3d: "3D 模型",
  figures: "示意圖庫",
  gis: "空間研判",
  monitor: "SAR監測",
  fanb: "林保署監測",
  sentinel2: "Sentinel-2監測",
  report: "通報報告",
  ai: "專家摘要"
};

const matayanPreset = {
  caseName: "馬太鞍溪堰塞湖",
  trigger: "降雨",
  damType: "崩滑型堰塞壩",
  catchmentArea: 63230000,
  landslideArea: 5000000,
  landslideVolume: 320000000,
  damVolume: 200000000,
  damHeight: 200,
  damWidth: 2300,
  damLength: 600,
  channelSlope: 0.114,
  waterVolume: 91000000,
  breachHeight: 200,
  breachTime: 2,
  riverWidth: 449.5,
  flowVelocity: 10,
  protectedHeight: 4.4,
  exposure: "high"
};

let latest = {};
let storageState = null;
let model3dState = null;
let model3dReportEnabled = true;
let terrainModelMetadata = null;
let terrainManifestPromise = null;

function terrainManifest() {
  if (!terrainManifestPromise) terrainManifestPromise = fetch('./assets/models/manifest.json').then(r => {
    if (!r.ok) throw new Error('模型清單讀取失敗');
    return r.json();
  }).catch(error => { terrainManifestPromise = null; throw error; });
  return terrainManifestPromise;
}

async function selectTerrainMetadata(id) {
  const manifest = await terrainManifest();
  const item = manifest.models.find(model => model.id === id);
  if (!item) return;
  terrainModelMetadata = item;
  const values = {
    model3dName: item.name, model3dType: 'DSM/DEM 地形模型',
    model3dLink: `assets/models/${item.glb}`, model3dCrs: item.crs,
    model3dDatum: item.datum, model3dDate: item.date,
    model3dResolution: `來源 DSM ${item.sourceResolution} m；展示網格 ${item.meshResolution} m；尚無獨立高程精度檢核`,
    model3dPurpose: '通報簡報與現地協調展示'
  };
  Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value; });
  renderModel3dAnalysis();
  renderReport();
}

window.addEventListener('message', event => {
  const frame = document.getElementById('terrainFrame');
  if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
  if (event.data?.type === 'terrain-viewer-size' && Number.isFinite(event.data.height)) {
    frame.style.height = `${Math.max(500, Math.min(2200, event.data.height + 2))}px`;
    return;
  }
  if (event.data?.type === 'terrain-pick') { gis3dOnPick(event.data); return; }
  if (event.data?.type !== 'terrain-model-selected') return;
  selectTerrainMetadata(event.data.id).catch(error => console.warn(error.message));
  gis3dOnModel(event.data.id);
});

function escapeModelText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

const matayanLocation = {
  name: "馬太鞍溪堰塞湖",
  lat: 23.6995,
  lng: 121.2955,
  zoom: 15
};

const copernicusView = {
  lat: 23.69711,
  lng: 121.31018,
  zoom: 14,
  url: "https://browser.dataspace.copernicus.eu/?zoom=14&lat=23.69711&lng=121.31018&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX1%2Bwqz6C%2FJI4OUsBDU2vxXGJMALdaS2nR9lzH3xz7xPZemkWEzUeRIYHYdqV7id2ftM0ZP%2BHcUS%2F1auSQs%2BxRIGY0Vx3oB6uoahSLK%2BedSpLAngjaabL43wC&datasetId=S2_L2A_CDAS&fromTime=2026-04-14T00%3A00%3A00.000Z&toTime=2026-04-14T23%3A59%3A59.999Z&layerId=2_FALSE_COLOR&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE"
};

const measureMeta = {
  landslide: { label: "崩塌面積 AL", type: "polygon", minPoints: 3, color: "#c85252" },
  damFootprint: { label: "壩體足跡面積", type: "polygon", minPoints: 3, color: "#d98933" },
  damWidth: { label: "壩寬 WD", type: "line", minPoints: 2, color: "#2f80c2" },
  damLength: { label: "壩長 LDTop", type: "line", minPoints: 2, color: "#3a9b73" },
  channelSlope: { label: "代表河段長度", type: "line", minPoints: 2, color: "#7b6fd6" },
  elevationPoint: { label: "點選高程", type: "point", minPoints: 1, color: "#0f6e82" },
  profile: { label: "DSM 剖面", type: "line", minPoints: 2, color: "#111827" }
};

const elevationTargetLabels = {
  crestElevation: "壩頂/溢流點高程",
  riverbedElevation: "原河床高程",
  slopeUpElevation: "上游河床高程",
  slopeDownElevation: "下游河床高程"
};

const paramSpatialLinks = {
  landslideArea: { mode: "landslide" },
  landslideVolume: { mode: "landslide" },
  damVolume: { mode: "damFootprint" },
  damHeight: { mode: "elevationPoint", target: "crestElevation" },
  damWidth: { mode: "damWidth" },
  damLength: { mode: "damLength" },
  channelSlope: { mode: "channelSlope", target: "slopeUpElevation" }
};

const spatialState = {
  map: null,
  baseLayers: {},
  activeBaseLayer: null,
  activeMode: "landslide",
  currentPoints: [],
  currentLayer: null,
  selectedFeatureId: null,
  drawnLayers: [],
  featureSeq: 0,
  result: {
    landslideArea: 0,
    damFootprintArea: 0,
    damWidth: 0,
    damLength: 0,
    channelSlopeDistance: 0,
    lastElevation: 0
  }
};

function svgShell(title, inner) {
  return `
    <span class="param-sketch" aria-label="${title}">
      <span class="sketch-title">${title}</span>
      <svg viewBox="0 0 220 92" role="img" aria-hidden="true">
        ${inner}
      </svg>
    </span>
  `;
}

const parameterSketches = {
  caseName: svgShell("範例：案件命名", `
    <rect x="18" y="16" width="82" height="58" rx="8" class="sketch-paper"></rect>
    <line x1="31" y1="34" x2="86" y2="34" class="sketch-line"></line>
    <line x1="31" y1="48" x2="76" y2="48" class="sketch-line"></line>
    <circle cx="145" cy="45" r="23" class="sketch-water"></circle>
    <text x="118" y="80" class="sketch-text">自訂名稱</text>
  `),
  trigger: svgShell("範例：誘發事件", `
    <path d="M48 36c0-15 24-17 29-5 15-4 27 6 27 19 0 11-9 18-22 18H49c-15 0-25-7-25-18 0-9 8-15 24-14z" class="sketch-cloud"></path>
    <line x1="50" y1="72" x2="44" y2="86" class="sketch-rain"></line>
    <line x1="72" y1="72" x2="66" y2="86" class="sketch-rain"></line>
    <path d="M132 66l19-39 9 25 12-18 16 32" class="sketch-warning"></path>
    <text x="28" y="18" class="sketch-text">降雨 / 地震 / 土石流</text>
  `),
  damType: svgShell("範例：壩體型態", `
    <path d="M18 72c35-6 60-6 86 0 36 8 62 5 98-7" class="sketch-river"></path>
    <path d="M92 70l34-46 36 46z" class="sketch-dam"></path>
    <path d="M30 58c28-14 48-17 70-14" class="sketch-slope"></path>
    <text x="91" y="20" class="sketch-text">崩滑型 / 土石流型</text>
  `),
  catchmentArea: svgShell("範例：圈繪上游集水區", `
    <path d="M32 74C22 50 41 21 77 18c42-4 78 18 98 48-40 17-101 18-143 8z" class="sketch-basin"></path>
    <path d="M78 22c14 18 26 29 43 44" class="sketch-flow"></path>
    <circle cx="152" cy="67" r="7" class="sketch-dam-dot"></circle>
    <text x="42" y="85" class="sketch-text">以壩址為出口</text>
  `),
  landslideArea: svgShell("範例：圈繪崩塌面積", `
    <path d="M22 74L72 20h55l72 54z" class="sketch-mountain"></path>
    <path d="M79 26c-16 15-27 30-31 48h54c-2-17-8-32-23-48z" class="sketch-slide"></path>
    <path d="M47 75c37 6 83 6 126 0" class="sketch-river"></path>
    <text x="43" y="17" class="sketch-text">圈繪裸露區</text>
  `),
  landslideVolume: svgShell("範例：災前災後差分", `
    <path d="M22 66c34-28 76-30 119-9 22 10 40 10 59 5" class="sketch-before"></path>
    <path d="M22 78c34-8 76-8 119-4 22 2 40 2 59-3" class="sketch-after"></path>
    <path d="M62 55c18 16 55 17 76 4v17H62z" class="sketch-volume"></path>
    <text x="62" y="25" class="sketch-text">DEM 差分體積</text>
  `),
  damVolume: svgShell("範例：壩體體積", `
    <path d="M18 72c38-8 67-9 96 0 37 11 62 5 88-4" class="sketch-river"></path>
    <path d="M78 71l32-43 49 43z" class="sketch-dam"></path>
    <path d="M91 64l21-27 31 27z" class="sketch-volume"></path>
    <text x="83" y="22" class="sketch-text">壩體範圍 x 高差</text>
  `),
  damHeight: svgShell("範例：壩高 H", `
    <path d="M26 74h170" class="sketch-ground"></path>
    <path d="M82 74l35-48 47 48z" class="sketch-dam"></path>
    <line x1="119" y1="28" x2="119" y2="74" class="sketch-measure"></line>
    <text x="126" y="55" class="sketch-text">H</text>
    <text x="68" y="86" class="sketch-text">原河床至溢流點</text>
  `),
  damWidth: svgShell("範例：壩寬 W", `
    <path d="M24 72h170" class="sketch-ground"></path>
    <path d="M74 72l38-42 44 42z" class="sketch-dam"></path>
    <line x1="74" y1="80" x2="156" y2="80" class="sketch-measure"></line>
    <text x="109" y="90" class="sketch-text">W</text>
  `),
  damLength: svgShell("範例：沿河道壩長 L", `
    <path d="M22 58c39-19 75-15 110-1 25 10 45 11 67 2" class="sketch-river"></path>
    <ellipse cx="112" cy="58" rx="48" ry="17" class="sketch-dam"></ellipse>
    <line x1="65" y1="31" x2="159" y2="31" class="sketch-measure"></line>
    <text x="103" y="25" class="sketch-text">L</text>
  `),
  channelSlope: svgShell("範例：河床坡降 S", `
    <line x1="24" y1="72" x2="196" y2="34" class="sketch-ground"></line>
    <line x1="46" y1="74" x2="170" y2="74" class="sketch-measure"></line>
    <line x1="170" y1="74" x2="170" y2="40" class="sketch-measure"></line>
    <text x="92" y="87" class="sketch-text">水平距離</text>
    <text x="176" y="61" class="sketch-text">高差</text>
  `),
  waterVolume: svgShell("範例：蓄水體積", `
    <path d="M23 74h174" class="sketch-ground"></path>
    <path d="M95 73l27-40 39 40z" class="sketch-dam"></path>
    <path d="M39 72c20-27 42-37 82-25v25z" class="sketch-water"></path>
    <text x="47" y="38" class="sketch-text">水面 x 水深</text>
  `),
  breachHeight: svgShell("範例：潰口高度", `
    <path d="M26 74h170" class="sketch-ground"></path>
    <path d="M77 74l38-47 48 47z" class="sketch-dam"></path>
    <path d="M116 28l9 26 9-26" class="sketch-breach"></path>
    <line x1="142" y1="30" x2="142" y2="74" class="sketch-measure"></line>
    <text x="148" y="55" class="sketch-text">Hb</text>
  `),
  breachTime: svgShell("範例：潰壩歷時", `
    <line x1="30" y1="72" x2="190" y2="72" class="sketch-ground"></line>
    <path d="M45 72c28-48 58-48 85 0" class="sketch-hydro"></path>
    <line x1="45" y1="82" x2="130" y2="82" class="sketch-measure"></line>
    <text x="75" y="91" class="sketch-text">Tc</text>
    <text x="68" y="22" class="sketch-text">洪峰歷線時間</text>
  `),
  riverWidth: svgShell("範例：代表河寬", `
    <path d="M28 35c32 12 56 12 82 0 28-13 55-12 82 0" class="sketch-bank"></path>
    <path d="M28 65c32-12 56-12 82 0 28 13 55 12 82 0" class="sketch-bank"></path>
    <path d="M39 49c36 9 99 9 141 0v10c-42 9-105 9-141 0z" class="sketch-water"></path>
    <line x1="38" y1="78" x2="181" y2="78" class="sketch-measure"></line>
    <text x="100" y="90" class="sketch-text">Bw</text>
  `),
  flowVelocity: svgShell("範例：代表流速", `
    <path d="M26 62c33-14 58-13 86 0 31 14 55 13 84 0" class="sketch-river"></path>
    <line x1="50" y1="48" x2="102" y2="48" class="sketch-arrow"></line>
    <line x1="78" y1="62" x2="150" y2="62" class="sketch-arrow"></line>
    <text x="63" y="31" class="sketch-text">水理模式 / 現地估算</text>
  `),
  protectedHeight: svgShell("範例：保全高程差", `
    <path d="M24 76h170" class="sketch-ground"></path>
    <path d="M30 70c31-10 60-10 92 0" class="sketch-water"></path>
    <rect x="142" y="40" width="34" height="36" rx="3" class="sketch-house"></rect>
    <line x1="132" y1="76" x2="132" y2="48" class="sketch-measure"></line>
    <text x="104" y="57" class="sketch-text">Hpo</text>
  `),
  exposure: svgShell("範例：保全對象", `
    <path d="M20 70c44-12 82-12 124 0" class="sketch-river"></path>
    <rect x="151" y="35" width="24" height="35" rx="3" class="sketch-house"></rect>
    <rect x="181" y="45" width="20" height="25" rx="3" class="sketch-house"></rect>
    <line x1="126" y1="60" x2="190" y2="60" class="sketch-warning"></line>
    <text x="116" y="25" class="sketch-text">聚落 / 道路 / 橋梁</text>
  `)
};

function addParameterSketches() {
  Object.entries(parameterSketches).forEach(([name, markup]) => {
    const control = form.elements[name];
    if (!control) return;
    const field = control.closest(".param-field");
    if (!field || field.querySelector(".param-sketch")) return;
    field.insertAdjacentHTML("beforeend", markup);
  });
}

function num(name) {
  const value = Number(form.elements[name].value);
  return Number.isFinite(value) ? value : 0;
}

function text(name) {
  return form.elements[name].value;
}

function log10(value) {
  return value > 0 ? Math.log10(value) : NaN;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "資料不足";
  return value.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function fmtCompact(value, digits = 0, unit = "") {
  if (!Number.isFinite(value) || value <= 0) return "尚未量測";
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: digits })}${unit}`;
}

function fmtLegendValue(mode) {
  const valueMap = {
    landslide: [spatialState.result.landslideArea, 0, "m²"],
    damFootprint: [spatialState.result.damFootprintArea, 0, "m²"],
    damWidth: [spatialState.result.damWidth, 1, "m"],
    damLength: [spatialState.result.damLength, 1, "m"],
    channelSlope: [spatialState.result.channelSlopeDistance, 1, "m"],
    elevationPoint: [spatialState.result.lastElevation, 1, "m"],
    profile: [spatialState.result.profileLength || 0, 1, "m"]
  };
  const [value, digits, unit] = valueMap[mode] || [0, 0, ""];
  return fmtCompact(value, digits, ` ${unit}`);
}

function getInputNumber(id) {
  const el = document.querySelector(`#${id}`);
  if (!el) return 0;
  const value = Number(el.value);
  return Number.isFinite(value) ? value : 0;
}

function setMapStatus(message) {
  const status = document.querySelector("#mapStatus");
  if (status) status.textContent = message;
}

function copernicusUrlFromMap() {
  const url = new URL(copernicusView.url);
  if (spatialState.map) {
    const center = spatialState.map.getCenter();
    url.searchParams.set("lat", center.lat.toFixed(5));
    url.searchParams.set("lng", center.lng.toFixed(5));
    url.searchParams.set("zoom", Math.round(spatialState.map.getZoom()));
  }
  return url.toString();
}

function updateCopernicusLinks() {
  return copernicusUrlFromMap();
}

function focusCopernicusView() {
  if (!spatialState.map) return;
  spatialState.map.setView([copernicusView.lat, copernicusView.lng], copernicusView.zoom);
  updateCopernicusLinks();
  setMapStatus("已定位至 Copernicus Data Space Browser 連結範圍，可對照 Sentinel-2 False Color 影像判釋。");
}

function openCopernicusCurrentTab() {
  const url = updateCopernicusLinks();
  window.location.assign(url);
}

function elevationTarget() {
  return document.querySelector("#elevationTarget")?.value || "crestElevation";
}

async function lookupElevation(latlng) {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${latlng.lat.toFixed(6)}&longitude=${latlng.lng.toFixed(6)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`高程 API 回應 ${response.status}`);
  const data = await response.json();
  const value = Array.isArray(data.elevation) ? Number(data.elevation[0]) : NaN;
  if (!Number.isFinite(value)) throw new Error("高程 API 未回傳有效數值");
  return value;
}

function polygonArea(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  const earthRadius = 6378137;
  let area = 0;
  for (let i = 0; i < latlngs.length; i += 1) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    const lon1 = p1.lng * Math.PI / 180;
    const lon2 = p2.lng * Math.PI / 180;
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * earthRadius * earthRadius / 2);
}

function lineDistance(latlngs) {
  if (!spatialState.map || !latlngs || latlngs.length < 2) return 0;
  let distance = 0;
  for (let i = 1; i < latlngs.length; i += 1) {
    distance += spatialState.map.distance(latlngs[i - 1], latlngs[i]);
  }
  return distance;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getStorageInputs() {
  const bed = getInputNumber("lakeBedElevation") || 1049;
  const spillway = getInputNumber("spillwayElevation") || 1086;
  const level = getInputNumber("currentWaterLevel") || bed;
  const maxStorage10k = getInputNumber("maxStorageVolume") || 500;
  const exponent = getInputNumber("storageExponent") || 1.65;
  return { bed, spillway, level, maxStorage10k, exponent };
}

function estimateStorageFromLevel(level, bed, spillway, maxStorage10k, exponent) {
  const ratio = spillway > bed ? clamp((level - bed) / (spillway - bed), 0, 1) : 0;
  return maxStorage10k * Math.pow(ratio, exponent);
}

function storagePoint(level, bed, spillway, maxStorage10k, exponent) {
  const storage10k = estimateStorageFromLevel(level, bed, spillway, maxStorage10k, exponent);
  const freeboard = spillway - level;
  const percent = maxStorage10k > 0 ? storage10k / maxStorage10k * 100 : 0;
  return { level, storage10k, freeboard, percent };
}

function renderStorageAnalysis() {
  if (!storageSummary) return;
  const inputs = getStorageInputs();
  const slider = document.querySelector("#waterLevelSlider");
  if (slider) {
    slider.min = inputs.bed.toFixed(1);
    slider.max = inputs.spillway.toFixed(1);
    if (Number(slider.value) < inputs.bed || Number(slider.value) > inputs.spillway) slider.value = inputs.level.toFixed(1);
  }
  const level = slider ? Number(slider.value) : inputs.level;
  const point = storagePoint(level, inputs.bed, inputs.spillway, inputs.maxStorage10k, inputs.exponent);
  storageState = { ...inputs, ...point, storageM3: point.storage10k * 10000 };

  document.querySelector("#waterLevelReadout").textContent = `${fmt(point.level, 1)} m`;
  storageSummary.innerHTML = [
    ["情境水位", `${fmt(point.level, 1)} m`, `距溢流口 ${fmt(point.freeboard, 1)} m`, point.freeboard <= 3 ? "danger" : point.freeboard <= 8 ? "warn" : "ok"],
    ["估算庫容", `${fmt(point.storage10k, 1)} 萬 m³`, `滿水比例 ${fmt(point.percent, 1)}%`, point.percent >= 90 ? "danger" : point.percent >= 70 ? "warn" : "neutral"],
    ["溢流口", `${fmt(inputs.spillway, 1)} m`, `湖底 ${fmt(inputs.bed, 1)} m`, "neutral"],
    ["回填 Vw", `${fmt(point.storage10k * 10000, 0)} m³`, "可套入蓄水體積", "ok"]
  ].map(([label, value, note, cls]) => `
    <div class="card">
      <strong>${label}</strong>
      <b>${value}</b>
      <span class="tag ${cls}">${note}</span>
    </div>
  `).join("");

  renderStorageCharts(storageState);
}

function renderStorageCharts(state) {
  const ratio = clamp((state.level - state.bed) / (state.spillway - state.bed), 0, 1);
  const waterY = 170 - ratio * 95;
  const spillY = 70;
  const bedY = 170;
  const storageX = 42 + clamp(state.percent, 0, 100) / 100 * 310;

  document.querySelector("#storage3d").innerHTML = `
    <svg viewBox="0 0 420 260" class="storage-svg" role="img" aria-label="三維庫容概念圖">
      <defs>
        <linearGradient id="terrainGrad" x1="0" x2="1"><stop offset="0" stop-color="#d5b77a"/><stop offset="1" stop-color="#4a9bab"/></linearGradient>
      </defs>
      <polygon points="70,185 145,70 320,95 350,205 150,225" fill="url(#terrainGrad)" opacity=".72"/>
      <polygon points="125,178 170,112 285,124 315,184 178,202" fill="#2f80c2" opacity=".42"/>
      <polyline points="90,190 170,112 320,125" fill="none" stroke="#6f5736" stroke-width="3"/>
      <line x1="95" y1="${waterY}" x2="330" y2="${waterY}" stroke="#2f80c2" stroke-width="3" stroke-dasharray="8 5"/>
      <line x1="95" y1="${spillY}" x2="330" y2="${spillY}" stroke="#c85252" stroke-width="3"/>
      <text x="306" y="${waterY - 7}" class="chart-text">水位 ${fmt(state.level, 1)} m</text>
      <text x="306" y="${spillY - 7}" class="chart-text">溢流口 ${fmt(state.spillway, 1)} m</text>
      <text x="28" y="235" class="chart-text">3D 概念：以 DEM/DSM 建立水位-庫容關係</text>
    </svg>
  `;

  document.querySelector("#longProfileChart").innerHTML = `
    <svg viewBox="0 0 520 260" class="storage-svg" role="img" aria-label="縱剖面圖">
      <line x1="45" y1="215" x2="490" y2="215" class="axis-line"/><line x1="45" y1="35" x2="45" y2="215" class="axis-line"/>
      <path d="M55 ${bedY-35} C125 ${bedY-12},180 ${bedY-30},245 ${bedY-15} S380 ${bedY-70},485 ${bedY-105}" fill="none" stroke="#111827" stroke-width="3"/>
      <line x1="55" y1="${waterY}" x2="485" y2="${waterY}" stroke="#2f80c2" stroke-width="2" stroke-dasharray="8 5"/>
      <line x1="55" y1="${spillY}" x2="485" y2="${spillY}" stroke="#c85252" stroke-width="2"/>
      <rect x="60" y="${waterY}" width="310" height="${215-waterY}" fill="#2f80c2" opacity=".12"/>
      <text x="58" y="235" class="chart-text">距壩里程（m）</text><text x="12" y="28" class="chart-text">高程</text>
      <text x="330" y="${waterY-8}" class="chart-text">情境水位</text><text x="365" y="${spillY-8}" class="chart-text">溢流口</text>
    </svg>
  `;

  document.querySelector("#crossProfileChart").innerHTML = `
    <svg viewBox="0 0 520 260" class="storage-svg" role="img" aria-label="橫剖面圖">
      <line x1="45" y1="215" x2="490" y2="215" class="axis-line"/><line x1="45" y1="35" x2="45" y2="215" class="axis-line"/>
      <path d="M55 85 C120 120,165 190,250 205 C335 202,385 130,485 70" fill="none" stroke="#111827" stroke-width="3"/>
      <line x1="55" y1="${waterY}" x2="485" y2="${waterY}" stroke="#2f80c2" stroke-width="2" stroke-dasharray="8 5"/>
      <polygon points="132,${waterY} 368,${waterY} 300,205 220,205" fill="#2f80c2" opacity=".18"/>
      <line x1="55" y1="${spillY}" x2="485" y2="${spillY}" stroke="#c85252" stroke-width="2"/>
      <text x="58" y="235" class="chart-text">左岸 ← 橫向距離 → 右岸</text><text x="330" y="${waterY-8}" class="chart-text">水面</text>
    </svg>
  `;

  document.querySelector("#storageCurveChart").innerHTML = `
    <svg viewBox="0 0 520 260" class="storage-svg" role="img" aria-label="庫容曲線圖">
      <line x1="50" y1="215" x2="490" y2="215" class="axis-line"/><line x1="50" y1="35" x2="50" y2="215" class="axis-line"/>
      <path d="M55 210 C135 182,220 145,315 95 S430 55,485 38" fill="none" stroke="#2f80c2" stroke-width="3"/>
      <line x1="${storageX}" y1="215" x2="${storageX}" y2="${waterY}" stroke="#64748b" stroke-width="2"/>
      <line x1="50" y1="${waterY}" x2="${storageX}" y2="${waterY}" stroke="#64748b" stroke-width="2" stroke-dasharray="6 5"/>
      <circle cx="${storageX}" cy="${waterY}" r="7" fill="#2f80c2" stroke="white" stroke-width="2"/>
      <rect x="50" y="35" width="435" height="26" fill="#fff1c7" opacity=".75"/>
      <text x="58" y="235" class="chart-text">蓄水量（萬 m³）</text><text x="12" y="28" class="chart-text">水位</text>
      <text x="270" y="52" class="chart-text">接近溢流警戒區</text>
      <text x="${Math.min(storageX + 10, 390)}" y="${Math.max(waterY - 10, 28)}" class="chart-text">${fmt(state.level, 1)} m / ${fmt(state.storage10k, 1)} 萬 m³</text>
    </svg>
  `;
}

function getModel3dInputs() {
  const value = (id) => document.querySelector(`#${id}`)?.value?.trim() || "";
  return {
    name: value("model3dName"),
    type: value("model3dType"),
    link: value("model3dLink"),
    crs: value("model3dCrs"),
    datum: value("model3dDatum"),
    resolution: value("model3dResolution"),
    date: value("model3dDate"),
    purpose: value("model3dPurpose")
  };
}

function evaluateModel3dQuality(model) {
  const checks = [
    ["模型名稱", model.name],
    ["資料型態", model.type],
    ["檔案或連結", model.link],
    ["座標系統", model.crs],
    ["高程基準", model.datum],
    ["解析度/點雲密度", model.resolution],
    ["資料日期 / 產品年代", model.date],
    ["主要用途", model.purpose]
  ];
  const filled = checks.filter(([, value]) => value).length;
  const score = Math.round(filled / checks.length * 100);
  const missing = checks.filter(([, value]) => !value).map(([label]) => label);
  let level = "登錄欄位待補";
  let cls = "warn";
  if (score === 100) {
    level = "登錄欄位完整";
    cls = "ok";
  } else if (score < 55) {
    level = "資料待補";
    cls = "danger";
  }
  return { score, level, cls, missing };
}

function renderModel3dAnalysis() {
  if (!model3dSummary) return;
  const model = getModel3dInputs();
  const quality = evaluateModel3dQuality(model);
  const source = terrainModelMetadata && model.link === `assets/models/${terrainModelMetadata.glb}` ? terrainModelMetadata : null;
  model3dState = { ...model, ...quality, evidenceLimit: source?.limits || '登錄完整度不代表模型精度，尚需獨立高程檢核。' };
  const safe = Object.fromEntries(Object.entries(model).map(([key, value]) => [key, escapeModelText(value)]));

  const linkText = model.link
    ? `<span class="model3d-link">${safe.link}</span>`
    : `<span class="model3d-link empty">尚未填入模型檔案或雲端連結</span>`;
  const missingText = quality.missing.length
    ? `建議補齊：${quality.missing.slice(0, 4).join("、")}${quality.missing.length > 4 ? "等" : ""}`
    : "登錄欄位已填齊；此比例不代表模型高程精度或工程適用性。";

  model3dSummary.innerHTML = `
    <div class="model3d-summary-head">
      <span class="tag ${quality.cls}">${quality.level}</span>
      <strong>登錄完整度 ${quality.score}%</strong>
    </div>
    <h3>${safe.name || "未命名 3D 模型"}</h3>
    <p><b>資料型態：</b>${safe.type || "待填"}；<b>用途：</b>${safe.purpose || "待填"}</p>
    <p><b>座標/高程：</b>${safe.crs || "待填"}｜${safe.datum || "待填"}</p>
    <p><b>解析度：</b>${safe.resolution || "待填"}</p>
    <p><b>資料日期 / 年代：</b>${safe.date || "待填"}</p>
    ${linkText}
    <p class="model3d-quality">${missingText}</p>
    <p class="model3d-quality"><strong>使用限制：</strong>${escapeModelText(model3dState.evidenceLimit)}</p>
  `;
}

function apply3dModelToReport() {
  model3dReportEnabled = true;
  renderModel3dAnalysis();
  compute();
  const button = document.querySelector("#apply3dModelToReport");
  if (button) {
    button.textContent = "已納入摘要";
    setTimeout(() => (button.textContent = "納入報告摘要"), 1400);
  }
}

function getSpatialEstimates() {
  const AL = spatialState.result.landslideArea;
  const damFootprint = spatialState.result.damFootprintArea;
  const WD = spatialState.result.damWidth;
  const LDTop = spatialState.result.damLength;
  const slopeDistance = spatialState.result.channelSlopeDistance;
  const landslideThickness = getInputNumber("landslideThickness");
  const crestElevation = getInputNumber("crestElevation");
  const riverbedElevation = getInputNumber("riverbedElevation");
  const slopeUpElevation = getInputNumber("slopeUpElevation");
  const slopeDownElevation = getInputNumber("slopeDownElevation");
  const shapeFactor = getInputNumber("damShapeFactor") || 0.72;
  const HDmin = crestElevation > 0 && riverbedElevation > 0 ? Math.max(0, crestElevation - riverbedElevation) : num("damHeight");
  const VL = AL > 0 && landslideThickness > 0 ? AL * landslideThickness : 0;
  const inferredDamFootprint = damFootprint > 0 ? damFootprint : WD * LDTop;
  const VD = spatialState.demOverride?.VD > 0 ? spatialState.demOverride.VD
    : (inferredDamFootprint > 0 && HDmin > 0 ? inferredDamFootprint * HDmin * shapeFactor : 0);
  const S = slopeDistance > 0 && slopeUpElevation > 0 && slopeDownElevation > 0
    ? Math.abs(slopeUpElevation - slopeDownElevation) / slopeDistance
    : 0;

  return { AL, VL, VD, HDmin, WD, LDTop, S, damFootprint, slopeDistance, shapeFactor, landslideThickness };
}

function renderSpatialResults() {
  const container = document.querySelector("#spatialResults");
  if (!container) return;
  const estimate = getSpatialEstimates();
  container.innerHTML = `
    <div class="spatial-result"><strong>AL</strong><span>${fmtCompact(estimate.AL, 0, " m²")}</span></div>
    <div class="spatial-result"><strong>VL</strong><span>${fmtCompact(estimate.VL, 0, " m³")}</span></div>
    <div class="spatial-result"><strong>VD</strong><span>${fmtCompact(estimate.VD, 0, " m³")}</span></div>
    <div class="spatial-result"><strong>HDmin</strong><span>${fmtCompact(estimate.HDmin, 1, " m")}</span></div>
    <div class="spatial-result"><strong>WD</strong><span>${fmtCompact(estimate.WD, 1, " m")}</span></div>
    <div class="spatial-result"><strong>LDTop</strong><span>${fmtCompact(estimate.LDTop, 1, " m")}</span></div>
    <div class="spatial-result"><strong>S</strong><span>${fmtCompact(estimate.S, 4, " m/m")}</span></div>
  `;
  renderMapLegend();
  renderDrawnLayerList();
}

function renderDrawnLayerList() {
  const list = document.querySelector("#drawnLayerList");
  if (!list) return;
  if (spatialState.drawnLayers.length === 0) {
    list.innerHTML = `<p class="muted-empty">尚未建立圈繪圖層。</p>`;
    return;
  }
  list.innerHTML = spatialState.drawnLayers.map((feature) => {
    const editable = ["landslide", "damFootprint", "lakeRef"].includes(feature.mode);
    const editing = typeof gisEdit !== "undefined" && gisEdit.id === feature.id;
    return `<div class="drawn-row">
    <button type="button" class="drawn-layer-button ${spatialState.selectedFeatureId === feature.id ? "active" : ""}" data-feature-id="${feature.id}">
      <i class="drawn-layer-swatch" style="--layer-color:${feature.color}"></i>
      <span>${feature.label}</span>
      <span class="drawn-layer-value">${feature.valueLabel}</span>
    </button>
    ${editable ? `<button type="button" class="${editing ? "" : "outline"} drawn-edit" data-edit-feature="${feature.id}">${editing ? "完成編輯" : "編輯邊界"}</button>` : ""}
  </div>`;
  }).join("");
}

function addDrawnFeature({ mode, label, valueLabel, layer, color }) {
  const feature = {
    id: `feature-${spatialState.featureSeq += 1}`,
    mode,
    label,
    valueLabel,
    layer,
    color
  };
  spatialState.drawnLayers.push(feature);
  if (typeof gis3dSchedule === "function") gis3dSchedule();
  layer.on("click", () => {
    spatialState.selectedFeatureId = feature.id;
    if (layer.openPopup) layer.openPopup();
    renderDrawnLayerList();
  });
  renderDrawnLayerList();
  return feature;
}

function focusDrawnFeature(id) {
  const feature = spatialState.drawnLayers.find((item) => item.id === id);
  if (!feature || !spatialState.map) return;
  spatialState.selectedFeatureId = id;
  const layer = feature.layer;
  if (layer.getBounds) spatialState.map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 18 });
  else if (layer.getLatLng) spatialState.map.setView(layer.getLatLng(), Math.max(spatialState.map.getZoom(), 17));
  if (layer.openPopup) layer.openPopup();
  renderDrawnLayerList();
}

function renderMapLegend() {
  const legend = document.querySelector("#mapLegend");
  if (!legend) return;
  const activeLabel = measureMeta[spatialState.activeMode]?.label || "未選擇";
  legend.innerHTML = `
    <h4>圈繪圖例 <span>目前：${activeLabel}</span></h4>
    <div class="legend-list">
      ${Object.entries(measureMeta).map(([mode, meta]) => {
        const isLine = meta.type === "line";
        const value = fmtLegendValue(mode);
        const measured = !value.includes("尚未");
        return `
          <div class="legend-item ${spatialState.activeMode === mode ? "active" : ""}" style="--legend-color:${meta.color}">
            <i class="legend-symbol ${isLine ? "line" : ""}"></i>
            <span class="legend-label">${meta.label}</span>
            <span class="legend-value">${measured ? value : "待圈繪"}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function resetCurrentMeasurement() {
  if (spatialState.currentLayer && spatialState.map) spatialState.map.removeLayer(spatialState.currentLayer);
  spatialState.currentPoints = [];
  spatialState.currentLayer = null;
}

function drawCurrentMeasurement() {
  if (!spatialState.map) return;
  if (spatialState.currentLayer) spatialState.map.removeLayer(spatialState.currentLayer);
  const meta = measureMeta[spatialState.activeMode];
  if (!meta || meta.type === "point" || spatialState.currentPoints.length === 0) return;
  const options = { color: meta.color, weight: 3, fillColor: meta.color, fillOpacity: 0.22, interactive: false };
  if (meta.type === "polygon" && spatialState.currentPoints.length >= 3) {
    spatialState.currentLayer = L.polygon(spatialState.currentPoints, options).addTo(spatialState.map);
  } else {
    spatialState.currentLayer = L.polyline(spatialState.currentPoints, options).addTo(spatialState.map);
  }
}

function finishMeasurement() {
  if (!spatialState.map || spatialState.editing) return;
  const meta = measureMeta[spatialState.activeMode];
  if (meta?.type === "point") {
    setMapStatus(`點選高程：請先選擇「高程套用目標」，再直接點擊地圖位置。`);
    return;
  }
  if (!meta || spatialState.currentPoints.length < meta.minPoints) {
    setMapStatus(`${meta ? meta.label : "量測"} 至少需要 ${meta ? meta.minPoints : 2} 個點。`);
    return;
  }

  const points = [...spatialState.currentPoints];
  const options = { color: meta.color, weight: 3, fillColor: meta.color, fillOpacity: 0.26, interactive: false };
  let value = 0;
  let layer;
  if (meta.type === "polygon") {
    value = polygonArea(points);
    layer = L.polygon(points, options).addTo(spatialState.map);
    if (spatialState.activeMode === "landslide") spatialState.result.landslideArea = value;
    if (spatialState.activeMode === "damFootprint") spatialState.result.damFootprintArea = value;
  } else {
    value = lineDistance(points);
    layer = L.polyline(points, options).addTo(spatialState.map);
    if (spatialState.activeMode === "damWidth") spatialState.result.damWidth = value;
    if (spatialState.activeMode === "damLength") spatialState.result.damLength = value;
    if (spatialState.activeMode === "channelSlope") spatialState.result.channelSlopeDistance = value;
  }
  const valueLabel = meta.type === "polygon" ? fmtCompact(value, 0, " m²") : fmtCompact(value, 1, " m");
  layer.bindPopup(`<div class="spatial-popup"><b>${meta.label}</b><span>${valueLabel}</span><span>由右側圖層清單可再次開啟；地圖圖形不阻擋後續量測點選。</span></div>`);
  const drawnMode = spatialState.activeMode;
  addDrawnFeature({ mode: drawnMode, label: meta.label, valueLabel, layer, color: meta.color });
  resetCurrentMeasurement();
  if (drawnMode === "profile") { spatialState.result.profileLength = value; demProfile(points); }
  if (drawnMode === "landslide" || drawnMode === "damFootprint") demDiffRefresh();
  renderSpatialResults();
  autoImportSpatialEstimates(`已完成 ${meta.label}：${valueLabel}，`);
}

async function handleElevationClick(latlng) {
  const target = elevationTarget();
  const targetLabel = elevationTargetLabels[target] || "高程欄位";
  setMapStatus(`正在查詢 ${targetLabel} 高程...`);
  try {
    const detail = await lookupElevationDetail(latlng, target);
    const elevation = detail.value;
    const input = document.querySelector(`#${target}`);
    if (input) input.value = elevation.toFixed(1);
    gisNoteElev(target, elevation, `地圖點選，${detail.label}`);
    spatialState.result.lastElevation = elevation;
    const meta = measureMeta.elevationPoint;
    const marker = L.circleMarker(latlng, {
      radius: 7,
      color: meta.color,
      fillColor: meta.color,
      fillOpacity: 0.85,
      weight: 2,
      interactive: false
    }).addTo(spatialState.map);
    const valueLabel = `${elevation.toFixed(1)} m`;
    marker.bindPopup(`
      <div class="spatial-popup">
        <b>${targetLabel}</b>
        <span>${valueLabel}</span>
        <span>採用：${detail.label}</span>
        ${dsmDetailHtml(detail)}
        <button type="button" class="outline go3d" data-go3d="${latlng.lat},${latlng.lng}">在 3D 模型查看此點</button>
      </div>
    `).openPopup();
    addDrawnFeature({ mode: "elevationPoint", label: targetLabel, valueLabel, layer: marker, color: meta.color });
    handleSpatialEstimateInput();
    setMapStatus(`${targetLabel} 已由地圖點選高程帶入 ${valueLabel}，並同步更新調查參數。`);
  } catch (error) {
    setMapStatus(`高程查詢失敗：${error.message}。可先改用人工輸入或既有 DEM 成果。`);
  }
}

function handleMapClick(event) {
  if (spatialState.editing) return;
  if (spatialState.activeMode === "elevationPoint") {
    handleElevationClick(event.latlng);
    return;
  }
  spatialState.currentPoints.push(event.latlng);
  drawCurrentMeasurement();
  const meta = measureMeta[spatialState.activeMode];
  setMapStatus(`${meta.label} 已點選 ${spatialState.currentPoints.length} 點；完成後按「完成量測」。`);
}

function setMeasurementMode(mode) {
  if (!measureMeta[mode]) return;
  spatialState.activeMode = mode;
  resetCurrentMeasurement();
  if (spatialState.map) spatialState.map.closePopup();
  spatialState.selectedFeatureId = null;
  document.querySelectorAll(".measure-mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.measureMode === mode);
  });
  const meta = measureMeta[mode];
  const message = meta.type === "point"
    ? `${meta.label}：先選擇高程套用目標，再點擊地圖；高程取自 UAV 實測 DSM／災前 DEM（依「高程資料來源」）。`
    : mode === "profile" ? `${meta.label}：沿壩體橫向或河道縱向連續點選，完成後按「完成量測」，右側顯示 09/30、09/20 與災前三條剖面。`
    : `${meta.label}：在衛星影像上連續點選，完成後按「完成量測」。`;
  setMapStatus(message);
  renderMapLegend();
  renderDrawnLayerList();
}

function clearSpatialMeasurements() {
  resetCurrentMeasurement();
  spatialState.drawnLayers.forEach((feature) => spatialState.map && spatialState.map.removeLayer(feature.layer));
  spatialState.drawnLayers = [];
  spatialState.selectedFeatureId = null;
  spatialState.result = {
    landslideArea: 0,
    damFootprintArea: 0,
    damWidth: 0,
    damLength: 0,
    channelSlopeDistance: 0,
    lastElevation: 0
  };
  spatialState.demOverride = null;
  if (typeof gis3dSchedule === "function") gis3dSchedule();
  document.querySelector("#demDiffPanel").innerHTML = "";
  document.querySelector("#profilePanel").innerHTML = "";
  renderSpatialResults();
  setMapStatus("已清除量測圖形。請重新選擇量測項目後點選地圖。");
}

function syncSpatialEstimatesToForm(options = {}) {
  const { force = false } = options;
  const estimate = getSpatialEstimates();
  const mapping = [
    ["landslideArea", estimate.AL],
    ["landslideVolume", estimate.VL],
    ["damVolume", estimate.VD],
    ["damHeight", estimate.HDmin],
    ["damWidth", estimate.WD],
    ["damLength", estimate.LDTop],
    ["channelSlope", estimate.S]
  ];
  let synced = 0;
  mapping.forEach(([field, value]) => {
    if (form.elements[field] && Number.isFinite(value) && value > 0) {
      const current = Number(form.elements[field].value);
      const next = field === "channelSlope" ? value.toFixed(4) : value.toFixed(field === "damHeight" || field === "damWidth" || field === "damLength" ? 1 : 0);
      if (force || !Number.isFinite(current) || current <= 0 || form.elements[field].value !== next) {
        form.elements[field].value = next;
        synced += 1;
      }
    }
  });
  if (synced > 0) compute();
  return synced;
}

function autoImportSpatialEstimates(reason = "空間量測") {
  const synced = syncSpatialEstimatesToForm();
  if (synced > 0) {
    setMapStatus(`${reason}已直接匯入調查參數，共更新 ${synced} 個欄位。請檢核厚度、高程與形狀係數是否符合現地資料。`);
  }
}

function applySpatialEstimates() {
  const synced = syncSpatialEstimatesToForm({ force: true });
  if (synced > 0) {
    setMapStatus(`已同步至調查參數，共更新 ${synced} 個欄位。請檢核厚度、高程與形狀係數是否符合現地資料。`);
  } else {
    setMapStatus("目前尚無可同步的空間量測成果；請先圈繪或輸入高程、厚度與形狀係數。");
  }
}

function addMatayanReference() {
  if (!spatialState.map || !window.L) return;
  spatialState.map.setView([matayanLocation.lat, matayanLocation.lng], matayanLocation.zoom);
  const marker = L.marker([matayanLocation.lat, matayanLocation.lng], { interactive: false }).addTo(spatialState.map);
  marker.bindPopup(`
    <div class="spatial-popup">
      <b>${matayanLocation.name}</b>
      <span>公開座標：23.6995, 121.2955</span>
      <span>案例值可由右上角「馬太鞍溪堰塞湖案例」套用。</span>
    </div>
  `).openPopup();
  addDrawnFeature({ mode: "elevationPoint", label: "馬太鞍溪案例定位", valueLabel: "23.6995, 121.2955", layer: marker, color: "#0f6e82" });
  spatialState.result.landslideArea = matayanPreset.landslideArea;
  spatialState.result.damWidth = matayanPreset.damWidth;
  spatialState.result.damLength = matayanPreset.damLength;
  spatialState.result.channelSlopeDistance = 1000;
  document.querySelector("#crestElevation").value = 1139;
  document.querySelector("#riverbedElevation").value = 939;
  document.querySelector("#slopeUpElevation").value = 1053;
  document.querySelector("#slopeDownElevation").value = 939;
  renderSpatialResults();
  autoImportSpatialEstimates("馬太鞍溪案例參考值");
  setMapStatus("已定位馬太鞍溪堰塞湖，並將案例參考值直接匯入調查參數。若要作為正式成果，請以最新影像重新圈繪。");
}

function initSpatialMap() {
  const mapEl = document.querySelector("#satelliteMap");
  if (!mapEl) return;
  renderSpatialResults();
  if (!window.L) {
    setMapStatus("無法載入線上地圖元件。請確認可連線到 Leaflet CDN 後重新整理。");
    return;
  }
  spatialState.map = L.map(mapEl, { doubleClickZoom: false }).setView([matayanLocation.lat, matayanLocation.lng], matayanLocation.zoom);
  spatialState.baseLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  });
  spatialState.baseLayers.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });
  spatialState.activeBaseLayer = spatialState.baseLayers.satellite.addTo(spatialState.map);
  spatialState.map.on("click", handleMapClick);
  spatialState.map.on("dblclick", finishMeasurement);
  spatialState.map.on("moveend", updateCopernicusLinks);
  updateCopernicusLinks();
  setMeasurementMode("landslide");
  initSentinelHubPanel();
  setTimeout(gisS2Init, 0);        // 等整支程式載入完成（gisS2 等宣告在檔案後段）
}

function tagClass(level) {
  if (["穩定", "暫無風險", "低", "較低"].includes(level)) return "ok";
  if (["過渡區", "低風險", "中"].includes(level)) return "warn";
  if (["不穩定", "高風險", "極高風險", "高", "較高"].includes(level)) return "danger";
  return "neutral";
}

function dbiClass(value) {
  if (!Number.isFinite(value)) return "資料不足";
  if (value < 2.75) return "穩定";
  if (value > 3.08) return "不穩定";
  return "過渡區";
}

function hdsiClass(value) {
  if (!Number.isFinite(value)) return "資料不足";
  if (value < 5.74) return "不穩定";
  if (value > 7.44) return "穩定";
  return "過渡區";
}

function signClass(value) {
  if (!Number.isFinite(value)) return "資料不足";
  return value < 0 ? "不穩定" : "穩定";
}

function exposureLevel(value, waterDepth, protectedHeight) {
  if (value === "high") return "高";
  if (value === "medium") return waterDepth >= protectedHeight ? "高" : "中";
  return waterDepth >= protectedHeight ? "中" : "低";
}

function riskLevel(dangerHigh, exposure) {
  if (!dangerHigh && exposure === "低") return "暫無風險";
  if (!dangerHigh && exposure === "中") return "低風險";
  if (!dangerHigh && exposure === "高") return "高風險";
  if (dangerHigh && exposure === "低") return "低風險";
  if (dangerHigh && exposure === "中") return "高風險";
  return "極高風險";
}

function recommendationFor(risk) {
  const map = {
    "暫無風險": ["定期觀(監)測", "無", "無"],
    "低風險": ["即時觀(監)測", "河道管制", "可及性低者無；可及性高者低"],
    "高風險": ["即時觀(監)測", "達警戒時撤離", "中"],
    "極高風險": ["即時觀(監)測", "緊急撤離", "高"]
  };
  return map[risk] || ["資料不足", "資料不足", "資料不足"];
}

function compute() {
  const AD = num("catchmentArea");
  const VL = num("landslideVolume");
  const VD = num("damVolume");
  const H = num("damHeight");
  const W = num("damWidth");
  const L = num("damLength");
  const S = num("channelSlope");
  const VW = num("waterVolume");
  const TcHr = num("breachTime");
  const Bw = num("riverWidth");
  const velocity = num("flowVelocity");
  const Hpo = num("protectedHeight");

  const dbi = log10((AD * H) / VD);
  const ahvDis = -2.13 * log10(AD) - 4.08 * log10(H) + 2.94 * log10(VD) + 4.09;
  const ahwlDis = -2.62 * log10(AD) - 4.67 * log10(H) + 4.57 * log10(W) + 2.67 * log10(L) + 8.26;
  const ahvLog = -4.48 * log10(AD) - 9.31 * log10(H) + 6.61 * log10(VD) + 6.39;
  const ahwlLog = -2.22 * log10(AD) - 3.76 * log10(H) + 3.17 * log10(W) + 2.85 * log10(L) + 5.93;
  const hdsi = log10(VL / ((AD / 1_000_000) * S));

  const qpCosta = 672 * Math.pow(VW / 1_000_000, 0.56);
  const qpHeightVolume = 181 * Math.pow(H * (VW / 1_000_000), 0.43);
  const qpCenderelli = 3.4 * Math.pow(VW, 0.46);
  const qpUnitHydrograph = TcHr > 0 ? (2 * VW) / (TcHr * 3600) : NaN;
  const qpSelected = Math.max(qpCosta, qpHeightVolume, qpCenderelli, qpUnitHydrograph);
  const waterDepth = Bw * velocity > 0 ? qpSelected / (Bw * velocity) : NaN;
  const hasCoreData = AD > 0 && VD > 0 && H > 0 && W > 0 && L > 0 && S > 0 && VW > 0;

  const stabilityRows = [
    ["DBI", dbi, dbiClass(dbi), "DBI < 2.75 穩定；DBI > 3.08 不穩定"],
    ["AHV_Dis", ahvDis, signClass(ahvDis), "小於 0 判定不穩定"],
    ["AHWL_Dis", ahwlDis, signClass(ahwlDis), "小於 0 判定不穩定"],
    ["AHV_Log", ahvLog, signClass(ahvLog), "小於 0 判定不穩定"],
    ["AHWL_Log", ahwlLog, signClass(ahwlLog), "小於 0 判定不穩定"],
    ["HDSI", hdsi, hdsiClass(hdsi), "HDSI < 5.74 不穩定；HDSI > 7.44 穩定"]
  ];

  const unstableCount = hasCoreData ? stabilityRows.filter((row) => row[2] === "不穩定").length : 0;
  const dangerHigh = hasCoreData ? unstableCount >= 1 || dbiClass(dbi) === "過渡區" : false;
  const dangerLevel = hasCoreData ? (dangerHigh ? "較高" : "較低") : "待輸入";
  const exposure = hasCoreData ? exposureLevel(text("exposure"), waterDepth, Hpo) : "待輸入";
  const risk = hasCoreData ? riskLevel(dangerHigh, exposure) : "待評估";
  const [monitoring, alert, urgency] = recommendationFor(risk);

  latest = {
    caseName: text("caseName"),
    trigger: text("trigger"),
    damType: text("damType"),
    AD, VL, VD, H, W, L, S, VW, TcHr, Bw, velocity, Hpo,
    dbi, ahwlDis, hdsi, qpSelected, waterDepth,
    stabilityRows, unstableCount, dangerHigh, dangerLevel, exposure, risk,
    monitoring, alert, urgency
  };

  renderCards([
    ["案件", latest.caseName, latest.damType, "neutral"],
    ["潰壩危險度", dangerLevel, hasCoreData ? `${unstableCount} 項不穩定指標` : "請先輸入壩體參數", tagClass(dangerLevel)],
    ["保全危害度", exposure, hasCoreData ? `估算水深 ${fmt(waterDepth, 1)} m` : "請先輸入蓄水與下游參數", tagClass(exposure)],
    ["致災風險", risk, `工程急迫性：${urgency}`, tagClass(risk)]
  ]);

  stabilityResults.innerHTML = stabilityRows.map(([name, value, cls, note]) => rowHtml(name, fmt(value), cls, note)).join("");
  hydroResults.innerHTML = [
    ["Costa(1985)", qpCosta, "洪峰流量", "Qp = 672 Vw^0.56"],
    ["H-V 經驗式", qpHeightVolume, "洪峰流量", "Qp = 181(Hd Vw)^0.43"],
    ["Cenderelli(2000)", qpCenderelli, "洪峰流量", "Qp = 3.4 Vw^0.46"],
    ["三角形單位歷線", qpUnitHydrograph, "洪峰流量", "Qp = 2Vw/Tc"],
    ["代表斷面水深", waterDepth, waterDepth >= Hpo ? "可能影響保全" : "低於保全高程差", "hp = Qp / Bw / vw"]
  ].map(([name, value, cls, note]) => rowHtml(name, `${fmt(value, 0)} ${name.includes("水深") ? "m" : "m³/s"}`, cls, note)).join("");

  renderRiskMatrix(exposure, dangerHigh);
  renderDashboard();
  renderExpertFindings();
  renderModel3dAnalysis();
  renderReport();
  renderAiSummary();
  renderStorageAnalysis();
}

function rowHtml(name, value, cls, note) {
  return `
    <div class="row">
      <div><b>${name}</b><br><small>${note}</small></div>
      <strong>${value}</strong>
      <span class="tag ${tagClass(cls)}">${cls}</span>
    </div>
  `;
}

function renderCards(cards) {
  summaryCards.innerHTML = cards.map(([label, value, note, cls]) => `
    <div class="card">
      <strong>${label}</strong>
      <b>${value}</b>
      <span class="tag ${cls}">${note}</span>
    </div>
  `).join("");
}

function renderRiskMatrix(exposure, dangerHigh) {
  document.querySelectorAll(".matrix span").forEach((cell) => cell.classList.remove("active"));
  const dangerKey = dangerHigh ? "high" : "low";
  const exposureKey = exposure === "高" ? "high" : exposure === "中" ? "mid" : "low";
  const activeCell = document.querySelector(`[data-cell="${exposureKey}-${dangerKey}"]`);
  if (activeCell) activeCell.classList.add("active");

  if (latest.risk === "待評估") {
    recommendation.innerHTML = `
      <h4>待評估：${latest.caseName}</h4>
      <p>請先輸入壩體幾何、上游集水區、河床坡降、蓄水體積與下游代表斷面等核心資料，再進行潰壩危險度與保全危害度判讀。</p>
    `;
  } else {
    recommendation.innerHTML = `
      <h4>${latest.risk}：${latest.caseName}</h4>
      <p>誘發原因為「${latest.trigger}」，目前以「${latest.damType}」進行緊急初判。建議採取 <b>${latest.monitoring}</b>，警戒作為為 <b>${latest.alert}</b>，工程急迫性評估為 <b>${latest.urgency}</b>。</p>
      <p>若 DBI 雖顯示穩定，但 AHWL 或其他指標出現不穩定，應保守納入較高潰壩危險度，並同步檢討滲流破壞、劇烈溢流沖刷與下游複合型土砂災害。</p>
    `;
  }
}

function renderDashboard() {
  document.querySelector("#caseHeadline").textContent = latest.caseName;
  document.querySelector("#caseLead").textContent = latest.AD > 0
    ? `${latest.trigger}誘發之${latest.damType}，上游集水區面積 ${fmt(latest.AD / 1_000_000, 1)} km²，壩高 ${fmt(latest.H, 0)} m，蓄水體積 ${fmt(latest.VW / 1_000_000, 1)} 百萬 m³。`
    : "請先輸入案件名稱與核心調查參數，或從右上角案例選擇套用馬太鞍溪堰塞湖案例。";
  document.querySelector("#riskStamp").textContent = latest.risk;
  document.querySelector("#surveyProgress").style.width = `${surveyCompleteness()}%`;

  document.querySelector("#decisionDigest").innerHTML = `
    <div><span>DBI</span><b>${fmt(latest.dbi)} / ${dbiClass(latest.dbi)}</b></div>
    <div><span>AHWL_Dis</span><b>${fmt(latest.ahwlDis)} / ${signClass(latest.ahwlDis)}</b></div>
    <div><span>洪峰流量</span><b>${fmt(latest.qpSelected, 0)} m³/s</b></div>
    <div><span>處置建議</span><b>${latest.alert}</b></div>
  `;
}

function renderExpertFindings() {
  if (latest.risk === "待評估") {
    expertFindings.innerHTML = `
      <article class="finding">
        <strong>1. 先建立案件名稱</strong>
        <p>可自行輸入任一堰塞湖名稱；馬太鞍溪僅作為示範案例，可由右上角案例選擇套用。</p>
      </article>
      <article class="finding">
        <strong>2. 先補齊核心參數</strong>
        <p>至少需壩體高度、長度、寬度、壩體體積、上游集水區、河床坡降與蓄水體積，才能進行安定性初判。</p>
      </article>
      <article class="finding">
        <strong>3. 再判斷潰壩情境</strong>
        <p>輸入資料後系統會交叉檢核 DBI、AHV、AHWL 與 HDSI，並提出保守潰壩型態情境。</p>
      </article>
      <article class="finding">
        <strong>4. 最後確認保全對象</strong>
        <p>下游河寬、流速與保全對象高程差會影響水位初估與撤離警戒建議。</p>
      </article>
    `;
    return;
  }

  const stabilityView = latest.unstableCount > 0
    ? `DBI 與 HDSI 需搭配 AHWL/AHV 判別式交叉檢核；目前已有 ${latest.unstableCount} 項指標指向不穩定，壩體破壞機制不宜只以單一穩定指標下結論。`
    : "目前主要安定性指標未顯示明確不穩定，但仍需持續追蹤水位、壩頂溢流與滲流跡象。";
  const failureMode = latest.dangerHigh
    ? "建議以劇烈溢流沖刷、滲流破壞或局部驟然破壞作為保守情境，避免低估下游洪峰與土砂輸移。"
    : "可先以緩慢溢流沖刷情境追蹤，但降雨入流增加時仍須重新推估洪峰與潰壩歷時。";
  const exposureView = latest.exposure === "高"
    ? `估算代表水深 ${fmt(latest.waterDepth, 1)} m 已足以影響保全對象或重要設施，應優先確認下游聚落、道路、橋梁與河床活動。`
    : `保全危害度暫為「${latest.exposure}」，仍建議以最新地形與水位成果更新洪水影響廊道。`;

  expertFindings.innerHTML = `
    <article class="finding">
      <strong>1. 成因與材料判釋</strong>
      <p>${latest.trigger}誘發之${latest.damType}，壩體材料可能具粒徑分布不均與結構鬆散特性，需優先確認壩頂溢流點與滲流出水。</p>
    </article>
    <article class="finding">
      <strong>2. 壩體安定性</strong>
      <p>${stabilityView}</p>
    </article>
    <article class="finding">
      <strong>3. 潰壩型態情境</strong>
      <p>${failureMode}</p>
    </article>
    <article class="finding">
      <strong>4. 下游保全與決策</strong>
      <p>${exposureView} 本輪建議：${latest.monitoring}、${latest.alert}、工程急迫性 ${latest.urgency}。</p>
    </article>
  `;
}

function surveyCompleteness() {
  const fields = ["caseName", "catchmentArea", "landslideArea", "landslideVolume", "damVolume", "damHeight", "damWidth", "damLength", "channelSlope", "waterVolume", "breachTime", "riverWidth", "flowVelocity", "protectedHeight"];
  const filled = fields.filter((field) => String(form.elements[field].value || "").trim() !== "").length;
  return Math.round((filled / fields.length) * 100);
}

function renderReport() {
  const storageLine = storageState
    ? `\n補充、庫容剖面情境\n目前情境水位約 ${fmt(storageState.level, 1)} m，估算庫容約 ${fmt(storageState.storage10k, 1)} 萬 m³，距溢流口約 ${fmt(storageState.freeboard, 1)} m；可作為 Vw 與溢流警戒情境之校核。`
    : "";
  const modelLine = model3dReportEnabled && model3dState
    ? `\n補充、3D 模型資料\n已登錄「${model3dState.name || "未命名 3D 模型"}」，資料型態為 ${model3dState.type || "待填"}，登錄完整度 ${model3dState.score}%（不代表高程精度）；用途為 ${model3dState.purpose || "地形展示"}。資料日期／年代：${model3dState.date || "待填"}；高程基準：${model3dState.datum || "待填"}。${model3dState.evidenceLimit}`
    : "";
  reportText.value = `【${latest.caseName}｜堰塞湖緊急調查與風險評估摘要】

一、案件概況
本案研判為${latest.trigger}誘發之${latest.damType}。目前輸入之崩塌面積約 ${fmt(num("landslideArea") / 10000, 1)} ha，崩塌體積約 ${fmt(latest.VL, 0)} m³；壩體體積約 ${fmt(latest.VD, 0)} m³，壩高約 ${fmt(latest.H, 0)} m，壩寬約 ${fmt(latest.W, 0)} m，壩長約 ${fmt(latest.L, 0)} m。

二、安定性與潰壩危險度
DBI = ${fmt(latest.dbi)}，AHWL_Dis = ${fmt(latest.ahwlDis)}，HDSI = ${fmt(latest.hdsi)}。綜合 ${latest.unstableCount} 項不穩定指標，潰壩危險度判定為「${latest.dangerLevel}」。

三、下游保全危害度
以蓄水體積 ${fmt(latest.VW, 0)} m³ 與潰壩歷時 ${fmt(latest.TcHr, 1)} hr 進行洪峰流量初估，代表洪峰流量約 ${fmt(latest.qpSelected, 0)} m³/s，代表斷面水深約 ${fmt(latest.waterDepth, 1)} m；保全危害度判定為「${latest.exposure}」。

四、初步致災風險與處置建議
依「潰壩危險度 × 保全危害度」矩陣，本案初步致災風險為「${latest.risk}」。建議採取 ${latest.monitoring}；警戒作為為 ${latest.alert}；工程急迫性為 ${latest.urgency}。${storageLine}${modelLine}${typeof fanbReportLines === "function" && fanbReportLines().length ? `\n補充、林保署即時水情（介接）\n${fanbReportLines().map((x) => `・${x}`).join("\n")}` : ""}${typeof spatialBasisLines === "function" && spatialBasisLines().length ? `\n補充、空間研判依據（Sentinel-2／實測 DSM／3D 模型）\n${spatialBasisLines().map((x) => `・${x}`).join("\n")}` : ""}${typeof monState !== "undefined" && monState ? monitoringReportSection() : ""}`;
}

function renderAiSummary() {
  aiSummary.innerHTML = `
    <p><b>風險主軸：</b>${latest.caseName} 的 DBI 可能顯示壩體具一定穩定性，但 AHWL 系列若出現不穩定，仍應以高潰壩危險度進行保守管理。</p>
    <p><b>監測重點：</b>優先追蹤壩頂溢流、滲流出水、壩體裂縫、蓄水位變化、下游河床沖刷與降雨入流條件。</p>
    <p><b>決策建議：</b>在外業資料未補齊前，建議維持 ${latest.monitoring}，並依 ${latest.alert} 原則辦理；若後續雨量或水位上升，應即時更新洪峰流量與保全對象影響範圍。</p>
    ${typeof monState !== "undefined" && monState && monState.digest ? `<p><b>監測現況（${monState.digest.roc_month} ${monState.digest.kind}）：</b>${(monState.digest.conclusions || []).filter((c) => /綜合研判|SAR|新生/.test(c)).map((c) => c.replace(/</g, "&lt;")).join(" ")}</p>` : ""}
    ${typeof monState !== "undefined" && monState && monState.items && monState.items.length ? `<p class="warn-text"><b>異常通報：</b>${monState.items.length} 件，請至「通報報告」頁查看與回報。</p>` : ""}
  `;
  if (aiReply && !aiReply.dataset.locked) {
    aiReply.innerHTML = `<p class="ai-placeholder">輸入問題後按「產生專家回覆」，系統會依目前參數即時生成回覆。</p>`;
  }
}

function keyMetricLines() {
  const lines = [
    `案件：${latest.caseName}`,
    `風險：${latest.risk}；潰壩危險度 ${latest.dangerLevel}；保全危害度 ${latest.exposure}`,
    `壩體：HDmin ${fmt(latest.H, 1)} m、WD ${fmt(latest.W, 1)} m、LDTop ${fmt(latest.L, 1)} m、VD ${fmt(latest.VD, 0)} m³`,
    `崩塌：AL ${fmt(num("landslideArea"), 0)} m²、VL ${fmt(latest.VL, 0)} m³；河床坡降 S ${fmt(latest.S, 4)} m/m`,
    `水理：蓄水量 ${fmt(latest.VW, 0)} m³、估算洪峰 ${fmt(latest.qpSelected, 0)} m³/s、代表水深 ${fmt(latest.waterDepth, 1)} m`
  ];
  if (storageState) {
    lines.push(`庫容情境：水位 ${fmt(storageState.level, 1)} m、庫容 ${fmt(storageState.storage10k, 1)} 萬 m³、距溢流口 ${fmt(storageState.freeboard, 1)} m`);
  }
  if (model3dState) {
    lines.push(`3D 模型：${model3dState.name || "未命名"}，${model3dState.type || "資料型態待填"}，登錄完整度 ${model3dState.score}%（不代表高程精度）`);
  }
  if (typeof spatialBasisLines === "function") spatialBasisLines().forEach((x) => lines.push(`空間研判：${x}`));
  if (typeof fanbReportLines === "function") fanbReportLines().forEach((x) => lines.push(`林保署即時：${x}`));
  return lines;
}

function missingDataAdvice() {
  const checks = [
    ["上游集水區面積 AD", latest.AD],
    ["崩塌面積 AL", num("landslideArea")],
    ["崩塌體積 VL", latest.VL],
    ["壩體體積 VD", latest.VD],
    ["壩高 HDmin", latest.H],
    ["壩寬 WD", latest.W],
    ["壩長 LDTop", latest.L],
    ["河床坡降 S", latest.S],
    ["蓄水體積 VW", latest.VW],
    ["代表河寬 Bw", latest.Bw],
    ["代表流速 vw", latest.velocity],
    ["保全高程差 Hpo", latest.Hpo]
  ];
  return checks.filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([label]) => label);
}

function generateExpertReply(question = "") {
  if (latest.risk === "待評估") {
    return `【AI 專家回復｜待評估】\n目前核心資料仍不足，尚不建議直接下致災風險結論。請優先補齊壩體幾何、壩體體積、集水區面積、河床坡降、蓄水體積與下游代表斷面資料。\n\n建議先完成：\n1. 於空間研判圈繪 AL、壩體足跡，並量測 WD、LDTop、代表河段長度。\n2. 以點選高程或既有 DEM 補入壩頂/溢流點、原河床、上下游河床高程。\n3. 回到風險演算檢核 DBI、AHV/AHWL、HDSI 與洪峰水位。`;
  }

  const q = question.toLowerCase();
  const missing = missingDataAdvice();
  const unstable = latest.stabilityRows.filter((row) => row[2] === "不穩定").map((row) => row[0]);
  const controlText = latest.risk === "極高風險" || latest.risk === "高風險"
    ? `建議依「${latest.alert}」原則辦理，並同步設置河道、橋梁、道路與可及河床活動管制。`
    : `目前可先採「${latest.monitoring}」與河道警戒管制，但若雨量、水位或滲流跡象升高，應立即重算並提高應變層級。`;
  const uncertaintyText = missing.length
    ? `目前仍需補強的資料包括：${missing.slice(0, 6).join("、")}${missing.length > 6 ? "等" : ""}。`
    : "目前核心參數已具備初判條件，但仍建議用最新 UAV 正射、DSM/DEM 差分與現地水位觀測校核。";
  const failureText = unstable.length
    ? `安定性指標中 ${unstable.join("、")} 指向不穩定或需保守看待，應把溢流沖刷、滲流破壞與局部潰口擴大列入情境。`
    : "目前安定性指標未全部指向明確失穩，但堰塞壩材料鬆散且水位會隨降雨快速改變，仍應採動態監測。";

  let focus = "綜合判斷";
  let body = `綜合目前輸入參數，本案初步致災風險為「${latest.risk}」，潰壩危險度為「${latest.dangerLevel}」，保全危害度為「${latest.exposure}」。${failureText} ${controlText}`;

  if (q.includes("撤離") || q.includes("管制") || q.includes("警戒")) {
    focus = "撤離與管制作為";
    body = `${controlText} 若下游存在聚落、道路、橋梁或施工/遊憩活動，應優先建立警戒水位、雨量門檻與通報窗口；高風險以上情境不建議等待壩體明顯破壞後才啟動撤離。`;
  } else if (q.includes("不確定") || q.includes("資料") || q.includes("補充")) {
    focus = "資料缺口與不確定性";
    body = `${uncertaintyText} 尤其 VD、HDmin、VW、S 與下游 Bw/vw 會直接影響安定性與洪峰水位判斷，建議以 UAV、衛星影像、現地測距及 DEM 剖面交叉確認。`;
  } else if (q.includes("調查") || q.includes("監測") || q.includes("下一步")) {
    focus = "現地調查與監測";
    body = `下一步建議先完成壩頂溢流點、滲流出水、裂縫、蓄水位與下游沖刷點位巡查；同時用空間研判更新 AL、VD、WD、LDTop 與 S，並至少建立雨量、水位、影像三類監測。`;
  } else if (q.includes("簡報") || q.includes("長官") || q.includes("決策")) {
    focus = "決策簡報口徑";
    body = `可向決策端說明：本案目前判定為「${latest.risk}」，主要控制因子為壩體幾何、蓄水量與下游保全暴露。短期策略是 ${latest.monitoring}、${latest.alert}，工程急迫性為「${latest.urgency}」。`;
  }

  return `【AI 專家回復｜${focus}】\n${body}\n\n關鍵依據：\n- ${keyMetricLines().join("\n- ")}\n- 處置建議：${latest.monitoring}；警戒作為：${latest.alert}；工程急迫性：${latest.urgency}\n\n專業提醒：本回覆為依調查參數與內建判釋規則產生的專家輔助文字，正式決策仍需搭配現地觀測、最新地形資料與主管機關應變程序。`;
}

function renderExpertReply(question = "") {
  const reply = generateExpertReply(question || aiQuestion?.value || "");
  if (!aiReply) return;
  aiReply.dataset.locked = "true";
  aiReply.innerHTML = reply
    .split("\n")
    .map((line) => line.trim() ? `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : `<br>`)
    .join("");
}

function loadPreset(preset) {
  Object.entries(preset).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  compute();
}

function loadCustomBlank() {
  Object.keys(matayanPreset).forEach((key) => {
    if (!form.elements[key]) return;
    if (form.elements[key].type === "number") form.elements[key].value = key === "breachTime" ? 2 : 0;
    else if (key === "caseName") form.elements[key].value = "自訂堰塞湖案件";
  });
  form.elements.trigger.value = "降雨";
  form.elements.damType.value = "崩滑型堰塞壩";
  form.elements.exposure.value = "medium";
  compute();
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));
  document.querySelector("#pageTitle").textContent = pageTitles[pageId] || "案件儀表板";
  const terrainFrame = document.querySelector('#terrainFrame');
  if (pageId === 'model3d' && terrainFrame && !terrainFrame.getAttribute('src')) terrainFrame.src = terrainFrame.dataset.src;
  terrainFrame?.contentWindow?.postMessage({type: 'terrain-visibility', active: pageId === 'model3d'}, location.origin);
  if (pageId === 'model3d' && typeof gis3dSchedule === 'function') gis3dSchedule();
  if (pageId === 'fanb' && typeof fanbShow === 'function') setTimeout(fanbShow, 0);   // 延後：網址直接開 #fanb 時程式尚未載入完
  if (pageTitles[pageId] && location.hash !== `#${pageId}`) history.replaceState(null, '', `#${pageId}`);
  if (pageId === "gis" && spatialState.map) {
    setTimeout(() => spatialState.map.invalidateSize(), 120);
  }
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    inputs: Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el.value])),
    assessment: latest,
    terrainModel: model3dState
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${latest.caseName || "landslide-dam"}-assessment.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function handleSpatialEstimateInput() {
  renderSpatialResults();
  autoImportSpatialEstimates("推估條件調整後，");
}

function handleStorageInput(event) {
  if (event?.target?.id === "currentWaterLevel") {
    document.querySelector("#waterLevelSlider").value = event.target.value;
  }
  if (event?.target?.id === "waterLevelSlider") {
    document.querySelector("#currentWaterLevel").value = event.target.value;
  }
  renderStorageAnalysis();
  renderReport();
}

function applyStorageToSurvey() {
  renderStorageAnalysis();
  if (!storageState || !form.elements.waterVolume) return;
  form.elements.waterVolume.value = storageState.storageM3.toFixed(0);
  compute();
  showPage("risk");
}

function setElevationTarget(target) {
  const select = document.querySelector("#elevationTarget");
  if (select && elevationTargetLabels[target]) select.value = target;
}

function selectSpatialToolFromParam(fieldName) {
  const link = paramSpatialLinks[fieldName];
  document.querySelectorAll(".param-field").forEach((field) => field.classList.remove("spatial-linked"));
  const control = form.elements[fieldName];
  if (control?.closest) control.closest(".param-field")?.classList.add("spatial-linked");
  if (!link) return;
  if (link.target) setElevationTarget(link.target);
  setMeasurementMode(link.mode);
  const label = control?.closest(".param-field")?.textContent?.replace(/\s+/g, " ").trim() || fieldName;
  setMapStatus(`已依調查參數「${label.slice(0, 28)}」同步選取空間研判工具。切換到空間研判即可直接圈繪或點選高程。`);
}

document.querySelector("#dateDisplay").textContent = new Date().toLocaleDateString("zh-TW", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showPage(item.dataset.page));
});

document.querySelector(".ai-fab").addEventListener("click", () => showPage("ai"));
form.addEventListener("input", compute);
form.addEventListener("change", compute);
document.querySelector("#loadMatayan").addEventListener("click", () => {
  const preset = document.querySelector("#casePreset").value;
  if (preset === "matayan") loadPreset(matayanPreset);
  else loadCustomBlank();
});
document.querySelector("#casePreset").addEventListener("change", (event) => {
  if (event.target.value === "matayan") loadPreset(matayanPreset);
  else loadCustomBlank();
});
document.querySelector("#clearForm").addEventListener("click", () => {
  document.querySelector("#casePreset").value = "custom";
  loadCustomBlank();
});
document.querySelector("#printReport").addEventListener("click", () => {
  showPage("report");
  window.print();
});
document.querySelector("#exportData").addEventListener("click", exportData);
document.querySelector("#copyReport").addEventListener("click", async () => {
  await navigator.clipboard.writeText(reportText.value);
  document.querySelector("#copyReport").textContent = "已複製";
  setTimeout(() => (document.querySelector("#copyReport").textContent = "複製摘要"), 1200);
});
["waterLevelSlider", "currentWaterLevel", "lakeBedElevation", "spillwayElevation", "maxStorageVolume", "storageExponent"].forEach((id) => {
  const input = document.querySelector(`#${id}`);
  if (input) input.addEventListener("input", handleStorageInput);
});
document.querySelector("#applyStorageToSurvey").addEventListener("click", applyStorageToSurvey);
["model3dName", "model3dType", "model3dLink", "model3dCrs", "model3dDatum", "model3dResolution", "model3dDate", "model3dPurpose"].forEach((id) => {
  const input = document.querySelector(`#${id}`);
  if (input) input.addEventListener("input", () => {
    renderModel3dAnalysis();
    renderReport();
  });
});
document.querySelector("#apply3dModelToReport").addEventListener("click", apply3dModelToReport);
document.querySelector("#generateAiReply").addEventListener("click", () => renderExpertReply());
document.querySelector("#clearAiQuestion").addEventListener("click", () => {
  aiQuestion.value = "";
  aiReply.dataset.locked = "";
  renderAiSummary();
});
document.querySelector("#copyAiReply").addEventListener("click", async () => {
  await navigator.clipboard.writeText(aiReply.innerText || "");
  document.querySelector("#copyAiReply").textContent = "已複製";
  setTimeout(() => (document.querySelector("#copyAiReply").textContent = "複製回覆"), 1200);
});
document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    aiQuestion.value = button.dataset.aiPrompt;
    renderExpertReply(aiQuestion.value);
  });
});
document.querySelectorAll(".measure-mode").forEach((button) => {
  button.addEventListener("click", () => setMeasurementMode(button.dataset.measureMode));
});
document.querySelector("#finishMeasurement").addEventListener("click", finishMeasurement);
document.querySelector("#clearMeasurement").addEventListener("click", clearSpatialMeasurements);
document.querySelector("#applySpatialEstimates").addEventListener("click", applySpatialEstimates);
document.querySelector("#focusMatayan").addEventListener("click", addMatayanReference);
document.querySelector("#focusCopernicus").addEventListener("click", focusCopernicusView);
document.querySelector("#openCopernicusCurrentTab").addEventListener("click", openCopernicusCurrentTab);
document.querySelector("#drawnLayerList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-feature-id]");
  if (button) focusDrawnFeature(button.dataset.featureId);
});
document.querySelector("#elevationTarget").addEventListener("change", () => {
  if (spatialState.activeMode === "elevationPoint") {
    setMapStatus(`點選高程：目前會套用至「${elevationTargetLabels[elevationTarget()]}」。`);
  }
});
document.querySelector("#basemapSelect").addEventListener("change", (event) => {
  if (!spatialState.map) return;
  if (spatialState.activeBaseLayer) spatialState.map.removeLayer(spatialState.activeBaseLayer);
  spatialState.activeBaseLayer = spatialState.baseLayers[event.target.value].addTo(spatialState.map);
  setMapStatus(event.target.value === "satellite" ? "已切換為衛星影像底圖。" : "已切換為道路地名底圖。");
});
["landslideThickness", "crestElevation", "riverbedElevation", "damShapeFactor", "slopeUpElevation", "slopeDownElevation"].forEach((id) => {
  const input = document.querySelector(`#${id}`);
  if (input) input.addEventListener("input", handleSpatialEstimateInput);
});
[...form.elements].filter((el) => el.name).forEach((el) => {
  el.addEventListener("focus", () => selectSpatialToolFromParam(el.name));
  el.addEventListener("click", () => selectSpatialToolFromParam(el.name));
});

// ---- 空間研判：Sentinel Hub（Copernicus Data Space）可切換日期的衛星影像圖層 ----
// 憑證只存這台瀏覽器的 localStorage，不進原始碼、不進git，符合「不經手使用者密鑰」的規則。
const SH_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const SH_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms";
let shTokenCache = null; // { token, expiresAt }
let shWmsLayer = null;

function getSentinelHubCreds() {
  return {
    clientId: localStorage.getItem("shClientId") || "",
    clientSecret: localStorage.getItem("shClientSecret") || "",
    instanceId: localStorage.getItem("shInstanceId") || "",
  };
}

function setSentinelHubStatus(text, level) {
  const el = document.querySelector("#sentinelHubStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `sentinel-hub-status${level ? ` ${level}` : ""}`;
}

async function getSentinelHubToken() {
  const { clientId, clientSecret } = getSentinelHubCreds();
  if (!clientId || !clientSecret) {
    throw new Error("尚未設定 Client ID / Client Secret，請按「連線設定」輸入。");
  }
  const now = Date.now();
  if (shTokenCache && shTokenCache.expiresAt - 30000 > now) {
    return shTokenCache.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(SH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`OAuth 認證失敗 HTTP ${res.status}，請確認 Client ID / Client Secret 是否正確`);
  }
  const data = await res.json();
  shTokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return shTokenCache.token;
}

const SentinelHubWmsLayer = window.L ? L.TileLayer.WMS.extend({
  createTile(coords, done) {
    const tile = document.createElement("img");
    tile.setAttribute("role", "presentation");
    const url = this.getTileUrl(coords);
    let cancelled = false;
    getSentinelHubToken()
      .then((token) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }))
      .then((res) => {
        if (!res.ok) throw new Error(`影像圖磚讀取失敗 HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objUrl = URL.createObjectURL(blob);
        tile.onload = () => { URL.revokeObjectURL(objUrl); done(null, tile); };
        tile.onerror = () => done(new Error("圖磚解碼失敗"), tile);
        tile.src = objUrl;
      })
      .catch((err) => {
        if (!cancelled) {
          setSentinelHubStatus(`載入失敗：${err.message}`, "danger");
          done(err, tile);
        }
      });
    tile._shCancel = () => { cancelled = true; };
    return tile;
  },
}) : null;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function applySentinelHubLayer() {
  if (!spatialState.map || !SentinelHubWmsLayer) return;
  const { instanceId } = getSentinelHubCreds();
  if (!instanceId) {
    setSentinelHubStatus("尚未設定 Instance ID，請按「連線設定」輸入。", "danger");
    return;
  }
  const dateInput = document.querySelector("#sentinelHubDate");
  const dateStr = dateInput.value || todayIsoDate();
  dateInput.value = dateStr;
  const layerId = document.querySelector("#sentinelHubLayer").value;

  if (shWmsLayer) {
    spatialState.map.removeLayer(shWmsLayer);
    shWmsLayer = null;
  }
  setSentinelHubStatus(`載入中：${dateStr}（${layerId === "TRUE_COLOR" ? "真彩色" : "假色"}）...`, "warn");
  shWmsLayer = new SentinelHubWmsLayer(`${SH_WMS_BASE}/${instanceId}`, {
    layers: layerId,
    format: "image/png",
    transparent: false,
    version: "1.3.0",
    time: `${dateStr}/${dateStr}`,
    maxZoom: 19,
    attribution: "Sentinel-2 &copy; Copernicus / ESA, via Copernicus Data Space Ecosystem",
  });
  let hadTileError = false;
  shWmsLayer.on("tileerror", (e) => {
    hadTileError = true;
    const msg = e.error && /401|403/.test(e.error.message || "")
      ? "認證失敗，請確認 Client ID / Client Secret / Instance ID 是否正確。"
      : `${dateStr} 這天可能沒有可用影像（雲遮或未過境），試試前後幾天。`;
    setSentinelHubStatus(msg, "danger");
  });
  shWmsLayer.on("load", () => {
    if (hadTileError) return;
    setSentinelHubStatus(`已套用：${dateStr}（${layerId === "TRUE_COLOR" ? "真彩色" : "假色"}）`, "ok");
  });
  shWmsLayer.addTo(spatialState.map);
}

const SH_CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search";

async function searchSentinelHubDates() {
  if (!spatialState.map) return;
  const resultsSelect = document.querySelector("#sentinelHubDateResults");
  const searchBtn = document.querySelector("#sentinelHubSearchDates");
  const bounds = spatialState.map.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const end = new Date();
  const start = new Date(end.getTime() - 180 * 24 * 3600 * 1000);
  searchBtn.disabled = true;
  resultsSelect.disabled = true;
  resultsSelect.innerHTML = "<option>搜尋中...</option>";
  setSentinelHubStatus("搜尋過去180天內、目前地圖範圍的可用影像...", "warn");
  try {
    const token = await getSentinelHubToken();
    const res = await fetch(SH_CATALOG_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        bbox,
        datetime: `${start.toISOString()}/${end.toISOString()}`,
        collections: ["sentinel-2-l2a"],
        limit: 100,
      }),
    });
    if (!res.ok) throw new Error(`搜尋失敗 HTTP ${res.status}`);
    const data = await res.json();
    const byDate = new Map();
    (data.features || []).forEach((f) => {
      const date = (f.properties.datetime || "").slice(0, 10);
      const cloud = f.properties["eo:cloud_cover"];
      if (!date) return;
      const prev = byDate.get(date);
      if (!prev || (cloud != null && cloud < prev)) byDate.set(date, cloud);
    });
    const dates = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    if (dates.length === 0) {
      resultsSelect.innerHTML = "<option>過去180天無可用影像</option>";
      setSentinelHubStatus("目前地圖範圍過去180天內查不到Sentinel-2影像，試著縮小/移動地圖範圍再搜尋一次。", "danger");
      return;
    }
    resultsSelect.innerHTML = dates.map(([date, cloud]) =>
      `<option value="${date}">${date}${cloud != null ? `（雲量${Math.round(cloud)}%）` : ""}</option>`
    ).join("");
    resultsSelect.disabled = false;
    setSentinelHubStatus(`找到 ${dates.length} 個可用日期，從下拉選單選一個。`, "ok");
  } catch (err) {
    resultsSelect.innerHTML = "<option>搜尋失敗</option>";
    setSentinelHubStatus(`搜尋可用日期失敗：${err.message}`, "danger");
  } finally {
    searchBtn.disabled = false;
  }
}

document.querySelector("#sentinelHubSearchDates").addEventListener("click", searchSentinelHubDates);
document.querySelector("#sentinelHubDateResults").addEventListener("change", (event) => {
  const date = event.target.value;
  if (!date || date.length !== 10) return;
  document.querySelector("#sentinelHubDate").value = date;
  applySentinelHubLayer();
  document.querySelector("#sentinelHubToggle").textContent = shWmsLayer ? "移除影像圖層" : "套用到地圖";
});

function removeSentinelHubLayer() {
  if (shWmsLayer && spatialState.map) {
    spatialState.map.removeLayer(shWmsLayer);
  }
  shWmsLayer = null;
  setSentinelHubStatus("已移除衛星影像圖層。", null);
}

function initSentinelHubPanel() {
  const dateInput = document.querySelector("#sentinelHubDate");
  if (dateInput && !dateInput.value) dateInput.value = todayIsoDate();
  const { clientId, clientSecret, instanceId } = getSentinelHubCreds();
  document.querySelector("#shClientId").value = clientId;
  document.querySelector("#shClientSecret").value = clientSecret;
  document.querySelector("#shInstanceId").value = instanceId;
  if (clientId && clientSecret && instanceId) {
    setSentinelHubStatus("已設定連線，按「套用到地圖」載入影像。", "ok");
  }
}

document.querySelector("#sentinelHubToggle").addEventListener("click", () => {
  if (shWmsLayer) {
    removeSentinelHubLayer();
    document.querySelector("#sentinelHubToggle").textContent = "套用到地圖";
  } else {
    applySentinelHubLayer();
    document.querySelector("#sentinelHubToggle").textContent = shWmsLayer ? "移除影像圖層" : "套用到地圖";
  }
});
document.querySelector("#sentinelHubDate").addEventListener("change", () => {
  if (shWmsLayer) applySentinelHubLayer();
});
document.querySelector("#sentinelHubLayer").addEventListener("change", () => {
  if (shWmsLayer) applySentinelHubLayer();
});
document.querySelector("#sentinelHubSettingsBtn").addEventListener("click", () => {
  const panel = document.querySelector("#sentinelHubSettings");
  panel.hidden = !panel.hidden;
});
document.querySelector("#shSaveCreds").addEventListener("click", () => {
  localStorage.setItem("shClientId", document.querySelector("#shClientId").value.trim());
  localStorage.setItem("shClientSecret", document.querySelector("#shClientSecret").value.trim());
  localStorage.setItem("shInstanceId", document.querySelector("#shInstanceId").value.trim());
  shTokenCache = null;
  setSentinelHubStatus("已儲存連線設定，按「套用到地圖」試試。", "ok");
});
document.querySelector("#shClearCreds").addEventListener("click", () => {
  ["shClientId", "shClientSecret", "shInstanceId"].forEach((k) => localStorage.removeItem(k));
  document.querySelector("#shClientId").value = "";
  document.querySelector("#shClientSecret").value = "";
  document.querySelector("#shInstanceId").value = "";
  shTokenCache = null;
  removeSentinelHubLayer();
  document.querySelector("#sentinelHubToggle").textContent = "套用到地圖";
  setSentinelHubStatus("已清除連線設定。", null);
});

function monitorEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deriveMonitorAlert(data) {
  if (data.alert?.level) return data.alert;
  const points = data.points || [];
  const red = points.filter((point) => point.level_class === "danger");
  const yellow = points.filter((point) => point.level_class === "warn");
  if (red.length) {
    return {
      level: "red", label: "紅色查證", triggered_points: [...red, ...yellow],
      action: "立即調閱最新光學影像、雨量與水位資料，並評估UAV或現地查證。",
      disclaimer: "警戒為人工查證觸發，不等同已確認災害。"
    };
  }
  if (yellow.length) {
    return {
      level: "yellow", label: "黃色關注", triggered_points: yellow,
      action: "加密追蹤下一期影像，並以光學影像、雨量、水位或UAV交叉查核。",
      disclaimer: "警戒為人工查證觸發，不等同已確認災害。"
    };
  }
  return {
    level: "green", label: "目前無警戒", triggered_points: [],
    action: "維持例行監測。", disclaimer: ""
  };
}

function renderMonitorAlert(element, data) {
  if (!element) return;
  const alert = deriveMonitorAlert(data);
  const thresholds = data.thresholds || {};
  const freshness = data.freshness || {};
  const points = alert.triggered_points || [];
  const isAlert = alert.level === "yellow" || alert.level === "red";
  const thresholdText = alert.level === "red"
    ? `紅色門檻：連續${thresholds.red_run ?? 3}期低於${thresholds.red_db ?? -15} dB，或單期低於${thresholds.red_single_db ?? -20} dB`
    : alert.level === "yellow"
      ? `黃色門檻：連續${thresholds.yellow_run ?? 2}期低於${thresholds.yellow_db ?? -10} dB`
      : `黃色：連續${thresholds.yellow_run ?? 2}期低於${thresholds.yellow_db ?? -10} dB；紅色：連續${thresholds.red_run ?? 3}期低於${thresholds.red_db ?? -15} dB或單期低於${thresholds.red_single_db ?? -20} dB`;
  const pointMarkup = points.length
    ? `<div class="monitor-alert-points">${points.map((point) => `
        <article>
          <strong>${monitorEscapeHtml(point.name)}</strong>
          <span>${monitorEscapeHtml(point.latest)}</span>
          <small>${monitorEscapeHtml(point.reason)}</small>
        </article>`).join("")}</div>`
    : "";
  const staleNote = freshness.status === "stale"
    ? `<p class="monitor-alert-stale">資料已延遲 ${monitorEscapeHtml(freshness.latency_days)} 天，目前警戒不能代表即時現況。</p>`
    : "";

  element.className = `monitor-alert-banner ${alert.level}`;
  element.setAttribute("role", isAlert ? "alert" : "status");
  element.innerHTML = `
    <div class="monitor-alert-heading">
      <span class="monitor-alert-icon" aria-hidden="true">${alert.level === "green" ? "✓" : "!"}</span>
      <div><strong>${monitorEscapeHtml(alert.label)}</strong><small>${monitorEscapeHtml(thresholdText)}</small></div>
      <span class="monitor-alert-pair">${monitorEscapeHtml(freshness.latest_pair || "尚無最新配對")}</span>
    </div>
    ${pointMarkup}
    <p class="monitor-alert-action"><strong>${isAlert ? "建議處置：" : "監測狀態："}</strong>${monitorEscapeHtml(alert.action)}</p>
    ${staleNote}
    ${alert.disclaimer ? `<small class="monitor-alert-disclaimer">${monitorEscapeHtml(alert.disclaimer)}</small>` : ""}
  `;
  element.hidden = false;
}

function renderMonitor() {
  const cardsEl = document.querySelector("#monitorCards");
  const chartsEl = document.querySelector("#monitorCharts");
  const updatedEl = document.querySelector("#monitorUpdated");
  const freshnessEl = document.querySelector("#monitorFreshness");
  const alertEl = document.querySelector("#monitorAlertBanner");
  if (!cardsEl || !chartsEl) return;
  initMonitorLocalPanel();
  fetch("./monitor_status.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      monitorPublishedPoints = data.points || [];
      monitorThresholds = data.thresholds || null;
      if (updatedEl) updatedEl.textContent = `程式處理時間：${data.processed_at || data.updated}`;
      updatedEl && updatedEl.classList.add("monitor-updated");
      const freshness = data.freshness || {};
      const ingest = data.ingest || {};
      if (freshnessEl) {
        const freshnessClass = ["current", "stale", "warning", "no_data"].includes(freshness.status)
          ? freshness.status : "unknown";
        const pairLine = freshness.latest_pair ? `最後配對：${freshness.latest_pair}` : "最後配對：無資料";
        const acquisitionLine = freshness.latest_acquisition
          ? `最後觀測：${freshness.latest_acquisition}（距今 ${freshness.latency_days} 天）`
          : "最後觀測：無資料";
        const ingestLine = ingest.message ? `<small>影像取得：${ingest.message}</small>` : "";
        freshnessEl.className = `monitor-freshness ${freshnessClass}`;
        freshnessEl.innerHTML = `
          <div><span class="monitor-freshness-dot" aria-hidden="true"></span><strong>${freshness.label || "資料狀態未知"}</strong></div>
          <p>${acquisitionLine}　｜　${pairLine}</p>
          <p>${freshness.message || "尚未取得資料新鮮度資訊。"}</p>
          ${ingestLine}
        `;
      }
      renderMonitorAlert(alertEl, data);
      cardsEl.innerHTML = data.points.map((p) => `
        <div class="card">
          <strong>${p.name}</strong>
          <b>${p.latest}</b>
          <span class="tag ${p.level_class}">${p.level}</span>
          <small class="monitor-reason">${p.reason}</small>
        </div>
      `).join("");
      chartsEl.innerHTML = data.points.map((p) => `
        <article class="figure-card monitor-chart-card">
          ${p.data ? `<section class="monitor-interactive-chart" data-monitor-chart data-name="${p.name}" data-src="${p.data}" data-fallback="${p.chart || ""}" aria-label="${p.name}互動式振幅時序圖"><div class="monitor-chart-loading">載入互動圖表…</div></section>` : (p.chart ? `<img src="./${p.chart}" alt="${p.name}振幅時序" />` : "")}
          <div class="monitor-chart-caption">
            <strong>${p.name}</strong>
            <p>${p.note || ""}</p>
            ${p.data ? `<button type="button" class="outline monitor-data-btn" data-name="${p.name}" data-src="${p.data}">查看資料表</button>` : ""}
          </div>
        </article>
      `).join("");
      chartsEl.querySelectorAll(".monitor-data-btn").forEach((btn) => {
        btn.addEventListener("click", () => openMonitorDataModal(btn.dataset.name, btn.dataset.src));
      });
      initMonitorInteractiveCharts(chartsEl);
    })
    .catch((err) => {
      cardsEl.innerHTML = "";
      chartsEl.innerHTML = `<p class="muted-empty">尚未發布監測資料（monitor_status.json 不存在或無法讀取：${err.message}）。請先在本機執行 sar_monitor.py --publish-dir 指向此docs資料夾。</p>`;
    });
}

// ---- SAR監測：本機分析觸發（呼叫run_monitor_server.py，只在localhost開啟時顯示）----
const MONITOR_LOCAL_API = "http://127.0.0.1:8899";

function isLocalMonitorHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function setMonitorLocalLog(text) {
  const log = document.querySelector("#monitorLocalLog");
  if (log) log.textContent = text;
}

function setMonitorLocalButtonsDisabled(disabled) {
  ["#monitorRunBtn", "#monitorPushBtn"].forEach((sel) => {
    const btn = document.querySelector(sel);
    if (btn) btn.disabled = disabled;
  });
}

function callMonitorLocalApi(path, busyText) {
  setMonitorLocalButtonsDisabled(true);
  setMonitorLocalLog(busyText);
  return fetch(`${MONITOR_LOCAL_API}${path}`, { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      setMonitorLocalLog(`${data.ok ? "[完成]" : "[失敗]"}\n${data.log || ""}`);
      return data;
    })
    .catch((err) => {
      setMonitorLocalLog(`[連線失敗] 尚未偵測到本機分析服務。請先在本機執行：\npython run_monitor_server.py\n\n錯誤訊息：${err.message}`);
      return null;
    })
    .finally(() => setMonitorLocalButtonsDisabled(false));
}

function initMonitorLocalPanel() {
  const panel = document.querySelector("#monitorLocalPanel");
  if (!panel || !isLocalMonitorHost()) return;
  panel.hidden = false;
  const runBtn = document.querySelector("#monitorRunBtn");
  const pushBtn = document.querySelector("#monitorPushBtn");
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.dataset.bound = "1";
    runBtn.addEventListener("click", () => {
      callMonitorLocalApi("/run", "正在搜尋新影像、接續HyP3工作並更新趨勢圖...").then((data) => {
        if (data && data.ok) renderMonitor();
      });
    });
  }
  if (pushBtn && !pushBtn.dataset.bound) {
    pushBtn.dataset.bound = "1";
    pushBtn.addEventListener("click", () => {
      callMonitorLocalApi("/push", "推送中...");
    });
  }
}

// ---- SAR監測：新增監測點（純前端，只產生設定檔，不直接執行分析）----
let monitorPublishedPoints = [];
let monitorThresholds = null;
let pendingMonitorPoints = JSON.parse(localStorage.getItem("pendingMonitorPoints") || "[]");

function formatMonitorDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function monitorDateMs(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return NaN;
  return Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)));
}

function monitorSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function monitorAlertLabel(value) {
  const yellow = monitorThresholds?.yellow_db ?? -10;
  const red = monitorThresholds?.red_db ?? -15;
  if (value < red) return { label: "紅色查證", className: "danger" };
  if (value < yellow) return { label: "黃色關注", className: "warn" };
  return { label: "一般範圍", className: "ok" };
}

function initMonitorInteractiveCharts(root) {
  root.querySelectorAll("[data-monitor-chart]").forEach((container) => {
    fetch(`./${container.dataset.src}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows) => buildMonitorInteractiveChart(container, rows))
      .catch((err) => {
        const fallback = container.dataset.fallback;
        container.innerHTML = fallback
          ? `<img src="./${fallback}" alt="${container.dataset.name}振幅時序（靜態備援）" />`
          : `<p class="muted-empty">互動圖表載入失敗：${err.message}</p>`;
      });
  });
}

function buildMonitorInteractiveChart(container, sourceRows) {
  const rows = sourceRows
    .map((row) => ({ ...row, time: monitorDateMs(row.sec_date), diff_dB: Number(row.diff_dB) }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.diff_dB))
    .sort((a, b) => a.time - b.time || a.ref_date.localeCompare(b.ref_date));
  if (!rows.length) throw new Error("沒有可繪製的配對資料");

  container.innerHTML = `
    <div class="monitor-chart-toolbar">
      <div class="monitor-range-buttons" role="group" aria-label="顯示期間">
        <button type="button" class="active" data-range="all">全部</button>
        <button type="button" data-range="365">近一年</button>
        <button type="button" data-range="183">近半年</button>
      </div>
      <button type="button" class="monitor-play-button" aria-pressed="false">▶ 逐期播放</button>
    </div>
    <div class="monitor-chart-viewport">
      <svg class="monitor-chart-svg" viewBox="0 0 720 320" role="img" aria-label="${container.dataset.name}振幅時序互動圖"></svg>
      <div class="monitor-chart-tooltip" hidden></div>
    </div>
    <div class="monitor-chart-detail" aria-live="polite"></div>
  `;

  const svg = container.querySelector(".monitor-chart-svg");
  const viewport = container.querySelector(".monitor-chart-viewport");
  const tooltip = container.querySelector(".monitor-chart-tooltip");
  const detail = container.querySelector(".monitor-chart-detail");
  const playButton = container.querySelector(".monitor-play-button");
  const state = { range: "all", visibleRows: rows, timer: null, playIndex: 0, selectedCircle: null };
  const width = 720;
  const height = 320;
  const margin = { top: 26, right: 28, bottom: 48, left: 58 };

  function updateDetail(row, prefix = "選取點位") {
    const alert = monitorAlertLabel(row.diff_dB);
    detail.innerHTML = `
      <span>${prefix}</span>
      <strong>${row.diff_dB >= 0 ? "+" : ""}${row.diff_dB.toFixed(2)} dB</strong>
      <small>${formatMonitorDate(row.ref_date)} → ${formatMonitorDate(row.sec_date)}</small>
      <em class="${alert.className}">${alert.label}</em>
    `;
  }

  function stopPlayback() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    playButton.textContent = "▶ 逐期播放";
    playButton.setAttribute("aria-pressed", "false");
    svg.querySelectorAll(".playback").forEach((node) => node.classList.remove("playback"));
  }

  function render() {
    stopPlayback();
    svg.replaceChildren();
    const maxTimeAll = Math.max(...rows.map((row) => row.time));
    const cutoff = state.range === "all" ? -Infinity : maxTimeAll - Number(state.range) * 86400000;
    const visible = rows.filter((row) => row.time >= cutoff);
    state.visibleRows = visible;

    const xMinRaw = Math.min(...visible.map((row) => row.time));
    const xMaxRaw = Math.max(...visible.map((row) => row.time));
    const xMin = xMinRaw === xMaxRaw ? xMinRaw - 86400000 : xMinRaw;
    const xMax = xMinRaw === xMaxRaw ? xMaxRaw + 86400000 : xMaxRaw;
    const yellow = monitorThresholds?.yellow_db ?? -10;
    const red = monitorThresholds?.red_db ?? -15;
    const values = visible.map((row) => row.diff_dB).concat([yellow, red]);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const yPadding = Math.max(3, (rawMax - rawMin) * 0.12);
    const yMin = Math.floor((rawMin - yPadding) / 5) * 5;
    const yMax = Math.ceil((rawMax + yPadding) / 5) * 5;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (time) => margin.left + ((time - xMin) / (xMax - xMin)) * plotWidth;
    const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    const grid = monitorSvgElement("g", { class: "monitor-chart-grid" });
    for (let i = 0; i <= 5; i += 1) {
      const value = yMin + ((yMax - yMin) * i) / 5;
      const yy = y(value);
      grid.append(monitorSvgElement("line", { x1: margin.left, x2: width - margin.right, y1: yy, y2: yy }));
      const label = monitorSvgElement("text", { x: margin.left - 10, y: yy + 4, "text-anchor": "end" });
      label.textContent = value.toFixed(0);
      grid.append(label);
    }
    for (let i = 0; i <= 4; i += 1) {
      const time = xMin + ((xMax - xMin) * i) / 4;
      const xx = x(time);
      grid.append(monitorSvgElement("line", { x1: xx, x2: xx, y1: margin.top, y2: height - margin.bottom }));
      const date = new Date(time);
      const label = monitorSvgElement("text", { x: xx, y: height - 22, "text-anchor": "middle" });
      label.textContent = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      grid.append(label);
    }
    svg.append(grid);

    [{ value: yellow, className: "yellow", label: `黃色 ${yellow}dB` }, { value: red, className: "red", label: `紅色 ${red}dB` }].forEach((threshold) => {
      const yy = y(threshold.value);
      svg.append(monitorSvgElement("line", { class: `monitor-threshold ${threshold.className}`, x1: margin.left, x2: width - margin.right, y1: yy, y2: yy }));
      const label = monitorSvgElement("text", { class: `monitor-threshold-label ${threshold.className}`, x: width - margin.right - 4, y: yy - 5, "text-anchor": "end" });
      label.textContent = threshold.label;
      svg.append(label);
    });

    const line = monitorSvgElement("polyline", {
      class: "monitor-series-line",
      points: visible.map((row) => `${x(row.time).toFixed(2)},${y(row.diff_dB).toFixed(2)}`).join(" "),
    });
    svg.append(line);

    const pointsGroup = monitorSvgElement("g", { class: "monitor-series-points" });
    visible.forEach((row, index) => {
      const alert = monitorAlertLabel(row.diff_dB);
      const circle = monitorSvgElement("circle", {
        class: `monitor-point ${alert.className}${index === visible.length - 1 ? " latest" : ""}`,
        cx: x(row.time), cy: y(row.diff_dB), r: 3.5, tabindex: 0,
        role: "button",
        "aria-label": `${formatMonitorDate(row.ref_date)}到${formatMonitorDate(row.sec_date)}，${row.diff_dB.toFixed(2)} dB，${alert.label}`,
      });
      const showTooltip = (event) => {
        tooltip.hidden = false;
        tooltip.textContent = `${formatMonitorDate(row.ref_date)} → ${formatMonitorDate(row.sec_date)}｜${row.diff_dB >= 0 ? "+" : ""}${row.diff_dB.toFixed(2)} dB`;
        const rect = viewport.getBoundingClientRect();
        const px = event?.clientX ? event.clientX - rect.left : (Number(circle.getAttribute("cx")) / width) * rect.width;
        const py = event?.clientY ? event.clientY - rect.top : (Number(circle.getAttribute("cy")) / height) * rect.height;
        tooltip.style.left = `${Math.min(Math.max(px, 80), rect.width - 80)}px`;
        tooltip.style.top = `${Math.max(py - 12, 24)}px`;
        updateDetail(row);
      };
      circle.addEventListener("pointerenter", showTooltip);
      circle.addEventListener("pointermove", showTooltip);
      circle.addEventListener("pointerleave", () => { tooltip.hidden = true; });
      circle.addEventListener("click", () => {
        state.selectedCircle?.classList.remove("selected");
        state.selectedCircle = circle;
        circle.classList.add("selected");
        updateDetail(row, "已固定點位");
      });
      circle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          circle.click();
          showTooltip();
        }
      });
      pointsGroup.append(circle);
    });
    svg.append(pointsGroup);

    const axisLabel = monitorSvgElement("text", { class: "monitor-axis-label", x: 16, y: height / 2, transform: `rotate(-90 16 ${height / 2})`, "text-anchor": "middle" });
    axisLabel.textContent = "核心區－背景（dB）";
    svg.append(axisLabel);
    updateDetail(visible[visible.length - 1], "最新點位");
  }

  container.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      container.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
      state.range = button.dataset.range;
      render();
    });
  });

  playButton.addEventListener("click", () => {
    if (state.timer) {
      stopPlayback();
      return;
    }
    state.playIndex = 0;
    playButton.textContent = "❚❚ 暫停";
    playButton.setAttribute("aria-pressed", "true");
    const circles = [...svg.querySelectorAll(".monitor-point")];
    state.timer = window.setInterval(() => {
      circles.forEach((circle) => circle.classList.remove("playback"));
      const circle = circles[state.playIndex];
      const row = state.visibleRows[state.playIndex];
      if (!circle || !row) {
        stopPlayback();
        return;
      }
      circle.classList.add("playback");
      updateDetail(row, `播放 ${state.playIndex + 1}/${state.visibleRows.length}`);
      state.playIndex += 1;
      if (state.playIndex >= state.visibleRows.length) stopPlayback();
    }, 90);
  });

  render();
}

function openMonitorDataModal(name, src) {
  const modal = document.querySelector("#monitorDataModal");
  const title = document.querySelector("#monitorDataModalTitle");
  const meta = document.querySelector("#monitorDataModalMeta");
  const body = document.querySelector("#monitorDataModalBody");
  if (!modal || !body) return;
  title.textContent = `${name}　振幅資料表`;
  meta.textContent = "載入中...";
  body.innerHTML = "";
  modal.hidden = false;
  fetch(`./${src}`, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((rows) => {
      const sorted = [...rows].sort((a, b) => (a.ref_date < b.ref_date ? 1 : -1));
      const yellow = monitorThresholds ? monitorThresholds.yellow_db : null;
      const red = monitorThresholds ? monitorThresholds.red_db : null;
      meta.textContent = `共 ${sorted.length} 筆配對觀測（依參考期新到舊排序）。紅色＝低於紅色查證門檻${red != null ? `(${red}dB)` : ""}，橙色＝低於黃色關注門檻${yellow != null ? `(${yellow}dB)` : ""}。`;
      body.innerHTML = sorted.map((r) => {
        const cls = red != null && r.diff_dB < red ? "data-row-red"
          : yellow != null && r.diff_dB < yellow ? "data-row-yellow" : "";
        return `<tr class="${cls}"><td>${formatMonitorDate(r.ref_date)}</td><td>${formatMonitorDate(r.sec_date)}</td><td>${r.diff_dB.toFixed(2)}</td></tr>`;
      }).join("");
    })
    .catch((err) => {
      meta.textContent = `讀取失敗：${err.message}`;
    });
}

function closeMonitorDataModal() {
  const modal = document.querySelector("#monitorDataModal");
  if (modal) modal.hidden = true;
}

document.querySelector("#monitorDataModalClose")?.addEventListener("click", closeMonitorDataModal);
document.querySelector("#monitorDataModal")?.addEventListener("click", (e) => {
  if (e.target.id === "monitorDataModal") closeMonitorDataModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMonitorDataModal();
});

function renderPendingPoints() {
  const list = document.querySelector("#pendingPointsList");
  if (!list) return;
  if (pendingMonitorPoints.length === 0) {
    list.innerHTML = `<p class="muted-empty">尚未加入任何待新增監測點。</p>`;
    return;
  }
  list.innerHTML = pendingMonitorPoints.map((p, i) => `
    <div class="card pending-point-card">
      <strong>${p.name}</strong>
      <b>${p.lon.toFixed(6)}, ${p.lat.toFixed(6)}</b>
      <span class="tag neutral">待新增</span>
      <small class="monitor-reason">${p.note || "（無備註）"}</small>
      <button type="button" class="outline remove-pending" data-index="${i}">移除</button>
    </div>
  `).join("");
  list.querySelectorAll(".remove-pending").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingMonitorPoints.splice(Number(btn.dataset.index), 1);
      localStorage.setItem("pendingMonitorPoints", JSON.stringify(pendingMonitorPoints));
      renderPendingPoints();
    });
  });
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelector("#addPointForm")?.addEventListener("submit", (e) => e.preventDefault());

document.querySelector("#addPointToList")?.addEventListener("click", () => {
  const form = document.querySelector("#addPointForm");
  const name = form.pointName.value.trim();
  const lon = parseFloat(form.pointLon.value);
  const lat = parseFloat(form.pointLat.value);
  const note = form.pointNote.value.trim();
  if (!name || Number.isNaN(lon) || Number.isNaN(lat)) {
    alert("請填寫名稱、經度、緯度（經緯度需為數字）。");
    return;
  }
  if (lon < 118 || lon > 123 || lat < 21 || lat > 26) {
    if (!confirm(`座標 (${lon}, ${lat}) 看起來不在台灣本島範圍內，確定要加入嗎？`)) return;
  }
  pendingMonitorPoints.push({ name, lon, lat, note });
  localStorage.setItem("pendingMonitorPoints", JSON.stringify(pendingMonitorPoints));
  renderPendingPoints();
  form.reset();
});

document.querySelector("#downloadPointsJson")?.addEventListener("click", () => {
  if (pendingMonitorPoints.length === 0) {
    alert("待新增清單是空的，請先填表單並按「加入待新增清單」。");
    return;
  }
  const merged = [
    ...monitorPublishedPoints.map((p) => ({ name: p.name, lon: p.lon, lat: p.lat, note: p.note || "" })),
    ...pendingMonitorPoints,
  ];
  downloadTextFile("monitor_points.json", JSON.stringify(merged, null, 2));
});

document.querySelector("#copyAddPointCmd")?.addEventListener("click", async () => {
  if (pendingMonitorPoints.length === 0) {
    alert("待新增清單是空的，請先填表單並按「加入待新增清單」。");
    return;
  }
  const cmds = pendingMonitorPoints.map((p) =>
    `python sar_monitor.py --raw-dir "<HyP3原始資料夾>" --out-dir monitor_output --add-point "${p.name},${p.lon},${p.lat},${p.note || ""}"`
  ).join("\n");
  await navigator.clipboard.writeText(cmds);
  const btn = document.querySelector("#copyAddPointCmd");
  const original = btn.textContent;
  btn.textContent = "已複製到剪貼簿";
  setTimeout(() => (btn.textContent = original), 1500);
});

const s2State = {
  data: null,
  index: 0,
  metric: "debris_bare_pct",
  timer: null
};

const s2MetricDefs = {
  debris_bare_pct: { label: "崩積區裸露", color: "#d97706", cov: "debris", refKey: "debris_bare_pct", derive: (m) => m.debris_bare_pct },
  residual_bare_pct: { label: "殘壩區裸露", color: "#db2777", cov: "residual", refKey: "residual_bare_pct", derive: (m) => m.residual_bare_pct },
  downstream_bare_pct: { label: "下游裸露", color: "#2563eb", cov: "downstream", refKey: "downstream_bare_pct", derive: (m) => m.downstream_bare_pct },
  residual_vegetation_pct: { label: "殘壩植生覆蓋（衍生）", color: "#268454", cov: "residual", refKey: "residual_bare_pct", refDerive: (v) => 100 - v, derive: (m) => (m.residual_bare_pct == null ? null : 100 - m.residual_bare_pct) }
};

const s2NewWaterClass = {
  new_candidate: { label: "新生水域候選", tone: "nw-new", color: "#dc2626" },
  known_lake: { label: "既有堰塞湖區", tone: "nw-lake", color: "#1d6fd8" },
  landslide_surface: { label: "崩積／殘壩區表面", tone: "nw-slide", color: "#a16207" },
  downstream_channel: { label: "河道水域變遷", tone: "nw-down", color: "#64748b" },
  transient: { label: "單月孤立訊號", tone: "nw-down", color: "#94a3b8" }
};

const S2_USABLE_COVERAGE = 0.4;

function s2Months() {
  return s2State.data?.months || [];
}

function s2HasImagery(m) {
  return !!m?.images;
}

function s2IsCloudy(m) {
  return !m || !s2HasImagery(m) || m.status === "low_coverage";
}

function s2Fmt(v, digits = 1) {
  return v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
}

function s2Pct(v) {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function s2PrevUsable(index, key, covKey) {
  const months = s2Months();
  for (let i = index - 1; i >= 0; i -= 1) {
    const m = months[i];
    if (m[key] != null && (m.coverage?.[covKey] ?? 0) >= S2_USABLE_COVERAGE) return m;
  }
  return null;
}

function s2Delta(value, previous, unit) {
  if (value == null) return "本月無有效觀測";
  if (!previous) return "無前一可用月";
  const delta = value - previous.value;
  const sign = delta > 0 ? "+" : "";
  return `較 ${previous.label} ${sign}${delta.toFixed(1)}${unit === "%" ? " 個百分點" : ` ${unit}`}`;
}

function s2MetricCard(label, value, suffix, note, coverage, tone) {
  const low = coverage != null && coverage < S2_USABLE_COVERAGE;
  return `<article class="metric-card s2-metric-card ${tone}${low ? " low" : ""}">
    <span>${label}</span>
    <strong>${value}${value === "—" ? "" : suffix}</strong>
    <small>${note}</small>
    <small class="s2-cov">有效覆蓋 ${s2Pct(coverage)}${low ? "（僅供參考）" : ""}</small>
  </article>`;
}

function s2RefIndex(ref) {
  const ym = ref.date.slice(0, 7);
  return s2Months().findIndex((m) => m.month === ym);
}

function s2Axis(months, x, height, margin) {
  let ticks = "";
  months.forEach((m, i) => {
    if (m.month.endsWith("-01")) {
      const year = Number(m.month.slice(0, 4)) - 1911;
      ticks += `<line class="s2-year-tick" x1="${x(i)}" y1="${margin.top}" x2="${x(i)}" y2="${height - margin.bottom}"></line>
        <text class="s2-x-label" x="${x(i)}" y="${height - margin.bottom + 16}" text-anchor="middle">${year}</text>`;
    }
  });
  const events = (s2State.data.events || []).map((ev) => {
    const i = months.findIndex((m) => m.month === ev.month);
    if (i < 0) return "";
    return `<line class="s2-event-line" x1="${x(i)}" y1="${margin.top - 4}" x2="${x(i)}" y2="${height - margin.bottom}"></line>
      <text class="s2-event-label" x="${x(i) + 3}" y="${margin.top + 6}">${ev.label}</text>`;
  }).join("");
  return ticks + events;
}

function s2HitAreas(months, x, slot, top, h) {
  return months.map((m, i) => `<rect class="s2-hit" data-s2-index="${i}" x="${x(i) - slot / 2}" y="${top}" width="${slot}" height="${h}"><title>${m.roc_month}</title></rect>`).join("");
}

function s2LineChart(metricKey, selectedIndex) {
  const def = s2MetricDefs[metricKey];
  const months = s2Months();
  const width = 760;
  const height = 270;
  const margin = { left: 40, right: 14, top: 20, bottom: 38 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const n = months.length;
  const slot = innerW / Math.max(1, n);
  const x = (i) => margin.left + slot * (i + 0.5);
  const y = (v) => margin.top + innerH - (v / 100) * innerH;
  const grid = [0, 25, 50, 75, 100].map((tick) => `
    <line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}"></line>
    <text x="${margin.left - 7}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`).join("");
  const pts = months.map((m, i) => ({ i, v: def.derive(m), cov: m.coverage?.[def.cov] ?? 0 }));
  const usable = pts.filter((p) => p.v != null && p.cov >= S2_USABLE_COVERAGE);
  const line = usable.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const dots = pts.filter((p) => p.v != null).map((p) => {
    const ok = p.cov >= S2_USABLE_COVERAGE;
    return `<circle class="s2-dot${ok ? "" : " hollow"}" cx="${x(p.i)}" cy="${y(p.v)}" r="${ok ? 2.6 : 2.4}"></circle>`;
  }).join("");
  const refs = (s2State.data.slide_reference?.observations || []).map((ref) => {
    const i = s2RefIndex(ref);
    if (i < 0 || ref[def.refKey] == null) return "";
    const v = def.refDerive ? def.refDerive(ref[def.refKey]) : ref[def.refKey];
    const cx = x(i); const cy = y(v);
    return `<path class="s2-ref" d="M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z"><title>簡報 ${ref.roc_date}：${v.toFixed(1)}%</title></path>`;
  }).join("");
  const sel = pts[selectedIndex];
  const selMark = `<line class="s2-selected-line" x1="${x(selectedIndex)}" y1="${margin.top}" x2="${x(selectedIndex)}" y2="${height - margin.bottom}"></line>` +
    (sel?.v != null ? `<circle class="s2-dot selected" cx="${x(selectedIndex)}" cy="${y(sel.v)}" r="6"></circle>
      <text class="s2-point-value" x="${Math.min(x(selectedIndex), width - 40)}" y="${y(sel.v) - 11}" text-anchor="middle">${sel.v.toFixed(1)}</text>` : "");
  return `<div class="s2-chart-title"><strong>${def.label}</strong><span>單位：%｜橫軸：民國年<button type="button" class="s2-expand" data-s2-zoom="chart-trend" title="放大圖表">⤢ 放大</button></span></div>
    <svg viewBox="0 0 ${width} ${height}" class="s2-chart-svg" aria-label="${def.label}逐月時序圖">
      <g class="s2-chart-grid">${grid}</g>
      <g>${s2Axis(months, x, height, margin)}</g>
      <polyline points="${line}" fill="none" stroke="${def.color}" stroke-width="2" stroke-linejoin="round" opacity=".85"></polyline>
      <g style="--series-color:${def.color}">${dots}${selMark}</g>
      <g>${refs}</g>
      <g>${s2HitAreas(months, x, slot, margin.top, innerH)}</g>
    </svg>`;
}

function s2WaterChart(selectedIndex) {
  const months = s2Months();
  const width = 760;
  const height = 215;
  const margin = { left: 40, right: 14, top: 22, bottom: 38 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const n = months.length;
  const slot = innerW / Math.max(1, n);
  const x = (i) => margin.left + slot * (i + 0.5);
  const refs = s2State.data.slide_reference?.observations || [];
  const maxVal = Math.max(20, ...months.map((m) => m.water_area_ha || 0), ...refs.map((r) => r.water_area_ha || 0));
  const max = Math.ceil(maxVal / 20) * 20;
  const y = (v) => margin.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const grid = ticks.map((tick) => `
    <line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}"></line>
    <text x="${margin.left - 7}" y="${y(tick) + 4}" text-anchor="end">${Math.round(tick)}</text>`).join("");
  const barW = Math.max(1.5, slot * 0.72);
  const bars = months.map((m, i) => {
    if (m.water_area_ha == null) return "";
    const top = y(m.water_area_ha);
    const low = (m.coverage?.dam_water_zone ?? 0) < S2_USABLE_COVERAGE;
    const cls = `s2-wbar${m.water_area_is_minimum ? " minimum" : ""}${low ? " low" : ""}${i === selectedIndex ? " selected" : ""}`;
    return `<rect class="${cls}" x="${x(i) - barW / 2}" y="${top}" width="${barW}" height="${Math.max(0.8, margin.top + innerH - top)}"></rect>`;
  }).join("");
  const refMarks = refs.map((ref) => {
    const i = s2RefIndex(ref);
    if (i < 0) return "";
    const cx = x(i); const cy = y(ref.water_area_ha);
    return `<path class="s2-ref" d="M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z"><title>簡報 ${ref.roc_date}：${ref.water_area_is_minimum ? "≥" : ""}${ref.water_area_ha} ha</title></path>`;
  }).join("");
  const sel = months[selectedIndex];
  const selLabel = sel?.water_area_ha != null
    ? `<text class="s2-point-value" x="${Math.min(x(selectedIndex), width - 40)}" y="${y(sel.water_area_ha) - 8}" text-anchor="middle">${sel.water_area_is_minimum ? "≥" : ""}${sel.water_area_ha.toFixed(1)}</text>` : "";
  return `<div class="s2-chart-title"><strong>壩區水域面積（MNDWI＋NDWI）</strong><span>單位：ha｜淺色＝雲遮下限值<button type="button" class="s2-expand" data-s2-zoom="chart-water" title="放大圖表">⤢ 放大</button></span></div>
    <svg viewBox="0 0 ${width} ${height}" class="s2-chart-svg" aria-label="壩區水域面積逐月時序圖">
      <g class="s2-chart-grid">${grid}</g>
      <g>${s2Axis(months, x, height, margin)}</g>
      <line class="s2-selected-line" x1="${x(selectedIndex)}" y1="${margin.top}" x2="${x(selectedIndex)}" y2="${height - margin.bottom}"></line>
      <g>${bars}</g>${selLabel}
      <g>${refMarks}</g>
      <g>${s2HitAreas(months, x, slot, margin.top, innerH)}</g>
    </svg>`;
}

const s2Layers = {
  tc: { label: "真色影像", extent: "view" },
  ndvi: { label: "NDVI 裸露／植生", extent: "view" },
  ndwi: { label: "NDWI 水域", extent: "view" },
  overview: { label: "全流域 真色＋水域", extent: "overview" },
  overview_ndvi: { label: "全流域 NDVI 裸露", extent: "overview" },
  zanom: { label: "NDVI 異常 z-score", extent: "view" },
  recovery: { label: "R1 復育分區", extent: "view" },
  overview_zanom: { label: "全流域 NDVI 異常", extent: "overview" },
  dprev: { label: "與上月比 NDVI 變化", extent: "view" },
  overview_dprev: { label: "全流域 與上月比", extent: "overview" }
};

// 變化圖層疊在當月衛星真色上（透明度由滑桿控制）
const S2_BLEND = { zanom: "tc", recovery: "tc", overview_zanom: "overview", dprev: "tc", overview_dprev: "overview" };
const s2VegModes = { base: "與往年同月比", prev: "與上個月比" };

function s2VegList(m, mode = s2State.vegMode || "base") {
  return (mode === "prev" ? m?.mom?.blocks : m?.ndvi_anomaly?.candidates) || [];
}
const S2_PITCH_HA = 0.714;   // 標準足球場 105 × 68 m

function s2LL2px(meta, lat, lon) {
  const a = meta?.ll2px;
  if (!a || lat == null || lon == null) return null;
  return { x: a[0] * lon + a[1] * lat + a[2], y: a[3] * lon + a[4] * lat + a[5] };
}

function s2Inside(p) {
  return !!p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

function s2Pitch(ha) {
  if (ha >= 100) return `約 ${(ha / 100).toFixed(1)} 平方公里`;
  const n = ha / S2_PITCH_HA;
  if (n < 1) return "不到 1 座足球場";
  return `約 ${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)} 座足球場`;
}

function s2MarkSvg({ x, y, r, color, label, on, dim, attrs, title, square }) {
  const shape = (rr, cls, stroke) => (square
    ? `<rect class="${cls}" x="${x - rr}" y="${y - rr}" width="${rr * 2}" height="${rr * 2}" rx="3"${stroke ? ` stroke="${stroke}"` : ""}></rect>`
    : `<circle class="${cls}" cx="${x}" cy="${y}" r="${rr}"${stroke ? ` stroke="${stroke}"` : ""}></circle>`);
  const g = r + 5;
  const cross = on ? `<g class="cross" stroke="${color}"><line x1="${x - g - 16}" y1="${y}" x2="${x - g}" y2="${y}"></line><line x1="${x + g}" y1="${y}" x2="${x + g + 16}" y2="${y}"></line>
    <line x1="${x}" y1="${y - g - 16}" x2="${x}" y2="${y - g}"></line><line x1="${x}" y1="${y + g}" x2="${x}" y2="${y + g + 16}"></line></g>` : "";
  return `<g class="s2-nw-mark s2-pick${on ? " on" : ""}${dim ? " dim" : ""}" ${attrs}>${shape(r + 3, "halo")}${shape(r, "ring", color)}${cross}
    <text x="${x + r + 5}" y="${y + 7}" fill="${color}">${label}</text><title>${title}</title></g>`;
}

function s2AnomMarks(m, mode, meta, w, h, isView) {
  const list = s2VegList(m, mode);
  const sel = s2State.anomKey === `${m.month}|${mode}` ? s2State.anomSel : null;
  return list.map((f, i) => {
    const p = s2LL2px(meta, f.lat, f.lon) || (isView ? null : { x: f.ox, y: f.oy });
    if (!s2Inside(p)) return "";
    const c = s2AnomClass[f.class] || s2AnomClass.new;
    const r = Math.max(10, Math.min(34, Math.sqrt(f.area_ha) * (isView ? 8 : 5))) + (sel === i ? 4 : 0);
    return s2MarkSvg({ x: +(p.x * w).toFixed(1), y: +(p.y * h).toFixed(1), r, color: c.color, label: i + 1, on: sel === i,
      dim: sel != null && sel !== i, attrs: `data-anom-i="${i}"`, title: `${i + 1}. ${c.label} ${f.area_ha} ha` });
  }).join("");
}

function s2Rings(overlay, w, h) {
  return (overlay?.rings || []).map((ring) => ring.map(([px, py]) => `${(px * w).toFixed(1)},${(py * h).toFixed(1)}`).join(" "));
}

function s2RingLabelPos(overlay, w, h, where = "center") {
  const rings = overlay?.rings || [];
  if (!rings.length) return null;
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  const x = ((Math.min(...xs) + Math.max(...xs)) / 2) * w;
  if (where === "below") return { x: Math.min(Math.max(x, 260), w - 260), y: Math.min(Math.max(...ys) * h + 30, h - 12) };
  return { x, y: ((Math.min(...ys) + Math.max(...ys)) / 2) * h };
}

// 同一個SVG建構器供縮圖與放大檢視共用，確保兩者內容一致
function s2FigureSvg(layer, m, opts = {}) {
  const data = s2State.data;
  const ext = s2Layers[layer].extent;
  const meta = ext === "view" ? data.view : data.overview;
  const w = 1000;
  const h = +(w / meta.aspect).toFixed(1);
  const ov = meta.overlays;
  const poly = (key, cls) => s2Rings(ov[key], w, h).map((pts) => `<polygon class="${cls}" points="${pts}"></polygon>`).join("");
  const label = (key, text, cls, where) => {
    const p = s2RingLabelPos(ov[key], w, h, where);
    return p ? `<text class="s2-map-label ${cls}" x="${p.x}" y="${p.y}" text-anchor="middle">${text}</text>` : "";
  };
  const href = m.images?.[layer];
  if (!href) {
    return `<svg viewBox="0 0 ${w} ${h}" aria-label="${m.roc_month} ${s2Layers[layer].label}"><rect width="${w}" height="${h}" fill="#eef2f4"></rect>
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" class="s2-empty-text">${m.status === "no_scene" ? "本月無Sentinel-2影像" : "本月無可用影像（整月雲遮）"}</text></svg>`;
  }
  const under = S2_BLEND[layer] && m.images?.[S2_BLEND[layer]];
  const alpha = s2State.anomAlpha ?? 0.6;
  let body = under ? `<image href="${under}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"></image>` : "";
  body += `<image${under ? ` class="s2-blend-top" opacity="${alpha}"` : ""} href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"></image>`;
  if (ext === "view") {
    body += poly("downstream", "s2-ov-downstream") + poly("lake_max", "s2-ov-lake") + poly("debris", "s2-ov-debris") + poly("residual", "s2-ov-residual");
    if (opts.labels) body += label("debris", "崩積區", "debris") + label("residual", "殘壩區", "residual") + label("downstream", "下游裸露計算範圍", "downstream");
    if ((layer === "zanom" || layer === "dprev") && opts.marks !== false) body += s2AnomMarks(m, layer === "dprev" ? "prev" : "base", meta, w, h, true);
  } else {
    body += poly("downstream", "s2-ov-downstream-fill") + poly("watershed", "s2-ov-ws") + poly("view", "s2-ov-view")
      + poly("lake_max", "s2-ov-lake") + poly("debris", "s2-ov-debris") + poly("residual", "s2-ov-residual");
    body += label("downstream", "下游裸露計算範圍（土砂堆積＋沖淤調節區）", "downstream", "below");
    if (opts.marks !== false && (layer === "overview_zanom" || layer === "overview_dprev")) body += s2AnomMarks(m, layer === "overview_dprev" ? "prev" : "base", meta, w, h, false);
    else if (opts.marks !== false) {
      const anomMode = false;
      const markList = anomMode ? (m.ndvi_anomaly?.candidates || []) : (m.new_water || []);
      body += markList.map((f, i) => {
        const c = anomMode ? (s2AnomClass[f.class] || s2AnomClass.new) : (s2NewWaterClass[f.class] || s2NewWaterClass.new_candidate);
        const r = Math.max(9, Math.min(30, Math.sqrt(f.area_ha) * 5));
        return `<g class="s2-nw-mark"><circle cx="${f.ox * w}" cy="${f.oy * h}" r="${r}" stroke="${c.color}"></circle>
          <text x="${f.ox * w + r + 3}" y="${f.oy * h + 4}" fill="${c.color}">${i + 1}</text><title>${c.label} ${f.area_ha} ha</title></g>`;
      }).join("");
    }
  }
  if (opts.extra) body += opts.extra;
  // 影像時間戳記
  const scenes = m.scenes || [];
  const range = scenes.length ? `${scenes[0].date.slice(5).replace("-", "/")}–${scenes[scenes.length - 1].date.slice(5).replace("-", "/")}` : "";
  const stamp = `${m.roc_month} 月合成${range ? `｜${range}` : ""}｜${m.n_scenes || 0}景`;
  if (opts.stamp) body += `<g class="s2-stamp"><rect x="10" y="10" width="${stamp.length * 15 + 22}" height="34" rx="6"></rect><text x="21" y="33">${stamp}</text></g>`;
  return `<svg viewBox="0 0 ${w} ${h}" aria-label="${m.roc_month} ${s2Layers[layer].label}">${body}</svg>`;
}

function s2ImagePanel(layer, m) {
  return `<figure class="s2-image-panel s2-zoomable" data-s2-zoom="${layer}" tabindex="0" role="button" aria-label="放大 ${s2Layers[layer].label}">
      <figcaption>${s2Layers[layer].label}<span class="s2-zoom-hint">⤢</span></figcaption>
      ${s2FigureSvg(layer, m)}
    </figure>`;
}

function s2DetectionTimeline(index) {
  const months = s2Months();
  const cells = months.map((m, i) => {
    const cls = (m.new_water || []).map((f) => f.class);
    let tone = "none"; let tip = "無影像";
    const w = m.water_area_ha;
    const lakeW = s2LakeWater(m);
    const wTxt = (lakeW != null ? `；既有湖區水域 ${lakeW.toFixed(1)} ha` : "") + (w == null ? "" : `；壩區水域${m.water_area_is_minimum ? "≥" : ""}${w.toFixed(1)} ha`);
    const lakeWater = lakeW != null || (m.month >= S2_EVENT_START && cls.includes("known_lake"));   // 2025-07 前無堰塞湖
    if (m.images && !m.water_scanned) {
      tone = lakeWater ? "lake" : "cloud"; tip = `雲遮過多，未做全流域掃描${wTxt}`;
    } else if (m.water_scanned) {
      tone = lakeWater ? "lake" : "clear";
      tip = `${lakeWater ? "既有堰塞湖區有水" : "未見新生水域"}${wTxt}`;
      if (cls.includes("new_candidate")) { tone = "new"; tip = `新生水域候選${wTxt}`; }
    }
    return `<button type="button" class="s2-dt-cell ${tone}${i === index ? " selected" : ""}" data-s2-index="${i}" title="${m.roc_month} ${tip}"></button>`;
  }).join("");
  const axis = months.map((m, i) => (m.month.endsWith("-01")
    ? `<span style="left:${((i + 0.5) / months.length * 100).toFixed(2)}%">${Number(m.month.slice(0, 4)) - 1911}</span>` : "")).join("");
  return `<div class="s2-dt-strip">${cells}</div><div class="s2-dt-axis">${axis}<em>民國年</em></div>
    <div class="s2-dt-legend"><span><i class="new"></i>新生水域候選</span><span><i class="lake"></i>既有湖區有水</span><span><i class="clear"></i>未見新生水域</span><span><i class="cloud"></i>雲遮未掃描</span><span><i class="none"></i>無影像</span></div>`;
}

function s2RenderOverview(m, index) {
  const layer = s2State.ovLayer || "overview";
  document.querySelector("#s2OverviewTabs").innerHTML = ["overview", "overview_ndvi"].map((k) =>
    `<button type="button" data-s2-ovlayer="${k}" class="${k === layer ? "active" : ""}">${k === "overview" ? "真色＋水域" : "NDVI 裸露（看下游）"}</button>`).join("");
  const scenes = m.scenes || [];
  document.querySelector("#s2OverviewTime").innerHTML = `<strong>${m.roc_month}</strong>（${m.month}）月合成
    ${scenes.length ? `｜影像日期：${scenes.map((s) => s.date.slice(5).replace("-", "/")).join("、")}` : "｜本月無可用影像"}${m.final ? "" : "｜暫定"}`;
  document.querySelector("#s2Overview").innerHTML = `<div class="s2-zoomable" data-s2-zoom="${layer}" tabindex="0" role="button" aria-label="放大全流域圖">${s2FigureSvg(layer, m, { stamp: true })}</div>`;
  document.querySelector("#s2DetectionTimeline").innerHTML = s2DetectionTimeline(index);
  const wl = document.querySelector("#s2WaterLegend");
  if (wl && s2State.data.water_legend) wl.innerHTML = s2State.data.water_legend.map((x) => `<span><i class="sw" style="background:${x.color};height:10px"></i>${x.label}</span>`).join("")
    + `<span><i class="sw" style="background:#ececec;height:10px;border:1px solid #d0d5d9"></i>雲遮</span>`;

  const found = m.new_water || [];
  const nNew = found.filter((f) => f.class === "new_candidate").length;
  const badge = document.querySelector("#s2NewWaterBadge");
  badge.textContent = !m.images ? "本月無觀測" : !m.water_scanned ? "雲遮過多，本月未掃描" : nNew ? `新生水域候選 ${nNew} 處` : "未偵測到新生水域候選";
  badge.classList.toggle("alert", nNew > 0);
  const routine = found.filter((f) => f.class === "downstream_channel" || f.class === "transient");
  const lakeW = s2LakeWater(m);
  const notable = found.map((f, i) => ({ ...f, n: i + 1 }))
    .filter((f) => f.class !== "downstream_channel" && f.class !== "transient" && !(lakeW != null && f.class === "known_lake"));
  if (lakeW != null) notable.unshift({ n: "湖", class: "known_lake", area_ha: lakeW, lat: 23.6973, lon: 121.2903, aggregate: true });
  const routineNote = routine.length
    ? `<p class="s2-small">另有 ${routine.length} 處河道水域變遷／單月孤立訊號（地圖灰圈，共 ${routine.reduce((a, f) => a + f.area_ha, 0).toFixed(1)} ha），屬河道擺盪或雲影，不列入警示。</p>` : "";
  document.querySelector("#s2NewWaterList").innerHTML = !m.images
    ? `<p class="muted-empty">${m.status === "no_scene" ? "本月無Sentinel-2影像" : "本月整月雲遮"}，無法掃描。</p>`
    : !m.water_scanned
      ? `<p class="muted-empty">本月流域有效覆蓋不足50%，為避免殘雲誤報不做掃描。</p>`
      : (notable.length
        ? `<table class="s2-nw-table"><thead><tr><th>#</th><th>類型</th><th>面積</th><th>座標</th></tr></thead><tbody>${notable.map((f) => {
            const c = s2NewWaterClass[f.class] || s2NewWaterClass.new_candidate;
            return `<tr><td>${f.n}</td><td><span class="s2-nw-chip ${c.tone}">${c.label}${f.aggregate ? "（湖區範圍合計）" : ""}${f.pending_confirm ? "（待下月確認）" : ""}</span></td><td>${f.area_ha} ha</td><td>${f.aggregate ? "2025堰塞湖範圍" : `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`}</td></tr>`;
          }).join("")}</tbody></table>`
        : `<p class="muted-empty">本月無需關注的新增水體。</p>`) + routineNote;
}

// ---- 點選放大檢視 ----
const s2Zoom = { layer: null, scale: 1, x: 0, y: 0, drag: null, kind: "map" };

function s2EnsureLightbox() {
  let lb = document.querySelector("#s2Lightbox");
  if (lb) return lb;
  lb = document.createElement("div");
  lb.id = "s2Lightbox";
  lb.className = "s2-lightbox";
  lb.hidden = true;
  lb.innerHTML = `<div class="s2-lb-bar">
      <div class="s2-lb-title"><strong id="s2LbTitle"></strong><span id="s2LbSub"></span></div>
      <div id="s2LbLayers" class="s2-lb-layers"></div>
      <div class="s2-lb-tools">
        <button type="button" data-lb="prev" title="上一個月（←）">‹ 上月</button>
        <button type="button" data-lb="next" title="下一個月（→）">下月 ›</button>
        <button type="button" data-lb="out" title="縮小（−）">−</button>
        <button type="button" data-lb="reset" title="原尺寸（0）">1:1</button>
        <button type="button" data-lb="in" title="放大（+）">＋</button>
        <button type="button" data-lb="close" class="close" title="關閉（Esc）">✕</button>
      </div>
    </div>
    <div class="s2-lb-stage" id="s2LbStage"><div class="s2-lb-canvas" id="s2LbCanvas"></div></div>
    <p class="s2-lb-help">滾輪或＋／−縮放、拖曳平移、雙擊放大；← → 切換月份，Esc 關閉</p>`;
  document.body.appendChild(lb);
  lb.querySelector(".s2-lb-bar").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.lbLayer) { s2Zoom.layer = b.dataset.lbLayer; s2RenderLightbox(); return; }
    if (b.dataset.lbMon) { monState.mapLayer = b.dataset.lbMon; monRenderMap(); s2RenderLightbox(); return; }
    const act = b.dataset.lb;
    if (act === "close") s2CloseLightbox();
    else if (act === "prev" || act === "next") { s2Step(act === "prev" ? -1 : 1); s2RenderLightbox(); }
    else if (act === "in") s2ZoomBy(1.4);
    else if (act === "out") s2ZoomBy(1 / 1.4);
    else if (act === "reset") { Object.assign(s2Zoom, { scale: 1, x: 0, y: 0 }); s2ApplyZoom(); }
  });
  const stage = lb.querySelector("#s2LbStage");
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    s2ZoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => {
    const r = stage.getBoundingClientRect();
    s2ZoomBy(1.8, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
  });
  stage.addEventListener("pointerdown", (e) => {
    s2Zoom.drag = { x: e.clientX, y: e.clientY, ox: s2Zoom.x, oy: s2Zoom.y };
    stage.setPointerCapture(e.pointerId); stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!s2Zoom.drag) return;
    s2Zoom.x = s2Zoom.drag.ox + (e.clientX - s2Zoom.drag.x);
    s2Zoom.y = s2Zoom.drag.oy + (e.clientY - s2Zoom.drag.y);
    s2ApplyZoom();
  });
  const end = () => { s2Zoom.drag = null; stage.classList.remove("dragging"); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  lb.addEventListener("click", (e) => { if (e.target === lb) s2CloseLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") s2CloseLightbox();
    else if (e.key === "ArrowLeft" && s2Zoom.kind === "map") { s2Step(-1); s2RenderLightbox(); }
    else if (e.key === "ArrowRight" && s2Zoom.kind === "map") { s2Step(1); s2RenderLightbox(); }
    else if (e.key === "+" || e.key === "=") s2ZoomBy(1.4);
    else if (e.key === "-") s2ZoomBy(1 / 1.4);
    else if (e.key === "0") { Object.assign(s2Zoom, { scale: 1, x: 0, y: 0 }); s2ApplyZoom(); }
  });
  return lb;
}

function s2ZoomBy(f, cx = 0, cy = 0) {
  const ns = Math.max(1, Math.min(12, s2Zoom.scale * f));
  const k = ns / s2Zoom.scale;
  s2Zoom.x = cx - (cx - s2Zoom.x) * k;
  s2Zoom.y = cy - (cy - s2Zoom.y) * k;
  s2Zoom.scale = ns;
  if (ns === 1) { s2Zoom.x = 0; s2Zoom.y = 0; }
  s2ApplyZoom();
}

function s2ApplyZoom() {
  const c = document.querySelector("#s2LbCanvas");
  if (c) c.style.transform = `translate(${s2Zoom.x}px, ${s2Zoom.y}px) scale(${s2Zoom.scale})`;
  const sub = document.querySelector("#s2LbSub");
  if (sub) sub.dataset.zoom = `${Math.round(s2Zoom.scale * 100)}%`;
}

function s2RenderLightbox() {
  const lb = s2EnsureLightbox();
  const m = s2Months()[s2State.index];
  const canvas = lb.querySelector("#s2LbCanvas");
  const layersBox = lb.querySelector("#s2LbLayers");
  lb.querySelectorAll('[data-lb="prev"],[data-lb="next"]').forEach((b) => { b.hidden = s2Zoom.kind !== "map"; });
  if (s2Zoom.kind === "map") {
    lb.querySelector("#s2LbTitle").textContent = `${m.roc_month}（${m.month}）${s2Layers[s2Zoom.layer].label}`;
    lb.querySelector("#s2LbSub").textContent = m.n_scenes ? `${m.n_scenes}景：${(m.scenes || []).map((s) => s.date.slice(5)).join("、")}` : "本月無可用影像";
    layersBox.innerHTML = Object.entries(s2Layers).map(([k, v]) =>
      `<button type="button" data-lb-layer="${k}" class="${k === s2Zoom.layer ? "active" : ""}">${v.label}</button>`).join("");
    if (S2_BLEND[s2Zoom.layer]) layersBox.innerHTML += s2BlendHtml("data-lb-blend");
    canvas.innerHTML = s2FigureSvg(s2Zoom.layer, m, { labels: true, stamp: true });
  } else if (s2Zoom.kind === "custom") {
    const cu = s2Zoom.custom;
    lb.querySelector("#s2LbTitle").textContent = cu.title();
    lb.querySelector("#s2LbSub").textContent = cu.sub();
    layersBox.innerHTML = (cu.layers ? cu.layers() : "") + (cu.blend && cu.blend() ? s2BlendHtml("data-lb-blend") : "");
    canvas.innerHTML = cu.svg();
  } else {
    const src = document.querySelector(s2Zoom.kind === "chart-trend" ? "#s2TrendChart" : "#s2WaterChart");
    lb.querySelector("#s2LbTitle").textContent = src.querySelector(".s2-chart-title strong")?.textContent || "圖表";
    lb.querySelector("#s2LbSub").textContent = `目前選取：${m.roc_month}`;
    layersBox.innerHTML = "";
    canvas.innerHTML = src.querySelector("svg").outerHTML;
  }
  // 依圖幅長寬比設定畫布寬度，讓整張圖剛好塞進視窗
  let aspect = 1.32;
  if (s2Zoom.kind === "map") aspect = (s2Layers[s2Zoom.layer].extent === "view" ? s2State.data.view : s2State.data.overview).aspect;
  else { const vb = canvas.querySelector("svg")?.viewBox?.baseVal; if (vb) aspect = vb.width / vb.height; }
  canvas.style.width = `min(96vw, calc((100vh - 130px) * ${aspect.toFixed(4)}))`;
  s2ApplyZoom();
}

function s2OpenLightbox(kind) {
  const lb = s2EnsureLightbox();
  Object.assign(s2Zoom, { scale: 1, x: 0, y: 0 });
  if (s2Layers[kind]) { s2Zoom.kind = "map"; s2Zoom.layer = kind; } else { s2Zoom.kind = kind; }
  lb.hidden = false;
  document.body.classList.add("s2-lb-open");
  s2RenderLightbox();
  lb.querySelector('[data-lb="close"]').focus();
}

function s2BlendHtml(attr) {
  return `<label class="s2-blend lb">衛星照片<input ${attr} type="range" min="0" max="100" step="5" value="${Math.round((s2State.anomAlpha ?? 0.6) * 100)}" aria-label="變化圖層疊合比例" />變化圖層</label>`;
}

// 開啟燈箱並把指定點（圖幅相對座標 0–1）放到畫面中央
function s2OpenLightboxAt(kind, px, py, scale = 4) {
  s2OpenLightbox(kind);
  const c = document.querySelector("#s2LbCanvas");
  const W = c.offsetWidth; const H = c.offsetHeight;
  Object.assign(s2Zoom, { scale, x: -(px - 0.5) * W * scale, y: -(py - 0.5) * H * scale });
  s2ApplyZoom();
}

// 疊合滑桿（本頁、燈箱、通報頁共用同一個透明度）
document.addEventListener("input", (e) => {
  if (!e.target.matches("#s2AnomBlend, [data-lb-blend], #monBlend")) return;
  s2State.anomAlpha = Number(e.target.value) / 100;
  document.querySelectorAll(".s2-blend-top").forEach((img) => img.setAttribute("opacity", String(s2State.anomAlpha)));
  document.querySelectorAll("#s2AnomBlend, [data-lb-blend], #monBlend").forEach((r) => { if (r !== e.target) r.value = e.target.value; });
});

function s2CloseLightbox() {
  const lb = document.querySelector("#s2Lightbox");
  if (!lb) return;
  lb.hidden = true;
  document.body.classList.remove("s2-lb-open");
}

document.querySelector("#sentinel2")?.addEventListener("click", (e) => {
  const vs = e.target.closest("[data-veg-step]");
  if (vs) { if (!vs.disabled) s2Step(Number(vs.dataset.vegStep)); return; }
  const vm = e.target.closest("[data-veg-mode]");
  if (vm) { s2State.vegMode = vm.dataset.vegMode; s2RenderAnomaly(s2Months()[s2State.index]); return; }
  const mk = e.target.closest("[data-anom-i]");
  if (mk && mk.closest("#s2AnomFigure")) { s2SelectAnom(Number(mk.dataset.anomI), "map"); return; }
  const zb = e.target.closest("[data-anom-zoom]");
  if (zb) { s2ZoomAnom(Number(zb.dataset.anomZoom)); return; }
  const gb = e.target.closest("[data-anom-gis]");
  if (gb) { const f = s2VegList(s2Months()[s2State.index])[Number(gb.dataset.anomGis)]; if (f) gisOpenAt(f.lat, f.lon, s2AnomClass[f.class]?.label); return; }
  const row = e.target.closest("[data-anom-row]");
  if (row) { s2SelectAnom(Number(row.dataset.anomRow), "list"); return; }
  const z = e.target.closest("[data-s2-zoom]");
  if (z) { s2OpenLightbox(z.dataset.s2Zoom); return; }
  const idx = e.target.closest("[data-s2-index]");
  if (idx) { selectS2Observation(Number(idx.dataset.s2Index)); return; }
  const ovl = e.target.closest("[data-s2-ovlayer]");
  if (ovl) { s2State.ovLayer = ovl.dataset.s2Ovlayer; renderSentinel2View(); return; }
  const anl = e.target.closest("[data-s2-anomlayer]");
  if (anl && !anl.disabled) {
    if (s2State.vegMode === "prev") s2State.momLayer = anl.dataset.s2Anomlayer; else s2State.anomLayer = anl.dataset.s2Anomlayer;
    s2RenderAnomaly(s2Months()[s2State.index]);
  }
});
document.querySelector("#sentinel2")?.addEventListener("keydown", (e) => {
  const row = e.target.closest("[data-anom-row]");
  if (row && e.key === "Enter") { s2SelectAnom(Number(row.dataset.anomRow), "list"); return; }
  const z = e.target.closest("[data-s2-zoom]");
  if (z && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); s2OpenLightbox(z.dataset.s2Zoom); }
});

function s2Insight(m, index) {
  if (!m.images) return `<strong>判讀：</strong>${m.roc_month} 查無有效Sentinel-2觀測（${m.status === "no_scene" ? "無影像" : "整月雲遮"}），指標沿用前後月份判讀。`;
  const parts = [];
  const add = (key, covKey, label) => {
    const prev = s2PrevUsable(index, key, covKey);
    if (m[key] == null) return;
    const d = prev ? m[key] - prev[key] : null;
    parts.push(`${label}${m[key].toFixed(1)}%${d == null ? "" : `（較${prev.roc_month} ${d > 0 ? "+" : ""}${d.toFixed(1)}）`}`);
  };
  add("debris_bare_pct", "debris", "崩積區裸露");
  add("residual_bare_pct", "residual", "殘壩區裸露");
  add("downstream_bare_pct", "downstream", "下游裸露");
  let text = parts.join("；");
  if (m.water_area_ha != null) text += `；壩區水域${m.water_area_is_minimum ? "至少" : ""}${m.water_area_ha.toFixed(1)} ha`;
  const nNew = (m.new_water || []).filter((f) => f.class === "new_candidate").length;
  if (nNew) text += `。<b class="s2-warn">全流域偵測到 ${nNew} 處新生水域候選，請對照總覽圖人工確認是否為新堰塞湖。</b>`;
  if (m.status === "low_coverage") text += "。本月有效覆蓋偏低，數值僅供參考。";
  else if (!m.final) text += "。本月尚未結束，數值為暫定值。";
  return `<strong>判讀：</strong>${text}`;
}

function s2Trend12(key, covKey, index) {
  const months = s2Months();
  const pts = [];
  // 視窗若跨過事件月份（崩塌成湖、潰決），只取事件後月份，避免把事件本身當成趨勢
  let start = Math.max(0, index - 11);
  (s2State.data.events || []).forEach((ev) => {
    const e = months.findIndex((m) => m.month === ev.month);
    if (e >= 0 && e <= index && e + 1 > start) start = e + 1;
  });
  s2State.trendStart = start;
  for (let i = start; i <= index; i += 1) {
    const m = months[i];
    if (m[key] != null && (m.coverage?.[covKey] ?? 0) >= S2_USABLE_COVERAGE) pts.push([i, m[key]]);
  }
  if (pts.length < 4) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return { slopePerYear: (sxy / sxx) * 12, n: pts.length };
}

function selectS2Observation(index) {
  const months = s2Months();
  if (!months.length) return;
  s2State.index = Math.max(0, Math.min(months.length - 1, index));
  renderSentinel2View();
}

function s2Step(dir) {
  const months = s2Months();
  const skip = document.querySelector("#s2SkipCloudy")?.checked;
  let i = s2State.index;
  for (let k = 0; k < months.length; k += 1) {
    i = (i + dir + months.length) % months.length;
    if (!skip || !s2IsCloudy(months[i])) break;
  }
  selectS2Observation(i);
}

function renderSentinel2View() {
  const data = s2State.data;
  if (!data) return;
  const months = data.months;
  const index = s2State.index;
  const m = months[index];

  document.querySelector("#s2MonthSlider").value = String(index);
  document.querySelector("#s2MonthLabel").textContent = m.roc_month;
  document.querySelector("#s2MonthSub").textContent = `${m.month}${m.final ? "" : "（暫定）"}`;

  const refByMonth = Object.fromEntries((data.slide_reference?.observations || []).map((r) => [r.date.slice(0, 7), r]));
  const quick = (data.slide_reference?.observations || []).map((r) => ({ month: r.date.slice(0, 7), title: r.roc_date.slice(0, 6), sub: r.phase }));
  if (data.latest_usable_month) quick.push({ month: data.latest_usable_month, title: months.find((x) => x.month === data.latest_usable_month)?.roc_month || "", sub: "最新可用月" });
  document.querySelector("#s2Timeline").innerHTML = quick.map((q) => {
    const i = months.findIndex((x) => x.month === q.month);
    if (i < 0) return "";
    return `<button type="button" class="s2-time-button ${i === index ? "active" : ""}" data-s2-index="${i}"><strong>${q.title}</strong><span>${q.sub}</span></button>`;
  }).join("");

  const cov = m.coverage || {};
  const card = (key, covKey, label, tone) => {
    const prev = s2PrevUsable(index, key, covKey);
    const note = s2Delta(m[key], prev ? { value: prev[key], label: prev.roc_month } : null, "%");
    return s2MetricCard(label, s2Fmt(m[key]), "%", note, cov[covKey], tone);
  };
  const prevW = s2PrevUsable(index, "water_area_ha", "dam_water_zone");
  const nNew = (m.new_water || []).filter((f) => f.class === "new_candidate").length;
  document.querySelector("#s2MetricCards").innerHTML = [
    card("debris_bare_pct", "debris", "崩積區裸露", "orange"),
    card("residual_bare_pct", "residual", "殘壩區裸露", "pink"),
    card("downstream_bare_pct", "downstream", "下游裸露", "blue"),
    s2MetricCard("壩區水域", m.water_area_ha == null ? "—" : `${m.water_area_is_minimum ? "≥" : ""}${m.water_area_ha.toFixed(1)}`, " ha",
      s2Delta(m.water_area_ha, prevW ? { value: prevW.water_area_ha, label: prevW.roc_month } : null, "ha"), cov.dam_water_zone, "cyan"),
    `<article class="metric-card s2-metric-card ${nNew ? "red" : "green"}"><span>新生水域候選</span><strong>${m.images && m.water_scanned ? `${nNew} 處` : "—"}</strong>
      <small>${!m.images ? "本月無觀測" : !m.water_scanned ? "雲遮過多未掃描" : nNew ? "需人工確認" : "全流域未見新增水體"}</small><small class="s2-cov">流域覆蓋 ${s2Pct(cov.watershed)}</small></article>`
  ].join("");

  const statusText = { ok: "有效觀測", partial: "部分雲遮", low_coverage: "雲遮嚴重", no_scene: "無影像", all_cloud: "整月雲遮" }[m.status] || m.status;
  document.querySelector("#s2SelectedDate").textContent = `${m.roc_month}｜${m.month} 月合成`;
  document.querySelector("#s2SelectedPhase").textContent = refByMonth[m.month] ? `${refByMonth[m.month].phase}（${statusText}）` : statusText;
  const dates = (m.scenes || []).map((s) => s.date.slice(5)).join("、");
  document.querySelector("#s2ObservationCount").textContent = m.n_scenes ? `${m.n_scenes} 景：${dates}` : "0 景";
  document.querySelector("#s2Insight").innerHTML = s2Insight(m, index);

  document.querySelector("#s2ImagePanels").innerHTML = ["tc", "ndvi", "ndwi"].map((k) => s2ImagePanel(k, m)).join("");

  document.querySelector("#s2MetricTabs").innerHTML = Object.entries(s2MetricDefs).map(([key, def]) => `
    <button type="button" data-s2-metric="${key}" class="${key === s2State.metric ? "active" : ""}">${def.label}</button>`).join("");
  const def = s2MetricDefs[s2State.metric];
  const trendKey = s2State.metric === "residual_vegetation_pct" ? "residual_bare_pct" : s2State.metric;
  const trend = s2Trend12(trendKey, def.cov, index);
  document.querySelector("#s2TrendNote").textContent = trend
    ? `近12月${s2State.trendStart > Math.max(0, index - 11) ? "（事件後）" : ""}${s2State.metric === "residual_vegetation_pct" ? "植生" : "裸露"}趨勢 ${(s2State.metric === "residual_vegetation_pct" ? -trend.slopePerYear : trend.slopePerYear) > 0 ? "+" : ""}${(s2State.metric === "residual_vegetation_pct" ? -trend.slopePerYear : trend.slopePerYear).toFixed(1)} 個百分點/年（${trend.n}個月）`
    : "近12月（事件後）有效月份不足，暫不計趨勢";
  document.querySelector("#s2TrendChart").innerHTML = s2LineChart(s2State.metric, index);
  document.querySelector("#s2WaterChart").innerHTML = s2WaterChart(index);
  s2RenderOverview(m, index);
  s2RenderAnomaly(m);
  if (typeof gisS2Render === "function") gisS2Render();

  document.querySelectorAll("[data-s2-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      s2State.metric = button.dataset.s2Metric;
      renderSentinel2View();
    });
  });
}

async function initSentinel2() {
  const page = document.querySelector("#sentinel2");
  if (!page) return;
  try {
    const response = await fetch("./assets/sentinel2/sentinel2_monthly.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    s2State.data = data;
    const months = data.months;
    const latest = months.findIndex((m) => m.month === data.latest_usable_month);
    s2State.index = latest >= 0 ? latest : months.length - 1;
    const slider = document.querySelector("#s2MonthSlider");
    slider.max = String(months.length - 1);
    slider.addEventListener("input", () => selectS2Observation(Number(slider.value)));
    const usable = months.filter((m) => m.status === "ok" || m.status === "partial").length;
    document.querySelector("#s2StatusBadge").textContent = `逐月 ${months.length} 個月｜可用 ${usable} 個月`;
    document.querySelector("#s2StatusNote").textContent = `${data.period.start}～${data.period.end}，每月自動更新`;
    document.querySelector("#s2MethodBare").textContent = `${data.method.composite}${data.method.bare}`;
    document.querySelector("#s2DerivedNote").textContent = data.derived_note;
    document.querySelector("#s2MethodWater").textContent = `${data.method.water}${data.method.new_water}`;
    document.querySelector("#s2Limitations").textContent = `${data.limitations}${data.period.note}`;
    document.querySelector("#s2Source").textContent = `資料來源：${data.source}｜資料更新：${data.updated_at}`;
    renderSentinel2View();
    s2RenderBasis();
    if (typeof monRenderMap === "function") monRenderMap();
  } catch (error) {
    document.querySelector("#s2ImagePanels").innerHTML = `<p class="muted-empty">Sentinel-2資料載入失敗：${error.message}</p>`;
  }
}

// ---- 月報寄送名單（Google Apps Script，密碼於伺服器端驗證） ----
const s2Mail = { endpoint: null };

async function initS2Mail() {
  const status = document.querySelector("#s2MailStatus");
  if (!status) return;
  try {
    const r = await fetch("./assets/sentinel2/report_mailer.json", { cache: "no-store" });
    if (r.ok) s2Mail.endpoint = (await r.json()).endpoint || null;
  } catch (e) { /* 尚未設定 */ }
  const ready = !!s2Mail.endpoint;
  status.textContent = ready ? "寄送服務已啟用" : "寄送服務設定中";
  document.querySelectorAll("#s2MailForm input, #s2MailForm button").forEach((el) => { el.disabled = !ready; });
  if (!ready) return;
  try {
    const st = await s2MailPost({ action: "status" });
    if (st.ok && !st.password_set) s2MailShowSetup();
  } catch (e) { /* 查詢失敗時維持一般表單 */ }
}

async function s2MailPost(payload) {
  const r = await fetch(s2Mail.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  return r.json();
}

// 首次使用：尚未設定權限密碼時，改顯示一次性的密碼設定表單（設定後即無法由網頁更改）
function s2MailShowSetup() {
  document.querySelector("#s2MailStatus").textContent = "請先設定權限密碼";
  document.querySelector("#s2MailForm").hidden = true;
  const box = document.querySelector("#s2MailResult");
  box.className = "s2-mail-result";
  box.innerHTML = `<form id="s2MailSetup" class="s2-mail-form" autocomplete="off">
      <label>設定權限密碼<input id="s2SetPass1" type="password" autocomplete="new-password" minlength="6" maxlength="64" /></label>
      <label>再輸入一次<input id="s2SetPass2" type="password" autocomplete="new-password" minlength="6" maxlength="64" /></label>
      <div class="s2-mail-actions"><button type="submit">設定權限密碼</button></div>
    </form>
    <p class="s2-small">首次使用需設定一次（6–64 字元）。設定後網頁無法再更改，如需修改請至 Apps Script「專案設定 → 指令碼屬性」。</p>
    <div id="s2SetResult" class="s2-mail-result" aria-live="polite"></div>`;
  document.querySelector("#s2MailSetup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = document.querySelector("#s2SetPass1").value;
    const p2 = document.querySelector("#s2SetPass2").value;
    const out = document.querySelector("#s2SetResult");
    if (p1.length < 6) { out.className = "s2-mail-result bad"; out.textContent = "權限密碼至少 6 個字元。"; return; }
    if (p1 !== p2) { out.className = "s2-mail-result bad"; out.textContent = "兩次輸入不一致。"; return; }
    out.className = "s2-mail-result"; out.textContent = "設定中…";
    try {
      const res = await s2MailPost({ action: "set_password", password: p1 });
      if (!res.ok) { out.className = "s2-mail-result bad"; out.textContent = res.error || "設定失敗。"; return; }
      document.querySelector("#s2MailForm").hidden = false;
      document.querySelector("#s2MailStatus").textContent = "寄送服務已啟用";
      s2MailShow("權限密碼已設定完成，現在可以新增寄送信箱。", "good");
    } catch (err) {
      out.className = "s2-mail-result bad"; out.textContent = `無法連線寄送服務：${err.message}`;
    }
  });
}

function s2MailShow(msg, tone) {
  const box = document.querySelector("#s2MailResult");
  box.className = `s2-mail-result ${tone || ""}`;
  box.innerHTML = msg;
}

async function s2MailAction(action) {
  if (!s2Mail.endpoint) return;
  const email = document.querySelector("#s2MailEmail").value.trim();
  const password = document.querySelector("#s2MailPass").value;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  if (action === "send_now") {
    if (email && !validEmail) { s2MailShow("E-mail 格式不正確（空白＝寄給全部名單）。", "bad"); return; }
  } else if (action !== "list" && !validEmail) { s2MailShow("請輸入正確的 E-mail。", "bad"); return; }
  if (!password) { s2MailShow("請輸入權限密碼。", "bad"); return; }
  if (action === "send_now" && !window.confirm(`確定要立即寄送最新月報？\n${email ? `只寄給：${email}` : "寄給：管理者＋名單內所有信箱"}`)) return;
  s2MailShow(action === "send_now" ? "寄送中（約 10–30 秒）…" : "處理中…");
  try {
    const res = await s2MailPost(action === "send_now" ? { action, password, email: email || "" } : { action, email, password });
    if (!res.ok) { s2MailShow(res.error || "操作失敗。", "bad"); return; }
    if (action === "list") {
      const list = res.recipients || [];
      s2MailShow(list.length
        ? `<strong>目前名單（${list.length}）：</strong><ul>${list.map((x) => `<li>${x.email.replace(/[<>&]/g, "")}<small>　${(x.added || "").slice(0, 10)}</small></li>`).join("")}</ul><small>另含管理者信箱。</small>`
        : "名單目前沒有登記信箱（管理者信箱固定寄送）。", "good");
    } else {
      s2MailShow(res.message || "完成。", "good");
      document.querySelector("#s2MailEmail").value = "";
    }
  } catch (e) {
    s2MailShow(`無法連線寄送服務：${e.message}`, "bad");
  } finally {
    document.querySelector("#s2MailPass").value = "";
  }
}

document.querySelector("#s2MailForm")?.addEventListener("submit", (e) => { e.preventDefault(); s2MailAction("subscribe"); });
document.querySelectorAll("#s2MailForm [data-mail-action]").forEach((b) => {
  if (b.type !== "submit") b.addEventListener("click", () => s2MailAction(b.dataset.mailAction));
});
initS2Mail();

async function s2LatestReport() {
  const box = document.querySelector("#s2LatestReport");
  if (!box) return;
  try {
    const ep = await s2EndpointReady();
    if (!ep) return;
    const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "latest_report" }) });
    const info = await r.json();
    box.textContent = info.available
      ? `可立即寄送的最新報告：${info.roc_month}（${info.month}）｜保存於 ${String(info.stored_at || "").slice(0, 16).replace("T", " ")}（報告僅存於管理者雲端硬碟，不公開）`
      : "尚無已保存的報告（每月排程執行後會自動保存）。";
  } catch (e) { /* 服務未更新 */ }
}
s2LatestReport();

// ================================================================ v3：異常偵測、通報回報、Gemini
const S2_EVENT_START = "2025-07";
const s2AnomClass = {
  new: { label: "疑似新崩塌（連續兩個月）", color: "#dc2626", tone: "nw-new" },
  new_pending: { label: "疑似新崩塌（待下月確認）", color: "#f97316", tone: "nw-new" },
  persisting: { label: "已通報崩塌（持續中）", color: "#7c3aed", tone: "nw-lake" },
  old_slide: { label: "舊崩塌地再變化", color: "#92400e", tone: "nw-slide" },
  r1: { label: "崩積／殘壩區內（已知範圍）", color: "#a16207", tone: "nw-slide" },
  lake: { label: "堰塞湖區（水位變化）", color: "#1d6fd8", tone: "nw-lake" },
  downstream: { label: "下游河道（土砂堆積）", color: "#64748b", tone: "nw-down" },
  channel: { label: "主河道沖刷／擴寬", color: "#64748b", tone: "nw-down" },
  transient: { label: "單月雜訊（不列警示）", color: "#94a3b8", tone: "nw-down" },
  new_bare: { label: "新增裸露（上月有植物）", color: "#dc2626", tone: "nw-new" },
  recurring: { label: "反覆裸露（可能耕作／季節性）", color: "#94a3b8", tone: "nw-down" },
  uncertain: { label: "可能變裸露（受霾，待確認）", color: "#f59e0b", tone: "nw-slide" }
};

function s2Esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function s2LakeWater(m) {
  if (m.month < S2_EVENT_START) return null;
  const w = m.lake_zone_water_ha;
  return w != null && w >= 0.5 ? w : null;
}

function s2RocOf(ym) {
  return s2Months().find((x) => x.month === ym)?.roc_month || ym || "—";
}

function s2RenderAnomaly(m) {
  const box = document.querySelector("#s2AnomCard");
  if (!box || !m) return;
  const mode = s2State.vegMode || "base";
  const key = `${m.month}|${mode}`;
  if (s2State.anomKey !== key) { s2State.anomKey = key; s2State.anomSel = null; }
  const sel = s2State.anomSel;
  const months = s2Months();
  document.querySelector("#s2VegMonth").textContent = `${m.roc_month}（${m.month}）${m.final ? "" : "暫定"}`;
  document.querySelectorAll("[data-veg-step]").forEach((b) => {
    const i = s2State.index + Number(b.dataset.vegStep);
    b.disabled = i < 0 || i >= months.length;
  });
  document.querySelector("#s2VegMode").innerHTML = Object.entries(s2VegModes).map(([k, t]) =>
    `<button type="button" role="tab" data-veg-mode="${k}" class="${k === mode ? "active" : ""}" aria-selected="${k === mode}">${t}</button>`).join("");

  const tabsDef = mode === "prev" ? [["dprev", "崩塌區近看"], ["overview_dprev", "全流域"]]
    : [["zanom", "崩塌區近看"], ["overview_zanom", "全流域"], ["recovery", "崩積區復育"]];
  const want = mode === "prev" ? (s2State.momLayer || "dprev") : (s2State.anomLayer || "zanom");
  const avail = Object.fromEntries(tabsDef.map(([k]) => [k, !!m.images?.[k]]));
  const useLayer = avail[want] ? want : (avail[tabsDef[0][0]] ? tabsDef[0][0] : (avail[tabsDef[1][0]] ? tabsDef[1][0] : null));
  document.querySelector("#s2AnomTabs").innerHTML = tabsDef.map(([k, t]) =>
    `<button type="button" data-s2-anomlayer="${k}" class="${k === useLayer ? "active" : ""}" ${avail[k] ? "" : "disabled"}>${t}</button>`).join("");
  const bw = document.querySelector("#s2AnomBlendWrap");
  if (bw) { bw.hidden = !useLayer; document.querySelector("#s2AnomBlend").value = String(Math.round((s2State.anomAlpha ?? 0.6) * 100)); }

  const mo = m.mom;
  const emptyMsg = mode === "prev"
    ? (mo?.skipped ? `無法與上月比較：${s2Esc(mo.skipped)}。` : "本月沒有可用的衛星影像（整月雲遮或無拍攝），無法與上月比較。")
    : "本月無植生變化資料（無影像或整月雲遮）。";
  document.querySelector("#s2AnomFigure").innerHTML = useLayer
    ? `<div class="s2-zoomable" data-s2-zoom="${useLayer}" tabindex="0" role="button" aria-label="放大">${s2FigureSvg(useLayer, m, { stamp: true })}</div>`
      + (mode === "prev" && mo?.prev && !mo.skipped ? `<p class="s2-small s2-cmp-note">比較：${s2Esc(m.roc_month)} ↔ ${s2Esc(mo.prev_roc || s2RocOf(mo.prev))}${mo.gap > 1 ? `（中間 ${mo.gap - 1} 個月雲遮或品質不足，改與最近一個清晰月份比較）` : ""}${mo.quality_note ? `；${s2Esc(mo.quality_note)}` : ""}</p>`
        + (mo.quality === "haze" ? `<p class="s2-skip">⚠ 本月影像受霾影響，變化數值僅供參考；可能變裸露的地點列為「待確認」，等下一個清晰月份再判定。</p>`
          : mo.quality === "partial" ? `<p class="s2-skip">本月部分雲遮，只比較兩個月都有影像的 ${mo.compared_pct ?? "—"}% 流域範圍。</p>` : "") : "")
    : `<p class="muted-empty">${emptyMsg}</p>`;
  const marksLegend = `<span><i class="mk" style="border-color:#dc2626"></i>系統標記（編號對應右側清單）</span>`;
  document.querySelector("#s2AnomLegend").innerHTML = useLayer === "recovery"
    ? `<span><i class="sw" style="background:#16a34a"></i>已自然長回植物</span><span><i class="sw" style="background:#facc15"></i>緩慢恢復中</span><span><i class="sw" style="background:#dc2626"></i>仍裸露（建議評估人工植生）</span><span class="s2-small">滑桿往左＝看衛星照片</span>`
    : mode === "prev"
      ? `<span><i class="ramp dramp"></i>紅＝比上月植物少　綠＝比上月多</span><span><i class="sw" style="background:#d6d3d1"></i>山的陰影</span><span><i class="sw" style="background:#fff;border:1px solid #c9d3d9"></i>任一月有雲</span>${marksLegend}`
      : `<span><i class="ramp zramp"></i>紅＝植物比往年同月少　綠＝比往年多</span><span><i class="sw" style="background:#d6d3d1"></i>山的陰影／資料不足</span><span><i class="sw" style="background:#fff;border:1px solid #c9d3d9"></i>雲</span>${marksLegend}`;

  const tile = (tone, title, value, subTxt) => `<div class="s2-plain-tile ${tone}"><span>${title}</span><strong>${value}</strong><small>${subTxt}</small></div>`;
  const plain = document.querySelector("#s2AnomPlain");
  const badge = document.querySelector("#s2AnomBadge");
  const list = s2VegList(m, mode);
  let statsHtml = "";
  let emptyList = "";
  if (mode === "prev") {
    const nb = list.filter((b) => b.class === "new_bare");
    if (!mo || mo.skipped) {
      plain.innerHTML = tile("grey", "新增裸露區塊", "無法比較", mo?.skipped ? s2Esc(mo.skipped) : "本月無可用衛星影像")
        + tile("grey", "崩積／殘壩區變化", "—", mo?.prev ? `上一個清晰月份：${s2Esc(s2RocOf(mo.prev))}` : "—")
        + tile("grey", "下游河道變化", "—", "請改看「與往年同月比」或切換月份");
      badge.textContent = "本月無法與上月比較";
      badge.classList.remove("alert");
    } else {
      const dec = mo.dec_ha || {}; const inc = mo.inc_ha || {};
      const pair = (a, b) => `<span class="t-red">−${a ?? 0}</span> ／ <span class="t-green">+${b ?? 0}</span> ha`;
      const un = list.filter((b) => b.class === "uncertain").length;
      const qTxt = { clear: "影像清晰", partial: "部分雲遮", haze: "受霾，僅供參考" }[mo.quality] || "";
      plain.innerHTML = tile(nb.length ? "red" : "green", `新增裸露區塊（與 ${s2Esc(mo.prev_roc || s2RocOf(mo.prev))} 比）`, `${nb.length} 處`,
          (nb.length ? "上個月還有植物、這個月變裸露的地點，請對照衛星照片確認" : "沒有發現上個月有植物、這個月變裸露的地點")
          + (un ? `；另 ${un} 處受霾待確認` : "") + (qTxt ? `（${qTxt}）` : ""))
        + tile("amber", "崩積／殘壩區變化", pair(dec.r1, inc.r1), `植物明顯減少／增加的面積（${s2Pitch((dec.r1 || 0) + (inc.r1 || 0))}）`)
        + tile("amber", "下游河道變化", pair(dec.downstream, inc.downstream), "河道沖淤與河灘植被的增減");
      badge.textContent = nb.length ? `較上月新增裸露 ${nb.length} 處` : "較上月無新增裸露";
      badge.classList.toggle("alert", nb.length > 0);
      statsHtml = `<details class="s2-tech"><summary>技術數據</summary><ul class="s2-anom-facts">
        <li>比較月份：${s2Esc(m.month)} − ${s2Esc(mo.prev)}（相隔 ${mo.gap} 個月）；參考林兩月整體差 ${mo.ref_shift} 已扣除</li>
        <li>可比較面積（流域內）${mo.usable_ha} ha；崩積／殘壩區平均 ΔNDVI ${mo.r1_mean_d ?? "—"}</li>
        <li>流域其他地區 |ΔNDVI| ≥ 0.20：減少 ${dec.other} ha、增加 ${inc.other} ha（已扣局部背景；多為薄雲、霾與光照差異，僅供參考）</li></ul></details>`;
    }
    emptyList = "與上個月相比，沒有面積 1 公頃以上新變裸露的區塊。";
  } else {
    const a = m.ndvi_anomaly;
    const alert = list.filter((f) => f.class === "new" || f.class === "new_pending");
    const nConf = list.filter((f) => f.class === "new").length;
    const nPend = alert.length - nConf;
    const n = a?.neg_ha || {};
    const negTotal = (n.r1 || 0) + (n.downstream || 0) + (n.other || 0);
    const rec = m.recovery?.debris;
    const recTot = rec ? (rec.natural_ha || 0) + (rec.slow_ha || 0) + (rec.needs_ha || 0) : 0;
    const pct = (v) => (recTot ? (100 * v) / recTot : 0);
    plain.innerHTML = [
      tile(!a || a.skipped ? "grey" : alert.length ? "red" : "green", "疑似新崩塌地",
        !a ? "—" : a.skipped ? "暫不判讀" : `${alert.length} 處`,
        !a ? "本月無可用衛星影像" : a.skipped ? `本月${s2Esc(a.skipped)}（影像受霾、雲影響或往年資料不足）`
          : alert.length ? `${nConf ? `${nConf} 處已連續兩個月出現` : ""}${nConf && nPend ? "、" : ""}${nPend ? `${nPend} 處待下月確認` : ""}，請現地查證`
            : "本月沒有發現植物突然消失的新地點"),
      tile("amber", "植物比往年同月少的面積", a && !a.skipped ? `${negTotal.toFixed(1)} ha` : "—",
        a && !a.skipped ? `${s2Pitch(negTotal)}；其中崩積／殘壩區 ${n.r1 ?? 0}、下游河道 ${n.downstream ?? 0} ha（多為 2025 年事件造成），其他零星 ${n.other ?? 0} ha` : "—"),
      rec && recTot
        ? `<div class="s2-plain-tile green"><span>崩積區植物恢復情形</span><strong>${Math.round(pct((rec.natural_ha || 0) + (rec.slow_ha || 0)))}% 開始長回</strong>
            <div class="s2-recbar"><i style="width:${pct(rec.natural_ha || 0).toFixed(1)}%;background:#16a34a"></i><i style="width:${pct(rec.slow_ha || 0).toFixed(1)}%;background:#facc15"></i><i style="width:${pct(rec.needs_ha || 0).toFixed(1)}%;background:#dc2626"></i></div>
            <small>自然長回 ${rec.natural_ha} ha｜緩慢 ${rec.slow_ha} ha｜仍裸露 ${rec.needs_ha} ha</small></div>`
        : tile("grey", "崩積區植物恢復情形", "—", "115/01 起提供（以 114/10–12 為事件後起點）")
    ].join("");
    badge.textContent = alert.length ? `疑似新崩塌 ${alert.length} 處` : "未發現疑似新崩塌";
    badge.classList.toggle("alert", alert.length > 0);
    if (a) {
      statsHtml = `${a.skipped ? `<p class="s2-skip">本月不列候選：${s2Esc(a.skipped)}（${a.skipped === "基準不足" ? "往年同月份影像不足，無法可靠比較" : "穩定林地的綠度也偏離往年，代表影像受霾或殘雲影響"}）</p>` : ""}
        <details class="s2-tech"><summary>技術數據</summary><ul class="s2-anom-facts">
        <li>基準：${s2Esc(a.baseline)}${a.in_baseline ? "（本月位於基準期內）" : ""}</li>
        <li>可判釋面積 ${a.usable_ha} ha；地形陰影遮罩 ${a.shadow_ha} ha</li>
        <li>負異常面積（z≤−2、ΔNDVI≤−0.20、NDVI&lt;0.25）：R1 ${n.r1 ?? 0} ha、下游 ${n.downstream ?? 0} ha、其他 ${n.other ?? 0} ha</li>
        <li>R1 平均 z：${a.r1_mean_z ?? "—"}</li></ul></details>`;
    }
    emptyList = a ? "本月沒有面積 1 公頃以上、植物明顯變少的區塊。" : "本月無可判讀影像。";
  }
  document.querySelector("#s2AnomStats").innerHTML = statsHtml;
  document.querySelector("#s2AnomList").innerHTML = list.length
    ? `<table class="s2-nw-table s2-anom-table"><thead><tr><th>#</th><th>類型</th><th>面積</th><th>座標</th><th></th></tr></thead><tbody>${list.map((f, i) => {
        const k = s2AnomClass[f.class] || s2AnomClass.new;
        return `<tr class="s2-anom-row${sel === i ? " on" : ""}" data-anom-row="${i}" tabindex="0" title="點選在地圖標示">
          <td><b class="s2-num" style="background:${k.color}">${i + 1}</b></td><td><span class="s2-nw-chip ${k.tone}">${k.label}</span></td>
          <td>${f.area_ha} ha<br><small>${s2Pitch(f.area_ha)}</small></td><td>${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}</td>
          <td class="s2-row-acts"><button type="button" class="outline s2-locate" data-anom-zoom="${i}">放大</button><button type="button" class="outline s2-locate" data-anom-gis="${i}" title="在空間研判地圖開啟並套疊同月份圖層">空間研判</button></td></tr>`;
      }).join("")}</tbody></table>`
    : `<p class="muted-empty">${emptyList}</p>`;
  const r = m.recovery;
  document.querySelector("#s2RecoveryStats").innerHTML = r
    ? `<table class="s2-nw-table"><thead><tr><th>分區</th><th>已自然長回</th><th>緩慢恢復</th><th>仍裸露（建議評估人工植生）</th></tr></thead><tbody>
        ${[["debris", "崩積區"], ["residual", "殘壩區"]].map(([k, t]) => {
          const z = r[k] || {};
          return `<tr><td>${t}</td><td>${z.natural_ha ?? "—"} ha</td><td>${z.slow_ha ?? "—"} ha</td><td>${z.needs_ha ?? "—"} ha</td></tr>`;
        }).join("")}</tbody></table><p class="s2-small">比較期間：${s2Esc(r.window)}。分級為衛星初篩，須以 UAV 與現地植生調查校正。</p>`
    : `<p class="s2-small">植物恢復分區自 115/01 起提供（以 114/10–12 為事件後初期基準）。</p>`;
}

function s2SelectAnom(i, from) {
  const m = s2Months()[s2State.index];
  const mode = s2State.vegMode || "base";
  const f = s2VegList(m, mode)[i];
  if (!f) return;
  s2State.anomKey = `${m.month}|${mode}`;
  s2State.anomSel = s2State.anomSel === i && from === "list" ? null : i;
  // 目前圖層看不到這個點 → 自動切到看得到的圖層
  const inView = s2Inside(s2LL2px(s2State.data.view, f.lat, f.lon));
  if (s2State.anomSel != null) {
    if (mode === "prev") {
      const cur = s2State.momLayer || "dprev";
      if (cur === "dprev" && !inView) s2State.momLayer = "overview_dprev";
    } else {
      const cur = s2State.anomLayer || "zanom";
      if (cur === "recovery" || (cur === "zanom" && !inView)) s2State.anomLayer = inView ? "zanom" : "overview_zanom";
    }
  }
  s2RenderAnomaly(m);
  if (from === "map") document.querySelector(`[data-anom-row="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  else document.querySelector("#s2AnomFigure")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function s2ZoomAnom(i) {
  const m = s2Months()[s2State.index];
  const mode = s2State.vegMode || "base";
  const f = s2VegList(m, mode)[i];
  if (!f) return;
  s2State.anomKey = `${m.month}|${mode}`;
  s2State.anomSel = i;
  const near = mode === "prev" ? "dprev" : "zanom";
  const far = mode === "prev" ? "overview_dprev" : "overview_zanom";
  const pv = s2LL2px(s2State.data.view, f.lat, f.lon);
  const inView = s2Inside(pv) && !!m.images?.[near];
  const p = inView ? pv : (s2LL2px(s2State.data.overview, f.lat, f.lon) || { x: f.ox, y: f.oy });
  s2RenderAnomaly(m);
  s2OpenLightboxAt(inView ? near : far, p.x, p.y, inView ? 3 : 5);
}

function s2RenderBasis() {
  const d = s2State.data;
  const box = document.querySelector("#s2Basis");
  if (!box || !d.threshold_basis) return;
  const refs = d.references || {};
  box.innerHTML = `<table class="s2-basis-table"><thead><tr><th>項目</th><th>門檻</th><th>依據</th></tr></thead><tbody>${d.threshold_basis.map((b) =>
      `<tr><td>${s2Esc(b.item)}</td><td>${s2Esc(b.rule)}</td><td>${s2Esc(b.basis)}</td></tr>`).join("")}</tbody></table>
    <details class="s2-refs"><summary>參考文獻（${Object.keys(refs).length} 篇）</summary><ol>${Object.values(refs).map((r) => `<li>${s2Esc(r)}</li>`).join("")}</ol>
    <p class="s2-small">${s2Esc(d.reference_note || "")}</p></details>`;
}

// ---------------------------------------------------------------- 通報報告：監測摘要與異常通報回報
var monState = { digest: null, sar: null, feedback: {}, items: [], sel: null, mapLayer: "overview" };

async function s2EndpointReady() {
  if (s2Mail.endpoint) return s2Mail.endpoint;
  try {
    const r = await fetch("./assets/sentinel2/report_mailer.json", { cache: "no-store" });
    if (r.ok) s2Mail.endpoint = (await r.json()).endpoint || null;
  } catch (e) { /* 未設定 */ }
  return s2Mail.endpoint;
}

function monAnomalies() {
  const out = [];
  const d = monState.digest;
  (d?.anomalies || []).forEach((a) => out.push(a));
  const st = monState.sar;
  if (st) {
    (st.points || []).filter((p) => p.level_class === "warn" || p.level_class === "danger").forEach((p) => {
      const pair = (st.freshness?.latest_pair || "").replace(/[^0-9]/g, "").slice(0, 16);
      out.push({ id: `SAR-${pair}-${p.name === "壩區" ? "DAM" : p.name === "堰塞湖區" ? "LAKE" : "ANOM"}`, source: "SAR", type: p.level,
        title: `SAR ${p.level}：${p.name}`, location: `${p.lat?.toFixed?.(4) ?? ""}, ${p.lon?.toFixed?.(4) ?? ""}`, value: p.latest, date: st.freshness?.latest_acquisition, severity: p.level_class === "danger" ? "high" : "medium" });
    });
  }
  Object.values(monState.feedback).filter((f) => String(f.id).startsWith("MAN-")).forEach((f) =>
    out.push({ id: f.id, source: "現地／人工", type: "人工通報", title: f.title || "人工通報", location: "", value: "", date: (f.updated || "").slice(0, 10), severity: "medium" }));
  return out;
}

function renderMonitoringNotice() {
  const box = document.querySelector("#monDigest");
  if (!box) return;
  const d = monState.digest;
  const st = monState.sar;
  const sarLine = st ? `SAR（Sentinel-1）最新配對 ${s2Esc(st.freshness?.latest_pair || "—")}，整體「${s2Esc(st.alert?.label || "—")}」，最後觀測距今 ${st.freshness?.latency_days ?? "—"} 天。` : "SAR 狀態載入中或無資料。";
  box.innerHTML = d
    ? `<p class="mon-head"><b>${s2Esc(d.roc_month)}（${s2Esc(d.month)}）${s2Esc(d.kind)}</b>｜產製 ${s2Esc(d.generated_at)}${d.sent_at ? `｜已寄送 ${s2Esc(d.sent_at)}` : ""}</p>
       <ul class="mon-list">${(d.conclusions || []).map((c) => `<li class="${c.startsWith("⚠") ? "warn" : ""}">${s2Esc(c)}</li>`).join("")}</ul>
       <p class="s2-small">最新 SAR：${sarLine}</p>`
    : `<p class="muted-empty">尚無監測月報摘要。</p><p class="s2-small">${sarLine}</p>`;
  const list = monAnomalies();
  monState.items = list;
  const tb = document.querySelector("#monAnomalies");
  const statusOf = (id) => monState.feedback[id]?.status || "待查證";
  const tone = { "待查證": "pending", "查證中": "working", "已確認異常": "confirmed", "誤報結案": "closed" };
  document.querySelector("#monAnomBadge").textContent = list.length ? `異常 ${list.length} 件（未結案 ${list.filter((a) => !["誤報結案"].includes(statusOf(a.id))).length}）` : "目前無異常通報";
  tb.innerHTML = list.length
    ? `<p class="s2-small s2-list-hint">點選列可在上方地圖標示位置；「定位」放大到該點的衛星影像。</p>
      <table class="s2-nw-table mon-table"><thead><tr><th>#</th><th>編號</th><th>來源／類型</th><th>內容</th><th>位置</th><th>日期</th><th>狀態</th><th></th></tr></thead><tbody>${list.map((a, i) => {
        const ll = monLoc(a);
        return `<tr class="mon-row${monState.sel === i ? " on" : ""}" data-mon-row="${i}" tabindex="0"><td><b class="s2-num" style="background:${monColor(a)}">${i + 1}</b></td><td>${s2Esc(a.id)}</td><td>${s2Esc(a.source)}<br><small>${s2Esc(a.type)}</small></td><td>${s2Esc(a.title)}${a.value ? `<br><small>${s2Esc(a.value)}</small>` : ""}</td>
         <td>${s2Esc(a.location)}</td><td>${s2Esc(a.date || "")}</td><td><span class="mon-status ${tone[statusOf(a.id)] || "pending"}">${statusOf(a.id)}</span></td>
         <td class="mon-acts">${ll ? `<button type="button" class="outline" data-mon-zoom-i="${i}">定位</button><button type="button" class="outline" data-mon-gis="${i}">空間研判</button>` : ""}<button type="button" class="outline mon-reply" data-mon-id="${s2Esc(a.id)}">回報</button></td></tr>`;
      }).join("")}</tbody></table>`
    : `<p class="muted-empty">目前無 Sentinel-2 新生水域／新生崩塌候選，SAR 亦未達黃色或紅色警戒。</p>`;
  const sel = document.querySelector("#monFbId");
  if (sel) sel.innerHTML = list.map((a) => `<option value="${s2Esc(a.id)}">${s2Esc(a.id)}｜${s2Esc(a.title)}</option>`).join("") || `<option value="">（無異常）</option>`;
  monRenderMap();
}

function monLoc(a) {
  const r = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(a?.location || "");
  return r ? { lat: Number(r[1]), lon: Number(r[2]) } : null;
}

function monColor(a) {
  if (a.source === "SAR") return a.severity === "high" ? "#dc2626" : "#d97706";
  if (/待下月/.test(a.title || "")) return "#f97316";
  return "#dc2626";
}

function monMapMonth() {
  const months = s2Months();
  if (!months.length) return null;
  const want = monState.digest?.month;
  return months.find((x) => x.month === want && x.images) || months.find((x) => x.month === s2State.data.latest_usable_month) || null;
}

function monMapSvg() {
  const m = monMapMonth();
  if (!m) return "";
  const meta = s2State.data.overview;
  const w = 1000; const h = +(w / meta.aspect).toFixed(1);
  const sel = monState.sel;
  const marks = monState.items.map((a, i) => {
    const ll = monLoc(a);
    const p = ll && s2LL2px(meta, ll.lat, ll.lon);
    if (!s2Inside(p)) return "";
    return s2MarkSvg({ x: +(p.x * w).toFixed(1), y: +(p.y * h).toFixed(1), r: 13 + (sel === i ? 4 : 0), color: monColor(a), label: i + 1,
      on: sel === i, dim: sel != null && sel !== i, attrs: `data-mon-i="${i}"`, title: `${i + 1}. ${a.title}`, square: a.source === "SAR" });
  }).join("");
  const layer = m.images?.[monState.mapLayer] ? monState.mapLayer : "overview";
  return s2FigureSvg(layer, m, { marks: false, stamp: true, extra: marks });
}

function monLayerButtons(attr) {
  const m = monMapMonth();
  return [["overview", "衛星影像（真色）"], ["overview_zanom", "植生變化疊合"]].map(([k, t]) =>
    `<button type="button" ${attr}="${k}" class="${k === monState.mapLayer ? "active" : ""}" ${m?.images?.[k] ? "" : "disabled"}>${t}</button>`).join("");
}

function monRenderMap() {
  const box = document.querySelector("#monMap");
  if (!box) return;
  const m = s2State.data ? monMapMonth() : null;
  if (!m) { box.innerHTML = `<p class="muted-empty">衛星圖載入中…</p>`; return; }
  document.querySelector("#monMapTabs").innerHTML = monLayerButtons("data-mon-layer");
  const bw = document.querySelector("#monBlendWrap");
  if (bw) { bw.hidden = monState.mapLayer !== "overview_zanom"; document.querySelector("#monBlend").value = String(Math.round((s2State.anomAlpha ?? 0.6) * 100)); }
  document.querySelector("#monMapTime").textContent = `底圖：${m.roc_month}（${m.month}）月合成衛星影像｜${m.n_scenes || 0} 景${m.final ? "" : "（月中暫定）"}｜點地圖可放大`;
  box.innerHTML = `<div class="s2-zoomable" data-mon-zoom tabindex="0" role="button" aria-label="放大點位分布圖">${monMapSvg()}</div>`;
  const onMap = monState.items.filter((a) => s2Inside(s2LL2px(s2State.data.overview, monLoc(a)?.lat, monLoc(a)?.lon))).length;
  document.querySelector("#monMapLegend").innerHTML = `<span><i class="mk" style="border-color:#dc2626"></i>疑似新崩塌／新生水域</span><span><i class="mk" style="border-color:#f97316"></i>待下月確認</span>
    <span><i class="mk sq" style="border-color:#d97706"></i>SAR 黃／紅燈</span><span class="s2-small">圖上 ${onMap} 點；編號對應下方清單</span>`;
}

function monCustomZoom() {
  const m = monMapMonth();
  s2Zoom.custom = {
    title: () => "異常點位分布圖",
    sub: () => `${m.roc_month}（${m.month}）月合成衛星影像`,
    svg: () => monMapSvg(),
    layers: () => monLayerButtons("data-lb-mon"),
    blend: () => monState.mapLayer === "overview_zanom"
  };
}

function monSelect(i, from) {
  monState.sel = monState.sel === i && from === "list" ? null : i;
  monRenderMap();
  document.querySelectorAll("[data-mon-row]").forEach((tr) => tr.classList.toggle("on", Number(tr.dataset.monRow) === monState.sel));
  if (from === "map") document.querySelector(`[data-mon-row="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  else document.querySelector("#monMap")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function monZoom(i) {
  const ll = monLoc(monState.items[i]);
  const p = ll && s2LL2px(s2State.data?.overview, ll.lat, ll.lon);
  monState.sel = i;
  monRenderMap();
  document.querySelectorAll("[data-mon-row]").forEach((tr) => tr.classList.toggle("on", Number(tr.dataset.monRow) === i));
  monCustomZoom();
  if (s2Inside(p)) s2OpenLightboxAt("custom", p.x, p.y, 5); else s2OpenLightbox("custom");
}

document.querySelector("#report")?.addEventListener("click", (e) => {
  const mk = e.target.closest("[data-mon-i]");
  if (mk) { monSelect(Number(mk.dataset.monI), "map"); return; }
  const lz = e.target.closest("[data-mon-zoom-i]");
  if (lz) { monZoom(Number(lz.dataset.monZoomI)); return; }
  const lg = e.target.closest("[data-mon-gis]");
  if (lg) {
    const a = monState.items[Number(lg.dataset.monGis)];
    const ll = monLoc(a);
    const mi = s2Months().findIndex((x) => x.month === monState.digest?.month);
    if (mi >= 0 && mi !== s2State.index) selectS2Observation(mi);
    if (ll) gisOpenAt(ll.lat, ll.lon, a.title);
    return;
  }
  const ly = e.target.closest("[data-mon-layer]");
  if (ly) { if (!ly.disabled) { monState.mapLayer = ly.dataset.monLayer; monRenderMap(); } return; }
  const z = e.target.closest("[data-mon-zoom]");
  if (z && s2State.data) { monCustomZoom(); s2OpenLightbox("custom"); return; }
  const row = e.target.closest("[data-mon-row]");
  if (row && !e.target.closest("button")) monSelect(Number(row.dataset.monRow), "list");
});
document.querySelector("#report")?.addEventListener("keydown", (e) => {
  const row = e.target.closest("[data-mon-row]");
  if (row && e.key === "Enter" && !e.target.closest("button")) monSelect(Number(row.dataset.monRow), "list");
});

async function monPost(payload) {
  const ep = await s2EndpointReady();
  if (!ep) throw new Error("寄送服務尚未設定");
  const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
  return r.json();
}

async function initMonitoringNotice() {
  if (!document.querySelector("#monDigest")) return;
  try {
    const r = await fetch("./assets/sentinel2/monitoring_digest.json", { cache: "no-store" });
    if (r.ok) monState.digest = await r.json();
  } catch (e) { /* 無摘要 */ }
  try {
    const r = await fetch("./monitor_status.json", { cache: "no-store" });
    if (r.ok) monState.sar = await r.json();
  } catch (e) { /* 無SAR */ }
  try {
    const res = await monPost({ action: "list_feedback" });
    (res.items || []).forEach((f) => { monState.feedback[f.id] = f; });
  } catch (e) { /* 無回報 */ }
  renderMonitoringNotice();
  renderReport();
  if (typeof gisSarRender === "function") gisSarRender();
}

function monShow(msg, tone) {
  const box = document.querySelector("#monFbResult");
  box.className = `s2-mail-result ${tone || ""}`;
  box.innerHTML = msg;
}

document.querySelector("#monAnomalies")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mon-id]");
  if (!b) return;
  document.querySelector("#monFbMode").value = "update";
  document.querySelector("#monFbId").value = b.dataset.monId;
  document.querySelector("#monFbForm").scrollIntoView({ behavior: "smooth", block: "center" });
});

document.querySelector("#monFbMode")?.addEventListener("change", (e) => {
  const manual = e.target.value === "new";
  document.querySelector("#monFbIdWrap").hidden = manual;
  document.querySelector("#monFbTitleWrap").hidden = !manual;
});

document.querySelector("#monFbForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const manual = document.querySelector("#monFbMode").value === "new";
  const id = manual ? `MAN-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12)}` : document.querySelector("#monFbId").value;
  const title = manual ? document.querySelector("#monFbTitle").value.trim() : (monState.items.find((a) => a.id === id)?.title || "");
  const password = document.querySelector("#monFbPass").value;
  if (!id) { monShow("請選擇通報項目。", "bad"); return; }
  if (manual && !title) { monShow("請輸入通報標題。", "bad"); return; }
  if (!password) { monShow("請輸入權限密碼。", "bad"); return; }
  monShow("儲存中…");
  try {
    const res = await monPost({ action: "save_feedback", password, id, title, status: document.querySelector("#monFbStatus").value,
      responder: document.querySelector("#monFbWho").value.trim(), note: document.querySelector("#monFbNote").value.trim() });
    if (!res.ok) { monShow(s2Esc(res.error || "儲存失敗"), "bad"); return; }
    monState.feedback[res.item.id] = res.item;
    monShow(s2Esc(res.message), "good");
    document.querySelector("#monFbNote").value = "";
    renderMonitoringNotice();
  } catch (err) {
    monShow(`無法連線：${s2Esc(err.message)}`, "bad");
  } finally {
    document.querySelector("#monFbPass").value = "";
  }
});

document.querySelector("#monFbHistory")?.addEventListener("click", async () => {
  const password = document.querySelector("#monFbPass").value;
  if (!password) { monShow("查看完整紀錄需輸入權限密碼。", "bad"); return; }
  try {
    const res = await monPost({ action: "list_feedback_full", password });
    if (!res.ok) { monShow(s2Esc(res.error), "bad"); return; }
    monShow(res.items.length ? `<ul class="mon-list">${res.items.map((f) => `<li><b>${s2Esc(f.id)}</b>｜${s2Esc(f.title)}｜${s2Esc(f.status)}｜${s2Esc(f.responder)}｜${s2Esc((f.updated || "").slice(0, 16).replace("T", " "))}<br><small>${s2Esc(f.note)}</small></li>`).join("")}</ul>` : "尚無回報紀錄。", "good");
  } catch (err) {
    monShow(`無法連線：${s2Esc(err.message)}`, "bad");
  } finally {
    document.querySelector("#monFbPass").value = "";
  }
});

function monitoringReportSection() {
  const d = monState.digest;
  const lines = [];
  if (d) {
    lines.push(`\n五、遙測監測摘要（${d.roc_month} ${d.kind}，Sentinel-2＋SAR）`);
    (d.conclusions || []).forEach((c) => lines.push(`・${c}`));
  }
  const list = monState.items || [];
  if (list.length) {
    lines.push(`\n六、異常通報與回報（${list.length} 件）`);
    list.forEach((a) => lines.push(`・${a.id}｜${a.title}｜${a.location || "—"}｜${monState.feedback[a.id]?.status || "待查證"}`));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- AI 專家摘要：監測整合＋Gemini
function monitoringContextText() {
  const lines = ["【案件參數】", ...keyMetricLines()];
  const d = monState.digest;
  if (d) {
    lines.push(`【遙測監測 ${d.roc_month} ${d.kind}】`, ...(d.conclusions || []));
  }
  const st = monState.sar;
  if (st) {
    lines.push(`【SAR】最新配對 ${st.freshness?.latest_pair}，${st.alert?.label}；` + (st.points || []).map((p) => `${p.name} ${p.latest}（${p.level}）`).join("；"));
  }
  const list = monState.items || [];
  if (list.length) lines.push("【異常通報】" + list.map((a) => `${a.title}（${monState.feedback[a.id]?.status || "待查證"}）`).join("；"));
  return lines.join("\n");
}

async function initGeminiPanel() {
  const box = document.querySelector("#geminiStatus");
  if (!box) return;
  try {
    const st = await monPost({ action: "ai_status" });
    const ok = st.ok && st.enabled;
    box.textContent = ok ? `Gemini 2.5 Flash 已啟用｜今日剩餘 ${st.remaining} 次` : "Gemini 尚未設定 API 金鑰";
    box.classList.toggle("alert", !ok);
    document.querySelector("#geminiKeyForm").hidden = ok;
    document.querySelector("#generateGemini").disabled = !ok;
  } catch (e) {
    box.textContent = "無法連線 AI 服務";
    document.querySelector("#generateGemini").disabled = true;
  }
}

document.querySelector("#generateGemini")?.addEventListener("click", async () => {
  const btn = document.querySelector("#generateGemini");
  btn.disabled = true;
  aiReply.dataset.locked = "true";
  aiReply.innerHTML = `<p class="ai-placeholder">Gemini 判讀中（約 5–20 秒）…</p>`;
  try {
    const res = await monPost({ action: "ai_summary", question: aiQuestion.value || "請綜合判讀目前狀況並提出建議。", context: monitoringContextText() });
    if (!res.ok) { aiReply.innerHTML = `<p class="bad">${s2Esc(res.error)}</p>`; return; }
    aiReply.innerHTML = `<p><b>【Gemini 2.5 Flash 判讀】</b></p>` + s2Esc(res.text).split("\n").map((l) => l.trim() ? `<p>${l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>` : "<br>").join("")
      + `<p class="s2-small">本回覆由 Gemini 依本頁案件參數與監測摘要生成，僅供專家輔助；正式判斷請依現地查證與主管機關程序。今日剩餘 ${res.remaining} 次。</p>`;
    document.querySelector("#geminiStatus").textContent = `Gemini 2.5 Flash 已啟用｜今日剩餘 ${res.remaining} 次`;
  } catch (err) {
    aiReply.innerHTML = `<p class="bad">無法連線 AI 服務：${s2Esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
});

document.querySelector("#geminiKeyForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.querySelector("#geminiKeyResult");
  const key = document.querySelector("#geminiKey").value.trim();
  const password = document.querySelector("#geminiPass").value;
  if (!key || !password) { out.className = "s2-mail-result bad"; out.textContent = "請輸入 API 金鑰與權限密碼。"; return; }
  out.className = "s2-mail-result"; out.textContent = "設定中…";
  try {
    const res = await monPost({ action: "set_ai_key", password, api_key: key });
    out.className = `s2-mail-result ${res.ok ? "good" : "bad"}`;
    out.textContent = res.ok ? res.message : res.error;
    if (res.ok) initGeminiPanel();
  } catch (err) {
    out.className = "s2-mail-result bad"; out.textContent = `無法連線：${err.message}`;
  } finally {
    document.querySelector("#geminiKey").value = "";
    document.querySelector("#geminiPass").value = "";
  }
});

initMonitoringNotice().then(() => { renderAiSummary(); initGeminiPanel(); });

document.querySelector("#s2Prev")?.addEventListener("click", () => s2Step(-1));
document.querySelector("#s2Next")?.addEventListener("click", () => s2Step(1));
document.querySelector("#s2Play")?.addEventListener("click", () => {
  const button = document.querySelector("#s2Play");
  if (s2State.timer) {
    clearInterval(s2State.timer);
    s2State.timer = null;
    button.textContent = "▶ 播放時序";
    return;
  }
  button.textContent = "Ⅱ 暫停";
  s2Step(1);
  s2State.timer = setInterval(() => s2Step(1), 900);
});

renderPendingPoints();

addParameterSketches();
const modelDateInput = document.querySelector("#model3dDate");
if (modelDateInput && !modelDateInput.value) modelDateInput.value = new Date().toISOString().slice(0, 10);
initSpatialMap();
compute();
renderMonitor();
initSentinel2();
if (pageTitles[location.hash.slice(1)]) showPage(location.hash.slice(1));
window.addEventListener('hashchange', () => {
  if (pageTitles[location.hash.slice(1)]) showPage(location.hash.slice(1));
});
selectTerrainMetadata('matayan_20250930').catch(error => console.warn(error.message));


// ================================================================ 空間研判連動：Sentinel-2 月圖層、自動圈繪、實測 DSM 高程
var gisS2 = { overlay: null, outlines: null, marks: null, regions: null, vec: {}, opacity: 0.7, pane: null };

// 仿射貼圖：Sentinel-2 影像為 UTM 網格，與 Web Mercator 底圖有約 0.7° 旋轉；以左上、右上、左下三角經緯度精確貼合
const GisAffineOverlay = window.L ? L.ImageOverlay.extend({
  initialize(url, corners, options) {
    this._corners = corners.map((c) => L.latLng(c[0], c[1]));
    const [tl, tr, bl] = this._corners;
    const br = L.latLng(tr.lat + bl.lat - tl.lat, tr.lng + bl.lng - tl.lng);
    L.ImageOverlay.prototype.initialize.call(this, url, L.latLngBounds([tl, tr, bl, br]), options);
  },
  onAdd(map) {
    L.ImageOverlay.prototype.onAdd.call(this, map);
    this._image.style.transformOrigin = "0 0";
    this._image.addEventListener("load", () => this._map && this._reset());
  },
  _applyMatrix(pts) {
    const img = this._image;
    if (!img || !img.naturalWidth) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const [tl, tr, bl] = pts;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
  },
  _reset() {
    if (this._map) this._applyMatrix(this._corners.map((c) => this._map.latLngToLayerPoint(c)));
  },
  _animateZoom(e) {
    this._applyMatrix(this._corners.map((c) => this._map._latLngToNewLayerPoint(c, e.zoom, e.center)));
  }
}) : null;

const GIS_REGION_STYLE = {
  watershed: { color: "#e2e8f0", weight: 1.5, dashArray: "6 5", label: "馬太鞍溪集水區" },
  downstream_all: { color: "#60a5fa", weight: 2, dashArray: "6 5", label: "下游河道區" },
  lake_max: { color: "#22d3ee", weight: 2, dashArray: "4 4", label: "2025 堰塞湖最大範圍" },
  debris: { color: "#f59e0b", weight: 2.5, label: "崩積區" },
  residual: { color: "#ec4899", weight: 2.5, label: "殘壩區" }
};
const GIS_LAYER_NOTE = {
  tc: "Sentinel-2 當月去雲合成真色（10 m）；可拉透明度與 Esri 高解析影像比對崩塌邊界。",
  ndvi: "褐色＝裸露（NDVI < 0.25）、綠色＝植生。",
  zanom: "紅＝植物比往年同月少、綠＝比往年多（2019–2024 同月份基準）。",
  dprev: "紅＝比上個月植物少、綠＝比上個月多。",
  recovery: "綠＝已自然長回、黃＝緩慢恢復、紅＝仍裸露（建議評估人工植生）。",
  ndwi: "深藍＝判釋水域。"
};

async function gisLoadRegions() {
  if (!gisS2.regions) {
    const r = await fetch("./assets/sentinel2/regions_wgs84.geojson");
    if (!r.ok) throw new Error("區域輪廓載入失敗");
    gisS2.regions = await r.json();
  }
  return gisS2.regions;
}

async function gisLoadVec(m) {
  if (!m?.images?.vec) return null;
  if (!gisS2.vec[m.month]) {
    const r = await fetch(m.images.vec);
    gisS2.vec[m.month] = r.ok ? await r.json() : null;
  }
  return gisS2.vec[m.month];
}

function gisS2Init() {
  const map = spatialState.map;
  if (!map || gisS2.pane) return;
  gisS2.pane = map.createPane("gisS2Pane");
  gisS2.pane.style.zIndex = 350;              // 在 Esri 底圖之上、圈繪圖形之下
  gisS2.pane.style.pointerEvents = "none";
  map.createPane("gisRefPane").style.zIndex = 390;
  map.getPane("gisRefPane").style.pointerEvents = "none";
  document.querySelector("#gisS2Layer")?.addEventListener("change", gisS2Render);
  document.querySelector("#gisS2Outlines")?.addEventListener("change", gisS2Render);
  document.querySelector("#gisS2Marks")?.addEventListener("change", gisS2Render);
  document.querySelector("#gisS2Opacity")?.addEventListener("input", (e) => {
    gisS2.opacity = Number(e.target.value) / 100;
    if (gisS2.overlay) gisS2.overlay.setOpacity(gisS2.opacity);
  });
  document.querySelectorAll("[data-gis-step]").forEach((b) => b.addEventListener("click", () => {
    if (!s2State.data) return;
    selectS2Observation(s2State.index + Number(b.dataset.gisStep));      // 同步 Sentinel-2 頁
  }));
  document.querySelectorAll("[data-gis-auto]").forEach((b) => b.addEventListener("click", () => gisAutoDraw(b.dataset.gisAuto)));
  gisS2Render();
}

async function gisS2Render() {
  const map = spatialState.map;
  const label = document.querySelector("#gisS2Month");
  if (!map || !label || !gisS2.pane) return;
  if (!s2State.data) { label.textContent = "Sentinel-2 資料載入中…"; return; }
  const m = s2Months()[s2State.index];
  const months = s2Months();
  label.textContent = `${m.roc_month}（${m.month}）${m.final ? "" : "暫定"}`;
  document.querySelectorAll("[data-gis-step]").forEach((b) => {
    const i = s2State.index + Number(b.dataset.gisStep);
    b.disabled = i < 0 || i >= months.length;
  });
  // 影像
  if (gisS2.overlay) { map.removeLayer(gisS2.overlay); gisS2.overlay = null; }
  const layer = document.querySelector("#gisS2Layer").value;
  const scenes = m.scenes || [];
  const notes = [];
  const saviP = layer.startsWith("savi:") && typeof saviState !== "undefined" ? saviState.data?.periods.find((p) => p.key === layer.slice(5)) : null;
  const url = saviP ? null : layer && m.images?.[layer];
  if (saviP && GisAffineOverlay) {
    gisS2.overlay = new GisAffineOverlay(saviP.images.class, saviState.data.overlay.corners_ll, { opacity: gisS2.opacity, interactive: false, pane: "gisS2Pane" }).addTo(map);
    notes.push(`SAVI ${saviP.label}（${saviP.note}，${saviP.months_used.length} 個月中位數合成，不隨上方月份切換）：淺藍＝水體、橘＝裸露地、淺綠＝稀疏植生、深綠＝茂密植生；灰＝雲遮無資料。`);
  } else if (layer.startsWith("savi:")) notes.push("SAVI 資料載入中，請稍候再選一次。");
  if (layer && !saviP && !layer.startsWith("savi:") && !url) notes.push(`${m.roc_month} 沒有此圖層（整月雲遮或資料不足），請切換月份。`);
  if (url && GisAffineOverlay) {
    gisS2.overlay = new GisAffineOverlay(url, s2State.data.view.corners_ll, { opacity: gisS2.opacity, interactive: false, pane: "gisS2Pane" }).addTo(map);
    notes.push(`${GIS_LAYER_NOTE[layer] || ""}影像日期：${scenes.map((x) => x.date.slice(5).replace("-", "/")).join("、") || "—"}；白色＝雲遮。`);
  }
  // 區域輪廓
  if (gisS2.outlines) { map.removeLayer(gisS2.outlines); gisS2.outlines = null; }
  if (document.querySelector("#gisS2Outlines").checked) {
    try {
      const reg = await gisLoadRegions();
      gisS2.outlines = L.geoJSON(reg, {
        pane: "gisRefPane",
        interactive: false,
        filter: (f) => !!GIS_REGION_STYLE[f.properties.id],
        style: (f) => ({ ...GIS_REGION_STYLE[f.properties.id], fill: false })
      }).addTo(map);
      notes.push("輪廓：橘＝崩積區、桃紅＝殘壩區、青虛線＝2025 湖域最大範圍、藍虛線＝下游河道區。");
    } catch (e) { notes.push(e.message); }
  }
  // 本月候選點（與 Sentinel-2 頁清單同編號）
  if (gisS2.marks) { map.removeLayer(gisS2.marks); gisS2.marks = null; }
  if (document.querySelector("#gisS2Marks").checked) {
    const pts = [];
    (m.ndvi_anomaly?.candidates || []).forEach((c, i) => {
      if (["new", "new_pending", "persisting"].includes(c.class)) pts.push({ ...c, tag: `往年比 #${i + 1}`, color: s2AnomClass[c.class]?.color || "#dc2626" });
    });
    (m.mom?.blocks || []).forEach((b, i) => {
      if (b.class === "new_bare" || b.class === "uncertain") pts.push({ ...b, tag: `上月比 #${i + 1}`, color: s2AnomClass[b.class]?.color || "#dc2626" });
    });
    gisS2.marks = L.layerGroup(pts.map((f) => L.circleMarker([f.lat, f.lon], { pane: "gisRefPane", radius: 10, color: f.color, weight: 3, fill: false, interactive: false })
      .bindTooltip(`${f.tag}｜${s2AnomClass[f.class]?.label || f.class} ${f.area_ha} ha`, { permanent: true, direction: "right", className: "gis-s2-tip" }))).addTo(map);
    if (pts.length) notes.push(`本月標記 ${pts.length} 處（編號同 Sentinel-2 頁清單）。`);
  }
  document.querySelector("#gisS2Note").textContent = notes.join(" ");
  if (typeof gisSarRender === "function") gisSarRender();
}

async function gisAutoDraw(kind) {
  const map = spatialState.map;
  if (!map || !s2State.data) return;
  const m = s2Months()[s2State.index];
  let feature = null;
  try {
    if (kind === "residual") feature = (await gisLoadRegions()).features.find((f) => f.properties.id === "residual");
    else feature = (await gisLoadVec(m))?.features.find((f) => f.properties.kind === (kind === "bare" ? "bare_slide" : "water"));
  } catch (e) { setMapStatus(`載入失敗：${e.message}`); return; }
  if (!feature) {
    setMapStatus(`${m.roc_month} 沒有可用的${kind === "water" ? "水域" : "裸露"}範圍（雲遮或無影像），請切換月份。`);
    return;
  }
  const mode = { bare: "landslide", residual: "damFootprint", water: "lakeRef" }[kind];
  const meta = measureMeta[mode] || { label: "壩區水域（參考）", color: "#0891b2" };
  const area = feature.properties.area_ha * 1e4;
  spatialState.drawnLayers.filter((f) => f.auto === kind).forEach((f) => map.removeLayer(f.layer));
  spatialState.drawnLayers = spatialState.drawnLayers.filter((f) => f.auto !== kind);
  const layer = L.geoJSON(feature, { interactive: false, style: { color: meta.color, weight: 2.5, fillColor: meta.color, fillOpacity: 0.22 } }).addTo(map);
  const source = kind === "residual" ? "殘壩區輪廓（簡報圖3-29 多期判釋）" : `Sentinel-2 ${m.roc_month} ${kind === "bare" ? "裸露（NDVI < 0.25，崩積區外擴 300 m，扣殘壩區與湖域）" : "壩區水域（MNDWI）"}`;
  const valueLabel = `${fmtCompact(area, 0, " m²")}（${feature.properties.area_ha} ha）`;
  layer.bindPopup(`<div class="spatial-popup"><b>${meta.label}（自動圈繪）</b><span>${valueLabel}</span><span>來源：${source}</span><span>10 m 解析度初圈，請以 Esri 高解析影像或 UAV 正射檢核邊界；需要修正時可改用手動圈繪覆蓋。</span></div>`);
  const feat = addDrawnFeature({ mode, label: `${meta.label}｜${kind === "residual" ? "殘壩區輪廓" : `S2 ${m.roc_month}`}`, valueLabel, layer, color: meta.color });
  feat.auto = kind;
  if (mode === "landslide") spatialState.result.landslideArea = area;
  if (mode === "damFootprint") spatialState.result.damFootprintArea = area;
  if (mode === "lakeRef") spatialState.result.lakeArea = area;
  map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 16 });
  if (mode === "landslide" || mode === "damFootprint") demDiffRefresh();
  renderSpatialResults();
  if (mode !== "lakeRef") autoImportSpatialEstimates(`已由${source}自動圈繪 ${meta.label} ${valueLabel}，`);
  else setMapStatus(`已圈繪本月壩區水域 ${valueLabel}（參考；湖面積與庫容請於「庫容剖面」頁檢核）。`);
}

// ---------------------------------------------------------------- 實測 DSM 高程（與 3D 模型同一資料）
const DSM_SOURCES = {
  uav0930: { file: "matayan_20250930_dsm.tif", label: "UAV 實測 DSM 2025-09-30（5 m）", short: "09/30 UAV" },
  uav0920: { file: "matayan_20250920_dsm.tif", label: "UAV 實測 DSM 2025-09-20（5 m）", short: "09/20 UAV" },
  cop30: { file: "matayan_cop30_dsm.tif", label: "災前 Copernicus DEM（30 m，2011–2015）", short: "災前 DEM" }
};
const TWD97_TM2 = "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
var dsmState = { rasters: {}, loading: null };

function gisLoadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((x) => x.src === src)) { resolve(); return; }
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.head.appendChild(el);
  });
}

function dsmReady() {
  if (!dsmState.loading) {
    dsmState.loading = (async () => {
      await gisLoadScript("https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js");
      await gisLoadScript("https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js");
      await Promise.all(Object.entries(DSM_SOURCES).map(async ([id, src]) => {
        try {
          const buf = await (await fetch(`./assets/models/${src.file}`)).arrayBuffer();
          const img = await (await GeoTIFF.fromArrayBuffer(buf)).getImage();
          const [data] = await img.readRasters();
          dsmState.rasters[id] = { data, w: img.getWidth(), h: img.getHeight(), bbox: img.getBoundingBox(), nodata: img.getGDALNoData() };
        } catch (e) { console.warn("DSM 載入失敗", id, e); }
      }));
      try { dsmState.align = (await (await fetch("./assets/models/dsm_alignment.json")).json()).models || {}; } catch (e) { dsmState.align = {}; }
    })().catch((e) => { dsmState.loading = null; throw e; });
  }
  return dsmState.loading;
}

function dsmToTm(lat, lng) {
  return proj4("EPSG:4326", TWD97_TM2, [lng, lat]);
}

function dsmSample(id, E, N) {
  const r = dsmState.rasters[id];
  if (!r) return null;
  const [x0, y0, x1, y1] = r.bbox;
  const fx = (E - x0) / ((x1 - x0) / r.w) - 0.5;
  const fy = (y1 - N) / ((y1 - y0) / r.h) - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i + 1 >= r.w || j + 1 >= r.h) return null;
  const at = (a, b) => {
    const z = r.data[b * r.w + a];
    return !Number.isFinite(z) || z < -1000 || (r.nodata != null && Math.abs(z - r.nodata) < 1e-3) ? null : z;
  };
  const q = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
  if (q.some((z) => z == null)) return at(Math.round(fx), Math.round(fy));
  const tx = fx - i;
  const ty = fy - j;
  return q[0] * (1 - tx) * (1 - ty) + q[1] * tx * (1 - ty) + q[2] * (1 - tx) * ty + q[3] * tx * ty;
}

async function lookupElevationDetail(latlng, target) {
  const vals = {};
  let note = "";
  try {
    await dsmReady();
    const [E, N] = dsmToTm(latlng.lat, latlng.lng);
    Object.keys(DSM_SOURCES).forEach((id) => { vals[id] = dsmSample(id, E, N); });
  } catch (e) { note = `DSM 無法載入（${e.message}），改用公開 DEM。`; }
  const pref = document.querySelector("#elevationSource")?.value || "auto";
  const preTargets = ["riverbedElevation", "slopeUpElevation", "slopeDownElevation"];
  const order = pref === "auto" ? (preTargets.includes(target) ? ["cop30", "uav0930", "uav0920"] : ["uav0930", "uav0920", "cop30"])
    : (DSM_SOURCES[pref] ? [pref] : []);
  let used = order.find((id) => vals[id] != null);
  let value = used ? vals[used] : null;
  let label = used ? DSM_SOURCES[used].label : "";
  if (value == null) {
    value = await lookupElevation(latlng);
    used = "glo90";
    label = "公開 DEM GLO-90（Open-Meteo，90 m；此點不在 UAV DSM 範圍內或選擇此來源）";
  }
  return { value, used, label, vals, note };
}

function dsmDetailHtml(d) {
  const rows = Object.entries(DSM_SOURCES).map(([id, s]) => `<span>${s.short}：${d.vals[id] == null ? "範圍外" : `${d.vals[id].toFixed(1)} m`}</span>`).join("");
  const pid = d.vals.uav0930 != null ? "uav0930" : "uav0920";
  const post = d.vals[pid];
  const diff = post != null && d.vals.cop30 != null ? post - d.vals.cop30 - dsmOffset(pid) : null;
  return `${rows}${diff == null ? "" : `<span><b>災後 − 災前：${diff >= 0 ? "+" : ""}${diff.toFixed(1)} m</b>（${diff >= 0 ? "堆積／抬升" : "剝蝕／下降"}；已扣穩定地表偏移 ${dsmOffset(pid).toFixed(1)} m；災前 DEM 含樹冠，林地差值偏小約 10–20 m）</span>`}${d.note ? `<span>${d.note}</span>` : ""}`;
}


// ---------------------------------------------------------------- DSM 剖面與 DEM 差分
const DEM_POST = { uav0930: "#dc2626", uav0920: "#f59e0b" };

function demLatLngs(layer) {
  // 手動圈繪（L.polygon）與自動圈繪（L.geoJSON）統一轉成 TM2 座標的環（含洞、多面）
  const gj = layer.toGeoJSON();
  const geoms = gj.type === "FeatureCollection" ? gj.features.map((f) => f.geometry) : [gj.geometry || gj];
  const rings = [];
  geoms.forEach((g) => {
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach((poly) => poly.forEach((ring) => rings.push(ring.map(([lng, lat]) => dsmToTm(lat, lng)))));
  });
  return rings;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i += 1) { const [x1, y1] = r[i]; const [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

// 以掃描線把多邊形網格化（奇偶規則處理洞），逐格計算 災後 − 災前
function demDiffStats(id, rings) {
  const r = dsmState.rasters[id];
  if (!r || !dsmState.rasters.cop30) return null;
  const [x0, y0, x1, y1] = r.bbox;
  const rx = (x1 - x0) / r.w;
  const ry = (y1 - y0) / r.h;
  const edges = [];
  let nMin = Infinity; let nMax = -Infinity;
  rings.forEach((ring) => ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    edges.push([a[0], a[1], b[0], b[1]]);
    nMin = Math.min(nMin, a[1]); nMax = Math.max(nMax, a[1]);
  }));
  const j0 = Math.max(0, Math.floor((y1 - nMax) / ry));
  const j1 = Math.min(r.h - 1, Math.ceil((y1 - nMin) / ry));
  let gain = 0; let loss = 0; let n = 0; let sum = 0; let nIn = 0;
  const cell = rx * ry;
  for (let j = j0; j <= j1; j += 1) {
    const yc = y1 - (j + 0.5) * ry;
    const xs = [];
    edges.forEach(([ax, ay, bx, by]) => { if ((ay > yc) !== (by > yc)) xs.push(ax + (yc - ay) * (bx - ax) / (by - ay)); });
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / rx - 0.5));
      const c1 = Math.min(r.w - 1, Math.floor((xs[k + 1] - x0) / rx - 0.5));
      for (let i = c0; i <= c1; i += 1) {
        nIn += 1;
        const post = r.data[j * r.w + i];
        if (!Number.isFinite(post) || post < -1000 || (r.nodata != null && Math.abs(post - r.nodata) < 1e-3)) continue;
        const pre = dsmSample("cop30", x0 + (i + 0.5) * rx, yc);
        if (pre == null) continue;
        const d = post - pre - dsmOffset(id);            // 扣除穩定地表整體偏移
        n += 1; sum += d;
        if (d > 0) gain += d * cell; else loss -= d * cell;
      }
    }
  }
  const polyArea = rings.reduce((a, rg) => a + ringArea(rg), 0);      // 近似（洞的面積重複計入時為上限）
  return { gain, loss, net: gain - loss, mean: n ? sum / n : null, area: n * cell, coverage: polyArea ? Math.min(1, (n * cell) / polyArea) : 0 };
}

function demLastFeature(mode) {
  const list = spatialState.drawnLayers.filter((f) => f.mode === mode);
  return list[list.length - 1] || null;
}

async function demDiffRefresh() {
  const box = document.querySelector("#demDiffPanel");
  if (!box) return;
  const slide = demLastFeature("landslide");
  const dam = demLastFeature("damFootprint");
  if (!slide && !dam) { box.innerHTML = ""; return; }
  box.innerHTML = `<p class="s2-small">DEM 差分計算中…</p>`;
  try { await dsmReady(); } catch (e) { box.innerHTML = `<p class="s2-small">DSM 無法載入：${s2Esc(e.message)}</p>`; return; }
  const rows = [];
  const res = {};
  [["landslide", slide, "崩塌範圍 AL"], ["damFootprint", dam, "壩體足跡"]].forEach(([mode, f, name]) => {
    if (!f) return;
    const rings = demLatLngs(f.layer);
    res[mode] = {};
    Object.keys(DEM_POST).forEach((id) => {
      const st = demDiffStats(id, rings);
      res[mode][id] = st;
      if (st) rows.push(`<tr><td>${name}</td><td>${DSM_SOURCES[id].short}</td><td>${Math.round(st.coverage * 100)}%</td>
        <td class="t-red">${fmtVol(st.loss)}</td><td class="t-green">${fmtVol(st.gain)}</td><td>${st.mean == null ? "—" : `${st.mean >= 0 ? "+" : ""}${st.mean.toFixed(1)} m`}</td></tr>`);
    });
  });
  spatialState.demStats = res;
  if (typeof renderReport === "function") renderReport();       // 差分完成後更新通報報告的空間研判依據
  const src = document.querySelector("#demDiffSource")?.value || "uav0930";
  const sl = res.landslide?.[src];
  const dm = res.damFootprint?.[src];
  const AL = spatialState.result.landslideArea;
  const tl = sl && sl.coverage > 0.3 && AL > 0 ? sl.loss / (AL * sl.coverage) : null;
  box.innerHTML = `<h4>DEM 差分（災後 UAV DSM − 災前 DEM）</h4>
    <table class="s2-nw-table dem-table"><thead><tr><th>範圍</th><th>災後</th><th>覆蓋</th><th>高程下降體積</th><th>高程上升體積</th><th>平均變化</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6">範圍不在 UAV DSM 內</td></tr>`}</tbody></table>
    <label class="dem-src">差分採用<select id="demDiffSource">${Object.keys(DEM_POST).map((id) => `<option value="${id}" ${id === src ? "selected" : ""}>${DSM_SOURCES[id].label}</option>`).join("")}</select></label>
    <div class="dem-actions">
      <button type="button" class="outline" data-dem-act="tl" ${tl ? "" : "disabled"}>以下降體積反推平均厚度 TL${tl ? `（${tl.toFixed(1)} m）` : ""}</button>
      <button type="button" class="outline" data-dem-act="vd" ${dm && dm.gain > 0 ? "" : "disabled"}>VD 改採壩體堆積體積${dm ? `（${fmtVol(dm.gain)}）` : ""}</button>
      ${spatialState.demOverride?.VD ? `<button type="button" class="outline" data-dem-act="vdreset">VD 改回足跡×HDmin×形狀係數</button>` : ""}
    </div>
    <p class="s2-small">只計算 UAV DSM 範圍內（覆蓋欄）。已以穩定地表（崩塌、殘壩、湖域、下游以外林地）校正整體高程偏移：${Object.keys(DEM_POST).map((id) => `${DSM_SOURCES[id].short} ${dsmOffset(id).toFixed(1)} m（±${dsmAlignSd(id)} m）`).join("、")}。災前 DEM 為 30 m 且含樹冠，原為林地的崩塌源區下降量會多算約樹高（10–20 m）；數值供量級檢核。09/20 為潰決前、09/30 為潰決後。</p>`;
  document.querySelector("#demDiffSource").addEventListener("change", demDiffRefresh);
  box.querySelectorAll("[data-dem-act]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.demAct === "tl" && tl) {
      document.querySelector("#landslideThickness").value = tl.toFixed(1);
      handleSpatialEstimateInput();
      setMapStatus(`已以 DEM 差分反推崩塌平均厚度 TL = ${tl.toFixed(1)} m（VL 隨之更新）。`);
    }
    if (b.dataset.demAct === "vd" && dm) {
      spatialState.demOverride = { VD: dm.gain, source: src };
      renderSpatialResults();
      autoImportSpatialEstimates(`VD 已改採 DEM 差分堆積體積 ${fmtVol(dm.gain)}，`);
    }
    if (b.dataset.demAct === "vdreset") { spatialState.demOverride = null; renderSpatialResults(); autoImportSpatialEstimates("VD 已改回足跡估算，"); }
    demDiffRefresh();
  }));
}

function fmtVol(v) {
  if (!Number.isFinite(v)) return "—";
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)} 百萬 m³` : `${Math.round(v).toLocaleString("zh-TW")} m³`;
}

async function demProfile(points) {
  const box = document.querySelector("#profilePanel");
  if (!box) return;
  box.innerHTML = `<p class="s2-small">剖面計算中…</p>`;
  try { await dsmReady(); } catch (e) { box.innerHTML = `<p class="s2-small">DSM 無法載入：${s2Esc(e.message)}</p>`; return; }
  const tm = points.map((p) => dsmToTm(p.lat, p.lng));
  const samples = [];
  let dist = 0;
  for (let k = 1; k < tm.length; k += 1) {
    const [ax, ay] = tm[k - 1]; const [bx, by] = tm[k];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / 5));
    for (let t = k === 1 ? 0 : 1; t <= n; t += 1) {
      const f = t / n;
      const E = ax + (bx - ax) * f; const N = ay + (by - ay) * f;
      const ll = L.latLng(points[k - 1].lat + (points[k].lat - points[k - 1].lat) * f, points[k - 1].lng + (points[k].lng - points[k - 1].lng) * f);
      samples.push({ d: dist + len * f, ll, v: Object.fromEntries(Object.keys(DSM_SOURCES).map((id) => [id, dsmSample(id, E, N)])) });
    }
    dist += len;
  }
  const series = { uav0930: "#dc2626", uav0920: "#f59e0b", cop30: "#16a34a" };
  const all = samples.flatMap((s) => Object.values(s.v).filter((z) => z != null));
  if (!all.length) { box.innerHTML = `<p class="s2-small">剖面不在 DSM 範圍內。</p>`; return; }
  const zMin = Math.min(...all); const zMax = Math.max(...all);
  const W = 640; const H = 260; const pl = 52; const pr = 12; const pt = 12; const pb = 30;
  const X = (d) => pl + (d / dist) * (W - pl - pr);
  const Y = (z) => pt + (1 - (z - zMin) / Math.max(1, zMax - zMin)) * (H - pt - pb);
  const paths = Object.entries(series).map(([id, col]) => {
    let dstr = ""; let pen = false;
    samples.forEach((s) => { const z = s.v[id]; if (z == null) { pen = false; return; } dstr += `${pen ? "L" : "M"}${X(s.d).toFixed(1)},${Y(z).toFixed(1)}`; pen = true; });
    return dstr ? `<path d="${dstr}" fill="none" stroke="${col}" stroke-width="2" ${id === "cop30" ? 'stroke-dasharray="6 4"' : ""}></path>` : "";
  }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => { const z = zMin + (zMax - zMin) * f; return `<text x="${pl - 6}" y="${Y(z) + 4}" text-anchor="end">${Math.round(z)}</text><line x1="${pl}" x2="${W - pr}" y1="${Y(z)}" y2="${Y(z)}" stroke="#e5ebee"></line>`; }).join("");
  const ext = (id, fn) => samples.filter((s) => s.v[id] != null).reduce((best, s) => (!best || fn(s.v[id], best.v[id]) ? s : best), null);
  const picks = { crest0930: ext("uav0930", (a, b) => a > b), crest0920: ext("uav0920", (a, b) => a > b), bedPre: ext("cop30", (a, b) => a < b) };
  demProfile.last = { samples, picks, dist };
  const pv = (p, id) => (p ? `${p.v[id].toFixed(1)} m（距起點 ${Math.round(p.d)} m）` : "—");
  box.innerHTML = `<h4>DSM 剖面（長 ${Math.round(dist)} m）</h4>
    <svg viewBox="0 0 ${W} ${H}" class="dem-profile">${ticks}${paths}<text x="${W / 2}" y="${H - 6}" text-anchor="middle">沿線距離（m）</text></svg>
    <div class="s2-legend"><span><i class="sw" style="background:#dc2626"></i>09/30 UAV（潰決後）</span><span><i class="sw" style="background:#f59e0b"></i>09/20 UAV（潰決前）</span><span><i class="sw dash" style="border-color:#16a34a"></i>災前 DEM</span></div>
    <ul class="s2-anom-facts"><li>09/30 最高點：${pv(picks.crest0930, "uav0930")}</li><li>09/20 最高點：${pv(picks.crest0920, "uav0920")}</li><li>災前最低點（原河床）：${pv(picks.bedPre, "cop30")}</li></ul>
    <div class="dem-actions">
      <button type="button" class="outline" data-prof="crest0930" ${picks.crest0930 ? "" : "disabled"}>09/30 最高點 → 壩頂高程</button>
      <button type="button" class="outline" data-prof="crest0920" ${picks.crest0920 ? "" : "disabled"}>09/20 最高點 → 壩頂高程</button>
      <button type="button" class="outline" data-prof="bedPre" ${picks.bedPre ? "" : "disabled"}>災前最低點 → 原河床高程</button>
      <button type="button" class="outline" data-prof="wd">剖面長度 → 壩寬 WD</button>
      <button type="button" class="outline" data-prof="ld">剖面長度 → 壩長 LDTop</button>
    </div>
    <p class="s2-small">壩寬 WD 沿河道方向、壩長 LDTop 橫越河谷；HDmin＝壩頂（溢流控制點）−原河床。</p>`;
  box.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => demProfilePick(b.dataset.prof)));
}

function demProfilePick(kind) {
  const last = demProfile.last;
  if (!last) return;
  if (kind === "wd" || kind === "ld") {
    if (kind === "wd") spatialState.result.damWidth = last.dist; else spatialState.result.damLength = last.dist;
    renderSpatialResults();
    autoImportSpatialEstimates(`已以剖面長度 ${Math.round(last.dist)} m 作為${kind === "wd" ? "壩寬 WD" : "壩長 LDTop"}，`);
    return;
  }
  const p = last.picks[kind];
  if (!p) return;
  const id = kind === "bedPre" ? "cop30" : kind === "crest0930" ? "uav0930" : "uav0920";
  const target = kind === "bedPre" ? "riverbedElevation" : "crestElevation";
  document.querySelector(`#${target}`).value = p.v[id].toFixed(1);
  gisNoteElev(target, p.v[id], `DSM 剖面，${DSM_SOURCES[id].label}`);
  const meta = measureMeta.elevationPoint;
  const marker = L.circleMarker(p.ll, { radius: 7, color: meta.color, fillColor: kind === "bedPre" ? "#16a34a" : "#dc2626", fillOpacity: 0.9, weight: 2, interactive: false }).addTo(spatialState.map);
  addDrawnFeature({ mode: "elevationPoint", label: `${elevationTargetLabels[target]}（剖面）`, valueLabel: `${p.v[id].toFixed(1)} m`, layer: marker, color: meta.color });
  handleSpatialEstimateInput();
  setMapStatus(`已由 DSM 剖面帶入${elevationTargetLabels[target]} ${p.v[id].toFixed(1)} m（${DSM_SOURCES[id].label}）。`);
}


// ---------------------------------------------------------------- 3D 模型連動與跨頁開啟
const MODEL_TO_DSM = { matayan_20250930: "uav0930", matayan_20250920: "uav0920", matayan_cop30: "cop30" };
var gis3d = { model: "matayan_20250930", ready: false, pick: null, pendingFocus: null, timer: null };

function gis3dWin() {
  const f = document.getElementById("terrainFrame");
  return f && f.getAttribute("src") ? f.contentWindow : null;
}

function gis3dSchedule() {
  clearTimeout(gis3d.timer);
  gis3d.timer = setTimeout(gis3dSendOverlays, 400);
}

async function gis3dSendOverlays() {
  const win = gis3dWin();
  if (!win || !gis3d.ready) return;
  try { await dsmReady(); } catch (e) { return; }
  const src = MODEL_TO_DSM[gis3d.model] || "uav0930";
  const items = [];
  const addLine = (coords, color) => {            // coords：[[lng, lat], ...]；每 15 m 加密並依模型 DSM 取高程，範圍外斷開
    let seg = [];
    const flush = () => { if (seg.length > 1) items.push({ kind: "line", pts: seg, color }); seg = []; };
    for (let k = 0; k < coords.length; k += 1) {
      const [e1, n1] = dsmToTm(coords[k][1], coords[k][0]);
      const [e0, n0] = k ? dsmToTm(coords[k - 1][1], coords[k - 1][0]) : [e1, n1];
      const steps = k ? Math.max(1, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 15)) : 1;
      for (let t = k ? 1 : 0; t <= steps; t += 1) {
        const e = e0 + (e1 - e0) * (t / steps);
        const n = n0 + (n1 - n0) * (t / steps);
        const h = dsmSample(src, e, n);
        if (h == null) flush(); else seg.push([e, n, h]);
      }
    }
    flush();
  };
  const addGeom = (g, color) => {
    if (!g) return;
    if (g.type === "Point") {
      const [e, n] = dsmToTm(g.coordinates[1], g.coordinates[0]);
      const h = dsmSample(src, e, n);
      if (h != null) items.push({ kind: "point", pt: [e, n, h], color });
    } else if (g.type === "LineString") addLine(g.coordinates, color);
    else if (g.type === "Polygon") g.coordinates.forEach((r) => addLine(r, color));
    else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach((r) => addLine(r, color)));
    else if (g.type === "MultiLineString") g.coordinates.forEach((l) => addLine(l, color));
  };
  try {
    const reg = await gisLoadRegions();
    reg.features.filter((f) => ["debris", "residual", "lake_max"].includes(f.properties.id))
      .forEach((f) => addGeom(f.geometry, GIS_REGION_STYLE[f.properties.id].color));
  } catch (e) { /* 無輪廓 */ }
  spatialState.drawnLayers.forEach((f) => {
    const gj = f.layer.toGeoJSON();
    (gj.type === "FeatureCollection" ? gj.features : [gj]).forEach((ft) => addGeom(ft.geometry, f.color));
  });
  const m = s2State.data ? s2Months()[s2State.index] : null;
  (m?.ndvi_anomaly?.candidates || []).filter((c) => ["new", "new_pending"].includes(c.class))
    .concat((m?.mom?.blocks || []).filter((b) => b.class === "new_bare"))
    .forEach((c) => addGeom({ type: "Point", coordinates: [c.lon, c.lat] }, "#ff3b3b"));
  if (document.querySelector("#gisSarPts")?.checked && typeof monState !== "undefined") {
    (monState.sar?.points || []).forEach((sp) => addGeom({ type: "Point", coordinates: [sp.lon, sp.lat] }, SAR_COLORS[sp.level_class] || "#64748b"));
  }
  win.postMessage({ type: "terrain-overlays", items }, location.origin);
}

function gis3dOnModel(id) {
  gis3d.model = id;
  gis3d.ready = true;
  gis3dSchedule();
  if (gis3d.pendingFocus) { gis3dWin()?.postMessage({ type: "terrain-focus", ...gis3d.pendingFocus }, location.origin); gis3d.pendingFocus = null; }
}

async function gis3dFocus(lat, lng) {
  showPage("model3d");
  try { await dsmReady(); } catch (e) { return; }
  const [e, n] = dsmToTm(lat, lng);
  const h = dsmSample(MODEL_TO_DSM[gis3d.model] || "uav0930", e, n) ?? dsmSample("cop30", e, n);
  if (h == null) { alert("此點不在 3D 模型範圍內。"); return; }
  const msg = { e, n, h };
  if (gis3d.ready) gis3dWin()?.postMessage({ type: "terrain-focus", ...msg }, location.origin);
  else gis3d.pendingFocus = msg;
}

async function gis3dOnPick(d) {
  const box = document.querySelector("#model3dPick");
  if (!box) return;
  try { await dsmReady(); } catch (e) { return; }
  const [lng, lat] = proj4(TWD97_TM2, "EPSG:4326", [d.e, d.n]);
  const vals = Object.fromEntries(Object.keys(DSM_SOURCES).map((id) => [id, dsmSample(id, d.e, d.n)]));
  gis3d.pick = { lat, lng, h: d.h, model: d.model, vals };
  const modelLabel = DSM_SOURCES[MODEL_TO_DSM[d.model]]?.label || d.model;
  box.innerHTML = `<p><b>3D 點選：H ${d.h.toFixed(1)} m</b>（${s2Esc(modelLabel)}）<br><small>E ${d.e.toFixed(1)}、N ${d.n.toFixed(1)}（TWD97）｜${lat.toFixed(5)}, ${lng.toFixed(5)}</small></p>
    <p class="s2-small">同一點各期：${Object.entries(DSM_SOURCES).map(([id, s2]) => `${s2.short} ${vals[id] == null ? "範圍外" : `${vals[id].toFixed(1)} m`}`).join("｜")}</p>
    <div class="dem-actions">
      ${Object.entries(elevationTargetLabels).map(([k, t]) => `<button type="button" class="outline" data-pick-to="${k}">設為${t}</button>`).join("")}
      <button type="button" data-pick-to="map">在空間研判地圖顯示</button>
    </div>`;
  box.querySelectorAll("[data-pick-to]").forEach((b) => b.addEventListener("click", () => gis3dUsePick(b.dataset.pickTo)));
}

function gis3dUsePick(target) {
  const p = gis3d.pick;
  if (!p) return;
  if (target === "map") { gisOpenAt(p.lat, p.lng, `3D 點選 H ${p.h.toFixed(1)} m`); return; }
  const input = document.querySelector(`#${target}`);
  if (input) input.value = p.h.toFixed(1);
  gisNoteElev(target, p.h, `3D 模型點選，${DSM_SOURCES[MODEL_TO_DSM[p.model]]?.label || p.model}`);
  if (spatialState.map) {
    const meta = measureMeta.elevationPoint;
    const marker = L.circleMarker([p.lat, p.lng], { radius: 7, color: meta.color, fillColor: "#7c3aed", fillOpacity: 0.9, weight: 2, interactive: false }).addTo(spatialState.map);
    addDrawnFeature({ mode: "elevationPoint", label: `${elevationTargetLabels[target]}（3D 點選）`, valueLabel: `${p.h.toFixed(1)} m`, layer: marker, color: meta.color });
  }
  handleSpatialEstimateInput();
  const box = document.querySelector("#model3dPick");
  box?.insertAdjacentHTML("beforeend", `<p class="s2-small t-green">已設為${elevationTargetLabels[target]}，並同步更新空間研判與調查參數。</p>`);
}

function gisOpenAt(lat, lng, label) {
  showPage("gis");
  const marks = document.querySelector("#gisS2Marks");
  if (marks && !marks.checked) marks.checked = true;
  setTimeout(() => {
    const map = spatialState.map;
    if (!map) return;
    map.invalidateSize();
    gisS2Render();
    map.setView([lat, lng], 16);
    const ring = L.circleMarker([lat, lng], { radius: 18, color: "#facc15", weight: 4, fill: false, interactive: false }).addTo(map);
    if (label) ring.bindTooltip(label, { permanent: true, direction: "top", className: "gis-s2-tip" }).openTooltip();
    setTimeout(() => map.removeLayer(ring), 6000);
    setMapStatus(`已在空間研判開啟：${label || ""}（${lat.toFixed(4)}, ${lng.toFixed(4)}），同月份 Sentinel-2 圖層已套疊。`);
  }, 180);
}

document.querySelector("#satelliteMap")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go3d]");
  if (!b) return;
  e.stopPropagation();
  const [lat, lng] = b.dataset.go3d.split(",").map(Number);
  gis3dFocus(lat, lng);
});


// ---------------------------------------------------------------- 補完：偏移校正、可編輯邊界、SAR 監測點、報告依據
const DSM_MODEL_ID = { uav0930: "matayan_20250930", uav0920: "matayan_20250920" };
function dsmOffset(id) { return Number(dsmState.align?.[DSM_MODEL_ID[id]]?.offset_m) || 0; }
function dsmAlignSd(id) { const v = dsmState.align?.[DSM_MODEL_ID[id]]?.robust_sd_m; return v == null ? "—" : Number(v).toFixed(1); }

function gisNoteElev(target, value, how) {
  spatialState.elevSrc = { ...(spatialState.elevSrc || {}), [target]: `${Number(value).toFixed(1)} m（${how}）` };
}

function spatialBasisLines() {
  const out = [];
  const last = (mode) => spatialState.drawnLayers.filter((f) => f.mode === mode).pop();
  const al = last("landslide");
  const fp = last("damFootprint");
  if (al) out.push(`崩塌面積 AL ${al.valueLabel}（${al.label}）`);
  if (fp) out.push(`壩體足跡 ${fp.valueLabel}（${fp.label}）`);
  Object.entries(spatialState.elevSrc || {}).forEach(([k, v]) => out.push(`${elevationTargetLabels[k] || k} ${v}`));
  const ds = spatialState.demStats?.damFootprint;
  if (ds) out.push(`DEM 差分（壩體足跡內，已扣穩定地表偏移）：${Object.entries(ds).filter(([, v]) => v).map(([id, v]) => `${DSM_SOURCES[id].short} 堆積 ${fmtVol(v.gain)}、平均 ${v.mean >= 0 ? "+" : ""}${v.mean?.toFixed(1)} m`).join("；")}`);
  if (spatialState.demOverride?.VD) out.push(`VD 採 DEM 差分堆積體積 ${fmtVol(spatialState.demOverride.VD)}（${DSM_SOURCES[spatialState.demOverride.source]?.label || ""}）`);
  if (out.length && s2State.data) out.push(`Sentinel-2 參考月份 ${s2Months()[s2State.index].roc_month}`);
  return out;
}

// 可編輯邊界：Leaflet-Geoman（拖曳頂點、拖曳邊中點新增、右鍵刪除）
var gisEdit = { id: null, loading: null };
function gisGeomanReady() {
  if (!gisEdit.loading) {
    gisEdit.loading = (async () => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css";
      document.head.appendChild(css);
      await gisLoadScript("https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.js");
    })().catch((e) => { gisEdit.loading = null; throw e; });
  }
  return gisEdit.loading;
}

function latLngsArea(ll) {
  if (!ll || !ll.length) return 0;
  if (ll[0] instanceof L.LatLng) return polygonArea(ll);
  if (ll[0][0] instanceof L.LatLng) return Math.max(0, polygonArea(ll[0]) - ll.slice(1).reduce((a, hole) => a + polygonArea(hole), 0));
  return ll.reduce((a, poly) => a + latLngsArea(poly), 0);
}

function gisSimplifyRing(ring, tolM) {
  if (ring.length < 8) return ring;
  const map = spatialState.map;
  const z = 17;
  const mpp = 156543.03 * Math.cos(ring[0].lat * Math.PI / 180) / 2 ** z;
  const simp = L.LineUtil.simplify(ring.map((ll) => map.project(ll, z)), tolM / mpp);
  return simp.length >= 4 ? simp.map((pt) => map.unproject(pt, z)) : ring;
}

async function gisToggleEdit(id) {
  const map = spatialState.map;
  const f = spatialState.drawnLayers.find((x) => x.id === id);
  if (!map || !f) return;
  if (gisEdit.id === id) {                                     // 完成編輯
    f.layer.pm?.disable();
    gisEdit.id = null;
    spatialState.editing = false;
    const area = latLngsArea(f.layer.getLatLngs());
    if (f.mode === "landslide") spatialState.result.landslideArea = area;
    if (f.mode === "damFootprint") spatialState.result.damFootprintArea = area;
    if (f.mode === "lakeRef") spatialState.result.lakeArea = area;
    f.valueLabel = `${fmtCompact(area, 0, " m²")}（${(area / 1e4).toFixed(1)} ha）`;
    if (!f.label.includes("已人工修正")) f.label += "（已人工修正）";
    renderSpatialResults();
    if (f.mode !== "lakeRef") { demDiffRefresh(); autoImportSpatialEstimates(`已完成邊界修正：${f.valueLabel}，`); }
    gis3dSchedule();
    return;
  }
  if (gisEdit.id) await gisToggleEdit(gisEdit.id);
  setMapStatus("載入編輯工具中…");
  try { await gisGeomanReady(); } catch (e) { setMapStatus(`編輯工具無法載入：${e.message}`); return; }
  if (!map.pm && L.PM?.Map) map.pm = new L.PM.Map(map);
  const gj = f.layer.toGeoJSON();
  const polys = [];
  (gj.type === "FeatureCollection" ? gj.features.map((x) => x.geometry) : [gj.geometry]).forEach((g) => {
    const list = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    list.forEach((poly) => polys.push(poly.map((r) => gisSimplifyRing(r.map(([lng, lat]) => L.latLng(lat, lng)), 6))));
  });
  const kept = polys.filter((poly) => polygonArea(poly[0]) >= 3000);      // 小於 0.3 ha 的碎塊不編輯（併入時會捨去）
  if (!kept.length) { setMapStatus("此圖形沒有可編輯的範圍。"); return; }
  map.removeLayer(f.layer);
  const poly = L.polygon(kept.length === 1 ? kept[0] : kept, { color: f.color, weight: 2.5, fillColor: f.color, fillOpacity: 0.22 }).addTo(map);
  f.layer = poly;
  poly.pm.enable({ allowSelfIntersection: true, snappable: false });
  gisEdit.id = id;
  spatialState.editing = true;
  renderDrawnLayerList();
  map.fitBounds(poly.getBounds(), { padding: [20, 20], maxZoom: 16 });
  setMapStatus("編輯中：拖曳頂點調整邊界、拖曳邊的中點新增頂點、右鍵頂點刪除；完成後按圖層清單「完成編輯」（已先簡化到約 6 m 精度，並略去 0.3 ha 以下碎塊）。");
}

document.querySelector("#drawnLayerList")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit-feature]");
  if (!b) return;
  e.stopPropagation();
  gisToggleEdit(b.dataset.editFeature);
}, true);

// SAR 監測點（空間研判與 3D）
const SAR_COLORS = { ok: "#16a34a", warn: "#f59e0b", danger: "#dc2626" };
var gisSar = { layer: null };
function gisSarRender() {
  const map = spatialState.map;
  if (!map || !gisS2.pane) return;
  if (gisSar.layer) { map.removeLayer(gisSar.layer); gisSar.layer = null; }
  const pts = (typeof monState !== "undefined" && monState.sar?.points) || [];
  if (!document.querySelector("#gisSarPts")?.checked || !pts.length) return;
  const dirs = ["left", "right", "bottom", "top"];                // 三個點相距約 300 m，標籤分開方向避免重疊
  gisSar.layer = L.layerGroup(pts.filter((p) => p.lat && p.lon).map((p, k) => L.circleMarker([p.lat, p.lon], {
    pane: "gisRefPane", radius: 8, color: "#fff", weight: 2, fillColor: SAR_COLORS[p.level_class] || "#64748b", fillOpacity: 1, interactive: false
  }).bindTooltip(`${/^SAR/.test(p.name) ? "" : "SAR "}${p.name}｜${p.level}｜${String(p.latest || "").split(" ")[0]}`, { permanent: true, direction: dirs[k % dirs.length], className: "gis-s2-tip" }))).addTo(map);
}
document.querySelector("#gisSarPts")?.addEventListener("change", () => { gisSarRender(); gis3dSchedule(); });


// ================================================================ 林保署堰塞湖監測（介接）
var FANB_BASE = "https://www.iiicloud.com.tw/FarmlandQlakenew";
var FANB_BOARDS = [["BarrierLake", "馬太鞍溪"], ["BarrierLakeWanli", "萬里溪"], ["BarrierLakeLiwu", "合歡溪"]];
var FANB_RAIN_ALERT = 35;                  // 原系統的時雨量警戒線（mm/hr）
var fanbState = { wst: null, rst: null, at: null, err: null, board: "BarrierLake", timer: null };

async function fanbFetch(ep) {
  // 原系統偶爾回傳空內容（其頁面遇到時會自行重新載入）→ 稍候重試 2 次
  for (let k = 0; k < 3; k += 1) {
    const r = await fetch(`${FANB_BASE}/BarrierLake/${ep}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${ep} 回應 ${r.status}`);
    const t = (await r.text()).trim();
    if (t && t !== "null") return JSON.parse(t);
    await new Promise((res) => setTimeout(res, 1500 * (k + 1)));
  }
  throw new Error(`${ep} 暫無回應`);
}

async function fanbLoad() {
  const [w, r] = await Promise.allSettled([fanbFetch("getWST"), fanbFetch("getRST")]);
  if (w.status === "fulfilled") fanbState.wst = Array.isArray(w.value) ? w.value : [];
  if (r.status === "fulfilled") fanbState.rst = Array.isArray(r.value) ? r.value : [];
  const errs = [w, r].filter((x) => x.status === "rejected").map((x) => x.reason?.message || String(x.reason));
  fanbState.err = errs.length ? errs.join("；") : null;
  if (errs.length < 2) fanbState.at = new Date();
  fanbRender();
  if (typeof renderReport === "function" && typeof latest !== "undefined" && latest) renderReport();
}

function fanbNum(v) {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

function fanbWater(st) {
  const labels = String(st.Datetime || "").split(",").filter(Boolean);
  const values = String(st.Value || "").split(",").filter((x) => x !== "").map(Number);
  const n = Math.min(labels.length, values.length);
  const pts = labels.slice(0, n).map((t, i) => ({ t, v: values[i] })).filter((p) => Number.isFinite(p.v));
  const last = pts[pts.length - 1];
  const a1 = fanbNum(st.alert1); const a2 = fanbNum(st.alert2); const top = fanbNum(st.alertTOP);
  const lake = st.Name === "湖區1號水位計";
  const level = last ? last.v : fanbNum(st.maxValue);
  const tone = level == null ? "grey" : (top != null && level >= top) || (a1 != null && level >= a1) ? "red"
    : (a2 != null && level >= a2) || (a1 != null && a1 - level < 1) ? "orange" : "green";
  return { name: st.Name, id: st.StationID, pts, level, time: st.maxDatetime, a1, a2, top, lake,
    a1Label: lake ? "溢流口高程" : "警戒水位", change: pts.length > 1 ? Math.round((pts[pts.length - 1].v - pts[0].v) * 100) / 100 || 0 : null, tone };
}

function fanbRain(st) {
  const hrs = [...(st.Timeseries || [])].reverse();
  const rain = [...(st.Rainfall || [])].reverse().map(Number);
  const sum = rain.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const max = Math.max(0, ...rain.filter(Number.isFinite));
  return { name: st.Name, id: st.StationNo, time: st.Time, now: fanbNum(st.RAIN), hrs, rain, sum, max,
    tone: max >= FANB_RAIN_ALERT ? "red" : max >= 15 ? "orange" : "green" };
}

function fanbRender() {
  const status = document.querySelector("#fanbStatus");
  if (!status) return;
  if (fanbState.err && !fanbState.wst && !fanbState.rst) {
    status.innerHTML = `<span class="t-red">無法連線林保署系統（${s2Esc(fanbState.err)}）。</span>可按「重新整理」再試，或開啟原系統查看。`;
    return;
  }
  const at = fanbState.at ? fanbState.at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—";
  status.textContent = `已於 ${at} 取得林保署系統資料${fanbState.err ? `（最近一次更新失敗：${fanbState.err}，顯示上次資料）` : ""}；每 10 分鐘自動更新。`;
  const ws = (fanbState.wst || []).map(fanbWater);
  const rs = (fanbState.rst || []).map(fanbRain);
  const fmtM = (v) => (v == null ? "—" : `${v.toFixed(2)} m`);
  const cards = ws.map((w) => `<article class="metric-card s2-metric-card ${w.tone}"><span>${s2Esc(w.name)} 水位</span><strong>${fmtM(w.level)}</strong>
      <small>${s2Esc(w.time || "")}｜${w.a1 != null ? `距${w.a1Label} ${(w.a1 - w.level).toFixed(2)} m` : "無警戒值"}</small>
      <small>24 小時變化 ${w.change == null ? "—" : `${w.change >= 0 ? "+" : ""}${w.change.toFixed(2)} m`}${w.top != null ? `｜堤頂高 ${w.top} m` : ""}</small></article>`)
    .concat(rs.map((r) => `<article class="metric-card s2-metric-card ${r.tone}"><span>${s2Esc(r.name)} 雨量站</span><strong>${r.now == null ? "—" : `${r.now} mm`}</strong>
      <small>${s2Esc(r.time || "")} 時雨量｜24 小時累積 ${r.sum.toFixed(1)} mm</small><small>24 小時最大時雨量 ${r.max} mm${r.max >= FANB_RAIN_ALERT ? "（達警戒 35 mm）" : ""}</small></article>`));
  document.querySelector("#fanbCards").innerHTML = cards.join("") || `<p class="muted-empty">目前沒有測站資料。</p>`;
  const w0 = ws[0];
  document.querySelector("#fanbWstBadge").textContent = w0 ? `${w0.id}｜${w0.level != null && w0.a1 != null && w0.level >= w0.a1 ? "已達警戒" : "未達警戒"}` : "";
  document.querySelector("#fanbWstChart").innerHTML = w0 ? fanbWaterSvg(w0) : `<p class="muted-empty">無水位資料。</p>`;
  document.querySelector("#fanbRstBadge").textContent = rs.length ? rs.map((r) => `${r.name} ${r.sum.toFixed(1)} mm`).join("｜") : "";
  document.querySelector("#fanbRstChart").innerHTML = rs.length ? fanbRainSvg(rs)
    : `<p class="muted-empty">${String(fanbState.err || "").includes("getRST") ? "原系統雨量資料目前暫無回應（回傳無內容），10 分鐘後自動重試；可按「重新整理」或至原系統查看。" : "無雨量資料。"}</p>`;
}

function fanbWaterSvg(w) {
  const W = 900; const H = 300; const pl = 64; const pr = 16; const pt = 16; const pb = 40;
  const vals = w.pts.map((p) => p.v).concat([w.a1, w.a2, w.top].filter((x) => x != null));
  const lo = Math.floor(Math.min(...vals) - 0.3); const hi = Math.ceil(Math.max(...vals) + 0.3);
  const X = (i) => pl + (i / Math.max(1, w.pts.length - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - lo) / Math.max(0.1, hi - lo)) * (H - pt - pb);
  const line = w.pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const ref = (v, col, label) => (v == null ? "" : `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-dasharray="6 4" stroke-width="1.5"></line>
    <text x="${W - pr - 4}" y="${Y(v) - 5}" text-anchor="end" fill="${col}">${label} ${v}</text>`);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo + (hi - lo) * f; return `<text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text><line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5ebee"></line>`; }).join("");
  const step = Math.max(1, Math.round(w.pts.length / 8));
  const xl = w.pts.map((p, i) => (i % step === 0 ? `<text x="${X(i)}" y="${H - 14}" text-anchor="middle">${s2Esc(p.t)}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="fanb-svg" role="img" aria-label="${s2Esc(w.name)} 水位時序">${ticks}${ref(w.top, "#334155", "堤頂高")}${ref(w.a1, "#dc2626", w.a1Label)}${ref(w.a2, "#f59e0b", "二級警戒")}
    <path d="${line}" fill="none" stroke="#2563eb" stroke-width="2.5"></path>${xl}<text x="12" y="${pt + 10}">m</text></svg>
    <p class="s2-small">最新 ${w.level == null ? "—" : w.level.toFixed(2)} m（${s2Esc(w.time || "")}）；紅虛線＝${w.a1Label}、灰虛線＝堤頂高。</p>`;
}

function fanbRainSvg(rs) {
  const W = 900; const H = 300; const pl = 52; const pr = 16; const pt = 16; const pb = 40;
  const n = Math.max(...rs.map((r) => r.rain.length));
  const hi = Math.max(FANB_RAIN_ALERT + 5, ...rs.flatMap((r) => r.rain.filter(Number.isFinite)));
  const cols = ["#0ea5e9", "#7c3aed", "#16a34a"];
  const bw = (W - pl - pr) / n;
  const Y = (v) => pt + (1 - v / hi) * (H - pt - pb);
  const bars = rs.map((r, k) => r.rain.map((v, i) => (Number.isFinite(v) && v > 0
    ? `<rect x="${pl + i * bw + (k * bw) / rs.length + 1}" y="${Y(v)}" width="${Math.max(1, bw / rs.length - 2)}" height="${Y(0) - Y(v)}" fill="${cols[k % 3]}"></rect>` : "")).join("")).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = hi * f; return `<text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text><line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5ebee"></line>`; }).join("");
  const hrs = rs[0].hrs;
  const step = Math.max(1, Math.round(n / 8));
  const xl = hrs.map((t, i) => (i % step === 0 ? `<text x="${pl + i * bw + bw / 2}" y="${H - 14}" text-anchor="middle">${s2Esc(t)}</text>` : "")).join("");
  const alert = `<line x1="${pl}" x2="${W - pr}" y1="${Y(FANB_RAIN_ALERT)}" y2="${Y(FANB_RAIN_ALERT)}" stroke="#dc2626" stroke-dasharray="6 4" stroke-width="1.5"></line><text x="${W - pr - 4}" y="${Y(FANB_RAIN_ALERT) - 5}" text-anchor="end" fill="#dc2626">雨量警戒 ${FANB_RAIN_ALERT} mm/hr</text>`;
  const allZero = rs.every((r) => r.sum === 0);
  return `<svg viewBox="0 0 ${W} ${H}" class="fanb-svg" role="img" aria-label="雨量站時雨量">${ticks}${alert}${bars}${xl}<text x="12" y="${pt + 10}">mm</text></svg>
    <div class="s2-legend">${rs.map((r, k) => `<span><i class="sw" style="background:${cols[k % 3]}"></i>${s2Esc(r.name)}（${s2Esc(r.id)}）</span>`).join("")}</div>
    ${allZero ? `<p class="s2-small">近 24 小時各站皆無降雨。</p>` : ""}`;
}

function fanbReportLines() {
  if (typeof fanbState === "undefined" || !fanbState || (!fanbState.wst && !fanbState.rst)) return [];   // 程式載入初期 renderReport 就會呼叫
  const out = [];
  (fanbState.wst || []).map(fanbWater).forEach((w) => {
    if (w.level != null) out.push(`${w.name}水位 ${w.level.toFixed(2)} m（${w.time || ""}）${w.a1 != null ? `，距${w.a1Label} ${(w.a1 - w.level).toFixed(2)} m` : ""}${w.change != null ? `，24 小時變化 ${w.change >= 0 ? "+" : ""}${w.change.toFixed(2)} m` : ""}`);
  });
  (fanbState.rst || []).map(fanbRain).forEach((r) => out.push(`${r.name}雨量站 24 小時累積 ${r.sum.toFixed(1)} mm、最大時雨量 ${r.max} mm`));
  return out;
}

function fanbShow() {
  if (typeof FANB_BOARDS === "undefined" || !FANB_BOARDS) { setTimeout(fanbShow, 50); return; }
  const frame = document.querySelector("#fanbFrame");
  const tabs = document.querySelector("#fanbTabs");
  if (tabs && !tabs.dataset.ready) {
    tabs.dataset.ready = "1";
    tabs.innerHTML = FANB_BOARDS.map(([k, t]) => `<button type="button" data-fanb-board="${k}" class="${k === fanbState.board ? "active" : ""}">${t}</button>`).join("");
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fanb-board]");
      if (!b) return;
      fanbState.board = b.dataset.fanbBoard;
      tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      frame.src = `${FANB_BASE}/${fanbState.board}`;
    });
  }
  if (frame && !frame.getAttribute("src")) frame.src = `${FANB_BASE}/${fanbState.board}`;
  if (!fanbState.at || Date.now() - fanbState.at.getTime() > 5 * 60 * 1000) fanbLoad();
}

document.querySelector("#fanbRefresh")?.addEventListener("click", fanbLoad);
setTimeout(fanbLoad, 1500);                                                   // 開站即取一次，供通報報告與 AI 摘要使用
fanbState.timer = setInterval(() => { if (!document.hidden) fanbLoad(); }, 10 * 60 * 1000);

// ---- SAVI 植生覆蓋三期比較（sentinel2_monthly/s2_savi.py 產製）----
var saviState = { data: null, view: "compare", layer: "class", zone: "watershed" };

async function saviLoad() {
  const badge = document.querySelector("#saviBadge");
  if (!badge) return;
  try {
    const r = await fetch("./assets/sentinel2/savi/savi_compare.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`回應 ${r.status}`);
    saviState.data = await r.json();
  } catch (e) {
    badge.textContent = "尚未產製";
    document.querySelector("#saviFigure").innerHTML = `<p class="muted-empty">SAVI 成果載入失敗：${s2Esc(e.message)}</p>`;
    return;
  }
  const d = saviState.data;
  const v = `?v=${encodeURIComponent(d.generated_at)}`;                      // 重新產製後避開瀏覽器舊圖快取
  d.figure += v; d.figure_png += v;
  d.periods.forEach((p) => { p.images.class += v; p.images.index += v; });
  badge.textContent = `${d.periods.length} 期｜產製 ${d.generated_at.slice(0, 10)}`;
  const og = document.querySelector("#gisSaviOpts");
  if (og) og.innerHTML = d.periods.map((p) => `<option value="savi:${p.key}">SAVI ${s2Esc(p.label)}（${s2Esc(p.note)}）</option>`).join("");
  saviRender();
  if (document.querySelector("#gisS2Layer")?.value.startsWith("savi:") && typeof gisS2Render === "function") gisS2Render();
}

function saviRow(key, zone, code) {
  return (saviState.data.stats[key] || []).find((r) => r.zone === zone && r.class === code) || {};
}

function saviRender() {
  const d = saviState.data;
  if (!d) return;
  const P = d.periods;
  const cls = d.classes;
  const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("zh-TW", { maximumFractionDigits: 1 }));
  document.querySelector("#saviTabs").innerHTML = [["compare", "三期並列圖"], ...P.map((p) => [p.key, `${p.label}（${p.note}）`])]
    .map(([k, t]) => `<button type="button" data-savi-view="${k}" class="${saviState.view === k ? "active" : ""}">${s2Esc(t)}</button>`).join("");
  document.querySelector("#saviZone").innerHTML = d.zones
    .map((z) => `<button type="button" data-savi-zone="${z.key}" class="${saviState.zone === z.key ? "active" : ""}">${s2Esc(z.name)}</button>`).join("");

  const fig = document.querySelector("#saviFigure");
  if (saviState.view === "compare") {
    fig.innerHTML = `<a href="${d.figure_png}" target="_blank" rel="noopener" title="開新分頁看高解析度原圖"><img src="${d.figure}" alt="馬太鞍溪集水區 SAVI 三期比較圖" loading="lazy" /></a>
      <p class="s2-small">點圖可開啟高解析度原圖（可直接下載用於簡報或報告）。</p>`;
  } else {
    const p = P.find((x) => x.key === saviState.view) || P[0];
    fig.innerHTML = `<div class="s2-seg savi-sub">${[["class", "分類圖"], ["index", "SAVI 數值"]]
      .map(([k, t]) => `<button type="button" data-savi-layer="${k}" class="${saviState.layer === k ? "active" : ""}">${t}</button>`).join("")}</div>
      <img src="${p.images[saviState.layer]}" alt="SAVI ${s2Esc(p.label)}" loading="lazy" />
      <p class="s2-small">${s2Esc(p.label)}：${p.months_used.length} 個月中位數合成（${p.months_used.map((m) => m.slice(2).replace("-", "/")).join("、")}）；全流域 SAVI 平均 ${p.savi_mean}（P10 ${p.savi_p10}／P90 ${p.savi_p90}）。灰色＝雲遮無資料。
      <button type="button" class="outline" data-savi-gis="${p.key}">在空間研判疊合</button></p>`;
  }
  document.querySelector("#saviLegend").innerHTML = saviState.view !== "compare" && saviState.layer === "index"
    ? `<span><i class="ramp savi"></i>SAVI −0.1 → 0.7</span><span>門檻：&lt;${d.thresholds.bare} 裸露、≥${d.thresholds.dense} 茂密</span>`
    : cls.map((c) => `<span><i class="sw" style="background:${c.color}"></i>${s2Esc(c.name)}</span>`).join("") + `<span><i class="sw" style="background:#e1e1e1"></i>雲遮無資料</span>`;

  // 面積統計表
  const z = saviState.zone;
  const zn = d.zones.find((x) => x.key === z);
  const last = P[P.length - 1]; const prev = P[P.length - 2];
  const head = `<tr><th>類別</th>${P.map((p) => `<th>${s2Esc(p.label)}<br><small>${s2Esc(p.note)}</small></th>`).join("")}<th>災前→災後</th></tr>`;
  const body = cls.map((c) => {
    const a = saviRow(prev.key, z, c.code).ha; const b = saviRow(last.key, z, c.code).ha;
    const dv = a == null || b == null ? null : b - a;
    const tone = dv == null || Math.abs(dv) < 0.05 ? "" : (c.code === 2 ? (dv > 0 ? "up-bad" : "down-good") : c.code === 4 ? (dv < 0 ? "up-bad" : "down-good") : "");
    return `<tr><td><i class="sw" style="background:${c.color}"></i>${s2Esc(c.name)}</td>${P.map((p) => { const r = saviRow(p.key, z, c.code); return `<td>${fmt(r.ha)} ha<br><small>${r.pct == null ? "—" : r.pct.toFixed(1) + "%"}</small></td>`; }).join("")}<td class="${tone}">${dv == null ? "—" : (dv > 0 ? "+" : "") + fmt(dv) + " ha"}</td></tr>`;
  }).join("");
  const nod = `<tr class="savi-nodata"><td>雲遮無資料</td>${P.map((p) => `<td>${fmt(saviRow(p.key, z, 0).ha)} ha</td>`).join("")}<td></td></tr>`;
  document.querySelector("#saviTable").innerHTML = `<table class="s2-nw-table savi-table"><caption>${s2Esc(zn?.name || "")}面積統計（總面積 ${fmt(zn?.area_ha)} ha；百分比為占有效觀測）</caption><thead>${head}</thead><tbody>${body}${nod}</tbody></table>`;

  // 轉移（災前→災後）
  const t = d.transitions.find((x) => x.from === prev.key && x.to === last.key && x.zone === z);
  const tbox = document.querySelector("#saviTrans");
  if (!t) { tbox.innerHTML = ""; }
  else {
    const flows = [];
    t.ha.forEach((row, i) => row.forEach((v, j) => { if (i !== j && v > 0) flows.push({ from: cls[i], to: cls[j], v }); }));
    flows.sort((a, b) => b.v - a.v);
    const loss = t.ha[3][1] + t.ha[2][1];
    const gain = t.ha[1][2] + t.ha[1][3];
    tbox.innerHTML = `<p class="s2-small">植生（稀疏＋茂密）轉為裸露地 <b class="t-red">${fmt(loss)} ha</b>；裸露地長回植生 <b class="t-green">${fmt(gain)} ha</b>。主要轉移：</p>
      <ul class="savi-flows">${flows.slice(0, 5).map((f) => `<li><i class="sw" style="background:${f.from.color}"></i>${s2Esc(f.from.name)} → <i class="sw" style="background:${f.to.color}"></i>${s2Esc(f.to.name)}<b>${fmt(f.v)} ha</b></li>`).join("")}</ul>
      <details class="s2-tech"><summary>完整轉移矩陣（列＝${s2Esc(prev.label)}，欄＝${s2Esc(last.label)}，ha）</summary>
      <table class="s2-nw-table savi-table"><thead><tr><th></th>${cls.map((c) => `<th>${s2Esc(c.name)}</th>`).join("")}</tr></thead>
      <tbody>${t.ha.map((row, i) => `<tr><th>${s2Esc(cls[i].name)}</th>${row.map((v, j) => `<td class="${i === j ? "diag" : ""}">${fmt(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
  }
  document.querySelector("#saviDownloads").innerHTML = `下載：<a href="${d.downloads.area_csv}" download>面積統計表 CSV</a>｜<a href="${d.downloads.transition_csv}" download>轉移矩陣 CSV</a>｜<a href="${d.figure_png}" target="_blank" rel="noopener">比較圖 PNG</a>`;
  document.querySelector("#saviMethod").textContent = `${d.formula}（Huete, 1988；NIR＝B08、Red＝B04，10 m）。流程：以 PySTAC 查詢 Microsoft Planetary Computer 的 Sentinel-2 L2A（雲量 < 90%），每月沿用本平台月監測的去雲規則（SCL＋藍光／短波紅外補判＋雲緣外擴 20 m）做月中位數合成；各期取流域有效覆蓋 ≥ 60% 的月份，逐像元中位數合成後分類。水體：${d.thresholds.water}；裸露地：SAVI < ${d.thresholds.bare}（約等同本平台 NDVI < 0.25 裸露定義）；稀疏植生：${d.thresholds.bare}–${d.thresholds.dense}；茂密植生：≥ ${d.thresholds.dense}。限制：陡坡背光面反射率低，SAVI 會偏低，部分陰坡森林可能被歸為稀疏植生；10 m 解析度無法分辨單株植生；分類為衛星判釋，需以 UAV 與現地查證。`;
}

document.querySelector("#saviCard")?.addEventListener("click", (e) => {
  const v = e.target.closest("[data-savi-view]");
  if (v) { saviState.view = v.dataset.saviView; saviRender(); return; }
  const z = e.target.closest("[data-savi-zone]");
  if (z) { saviState.zone = z.dataset.saviZone; saviRender(); return; }
  const l = e.target.closest("[data-savi-layer]");
  if (l) { saviState.layer = l.dataset.saviLayer; saviRender(); return; }
  const g = e.target.closest("[data-savi-gis]");
  if (g) {
    const sel = document.querySelector("#gisS2Layer");
    if (sel) sel.value = `savi:${g.dataset.saviGis}`;
    showPage("gis");
    setTimeout(() => { if (typeof gisS2Render === "function") gisS2Render(); spatialState.map?.invalidateSize(); }, 150);
  }
});
setTimeout(saviLoad, 1200);
