const form = document.querySelector("#assessmentForm");
const summaryCards = document.querySelector("#summaryCards");
const stabilityResults = document.querySelector("#stabilityResults");
const hydroResults = document.querySelector("#hydroResults");
const recommendation = document.querySelector("#recommendation");
const reportText = document.querySelector("#reportText");
const aiSummary = document.querySelector("#aiSummary");
const expertFindings = document.querySelector("#expertFindings");

const pageTitles = {
  dashboard: "專家總覽",
  survey: "調查參數",
  risk: "風險演算",
  figures: "示意圖庫",
  gis: "空間研判",
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

const matayanLocation = {
  name: "馬太鞍溪堰塞湖",
  lat: 23.6995,
  lng: 121.2955,
  zoom: 15
};

const measureMeta = {
  landslide: { label: "崩塌面積 AL", type: "polygon", minPoints: 3, color: "#c85252" },
  damFootprint: { label: "壩體足跡面積", type: "polygon", minPoints: 3, color: "#d98933" },
  damWidth: { label: "壩寬 WD", type: "line", minPoints: 2, color: "#2f80c2" },
  damLength: { label: "壩長 LDTop", type: "line", minPoints: 2, color: "#3a9b73" },
  channelSlope: { label: "代表河段長度", type: "line", minPoints: 2, color: "#7b6fd6" }
};

const spatialState = {
  map: null,
  baseLayers: {},
  activeBaseLayer: null,
  activeMode: "landslide",
  currentPoints: [],
  currentLayer: null,
  drawnLayers: [],
  result: {
    landslideArea: 0,
    damFootprintArea: 0,
    damWidth: 0,
    damLength: 0,
    channelSlopeDistance: 0
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
    channelSlope: [spatialState.result.channelSlopeDistance, 1, "m"]
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
  const VD = inferredDamFootprint > 0 && HDmin > 0 ? inferredDamFootprint * HDmin * shapeFactor : 0;
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
  if (!meta || spatialState.currentPoints.length === 0) return;
  const options = { color: meta.color, weight: 3, fillColor: meta.color, fillOpacity: 0.22 };
  if (meta.type === "polygon" && spatialState.currentPoints.length >= 3) {
    spatialState.currentLayer = L.polygon(spatialState.currentPoints, options).addTo(spatialState.map);
  } else {
    spatialState.currentLayer = L.polyline(spatialState.currentPoints, options).addTo(spatialState.map);
  }
}

function finishMeasurement() {
  if (!spatialState.map) return;
  const meta = measureMeta[spatialState.activeMode];
  if (!meta || spatialState.currentPoints.length < meta.minPoints) {
    setMapStatus(`${meta ? meta.label : "量測"} 至少需要 ${meta ? meta.minPoints : 2} 個點。`);
    return;
  }

  const points = [...spatialState.currentPoints];
  const options = { color: meta.color, weight: 3, fillColor: meta.color, fillOpacity: 0.26 };
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
  layer.bindPopup(`<div class="spatial-popup"><b>${meta.label}</b><span>${meta.type === "polygon" ? fmtCompact(value, 0, " m²") : fmtCompact(value, 1, " m")}</span></div>`);
  spatialState.drawnLayers.push(layer);
  resetCurrentMeasurement();
  renderSpatialResults();
  autoImportSpatialEstimates(`已完成 ${meta.label}：${meta.type === "polygon" ? fmtCompact(value, 0, " m²") : fmtCompact(value, 1, " m")}，`);
}

function setMeasurementMode(mode) {
  if (!measureMeta[mode]) return;
  spatialState.activeMode = mode;
  resetCurrentMeasurement();
  document.querySelectorAll(".measure-mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.measureMode === mode);
  });
  const meta = measureMeta[mode];
  setMapStatus(`${meta.label}：在衛星影像上連續點選，完成後按「完成量測」。`);
  renderMapLegend();
}

function clearSpatialMeasurements() {
  resetCurrentMeasurement();
  spatialState.drawnLayers.forEach((layer) => spatialState.map && spatialState.map.removeLayer(layer));
  spatialState.drawnLayers = [];
  spatialState.result = {
    landslideArea: 0,
    damFootprintArea: 0,
    damWidth: 0,
    damLength: 0,
    channelSlopeDistance: 0
  };
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
  const marker = L.marker([matayanLocation.lat, matayanLocation.lng]).addTo(spatialState.map);
  marker.bindPopup(`
    <div class="spatial-popup">
      <b>${matayanLocation.name}</b>
      <span>公開座標：23.6995, 121.2955</span>
      <span>案例值可由右上角「馬太鞍溪堰塞湖案例」套用。</span>
    </div>
  `).openPopup();
  spatialState.drawnLayers.push(marker);
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
  spatialState.map.on("click", (event) => {
    spatialState.currentPoints.push(event.latlng);
    drawCurrentMeasurement();
    const meta = measureMeta[spatialState.activeMode];
    setMapStatus(`${meta.label} 已點選 ${spatialState.currentPoints.length} 點；完成後按「完成量測」。`);
  });
  spatialState.map.on("dblclick", finishMeasurement);
  setMeasurementMode("landslide");
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
  renderReport();
  renderAiSummary();
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
  reportText.value = `【${latest.caseName}｜堰塞湖緊急調查與風險評估摘要】

一、案件概況
本案研判為${latest.trigger}誘發之${latest.damType}。目前輸入之崩塌面積約 ${fmt(num("landslideArea") / 10000, 1)} ha，崩塌體積約 ${fmt(latest.VL, 0)} m³；壩體體積約 ${fmt(latest.VD, 0)} m³，壩高約 ${fmt(latest.H, 0)} m，壩寬約 ${fmt(latest.W, 0)} m，壩長約 ${fmt(latest.L, 0)} m。

二、安定性與潰壩危險度
DBI = ${fmt(latest.dbi)}，AHWL_Dis = ${fmt(latest.ahwlDis)}，HDSI = ${fmt(latest.hdsi)}。綜合 ${latest.unstableCount} 項不穩定指標，潰壩危險度判定為「${latest.dangerLevel}」。

三、下游保全危害度
以蓄水體積 ${fmt(latest.VW, 0)} m³ 與潰壩歷時 ${fmt(latest.TcHr, 1)} hr 進行洪峰流量初估，代表洪峰流量約 ${fmt(latest.qpSelected, 0)} m³/s，代表斷面水深約 ${fmt(latest.waterDepth, 1)} m；保全危害度判定為「${latest.exposure}」。

四、初步致災風險與處置建議
依「潰壩危險度 × 保全危害度」矩陣，本案初步致災風險為「${latest.risk}」。建議採取 ${latest.monitoring}；警戒作為為 ${latest.alert}；工程急迫性為 ${latest.urgency}。`;
}

function renderAiSummary() {
  aiSummary.innerHTML = `
    <p><b>風險主軸：</b>${latest.caseName} 的 DBI 可能顯示壩體具一定穩定性，但 AHWL 系列若出現不穩定，仍應以高潰壩危險度進行保守管理。</p>
    <p><b>監測重點：</b>優先追蹤壩頂溢流、滲流出水、壩體裂縫、蓄水位變化、下游河床沖刷與降雨入流條件。</p>
    <p><b>決策建議：</b>在外業資料未補齊前，建議維持 ${latest.monitoring}，並依 ${latest.alert} 原則辦理；若後續雨量或水位上升，應即時更新洪峰流量與保全對象影響範圍。</p>
  `;
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
  if (pageId === "gis" && spatialState.map) {
    setTimeout(() => spatialState.map.invalidateSize(), 120);
  }
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    inputs: Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el.value])),
    assessment: latest
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
document.querySelectorAll(".measure-mode").forEach((button) => {
  button.addEventListener("click", () => setMeasurementMode(button.dataset.measureMode));
});
document.querySelector("#finishMeasurement").addEventListener("click", finishMeasurement);
document.querySelector("#clearMeasurement").addEventListener("click", clearSpatialMeasurements);
document.querySelector("#applySpatialEstimates").addEventListener("click", applySpatialEstimates);
document.querySelector("#focusMatayan").addEventListener("click", addMatayanReference);
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

addParameterSketches();
initSpatialMap();
compute();
