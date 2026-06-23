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

  const stabilityRows = [
    ["DBI", dbi, dbiClass(dbi), "DBI < 2.75 穩定；DBI > 3.08 不穩定"],
    ["AHV_Dis", ahvDis, signClass(ahvDis), "小於 0 判定不穩定"],
    ["AHWL_Dis", ahwlDis, signClass(ahwlDis), "小於 0 判定不穩定"],
    ["AHV_Log", ahvLog, signClass(ahvLog), "小於 0 判定不穩定"],
    ["AHWL_Log", ahwlLog, signClass(ahwlLog), "小於 0 判定不穩定"],
    ["HDSI", hdsi, hdsiClass(hdsi), "HDSI < 5.74 不穩定；HDSI > 7.44 穩定"]
  ];

  const unstableCount = stabilityRows.filter((row) => row[2] === "不穩定").length;
  const dangerHigh = unstableCount >= 1 || dbiClass(dbi) === "過渡區";
  const dangerLevel = dangerHigh ? "較高" : "較低";
  const exposure = exposureLevel(text("exposure"), waterDepth, Hpo);
  const risk = riskLevel(dangerHigh, exposure);
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
    ["潰壩危險度", dangerLevel, `${unstableCount} 項不穩定指標`, tagClass(dangerLevel)],
    ["保全危害度", exposure, `估算水深 ${fmt(waterDepth, 1)} m`, tagClass(exposure)],
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

  recommendation.innerHTML = `
    <h4>${latest.risk}：${latest.caseName}</h4>
    <p>誘發原因為「${latest.trigger}」，目前以「${latest.damType}」進行緊急初判。建議採取 <b>${latest.monitoring}</b>，警戒作為為 <b>${latest.alert}</b>，工程急迫性評估為 <b>${latest.urgency}</b>。</p>
    <p>若 DBI 雖顯示穩定，但 AHWL 或其他指標出現不穩定，應保守納入較高潰壩危險度，並同步檢討滲流破壞、劇烈溢流沖刷與下游複合型土砂災害。</p>
  `;
}

function renderDashboard() {
  document.querySelector("#caseHeadline").textContent = latest.caseName;
  document.querySelector("#caseLead").textContent = `${latest.trigger}誘發之${latest.damType}，上游集水區面積 ${fmt(latest.AD / 1_000_000, 1)} km²，壩高 ${fmt(latest.H, 0)} m，蓄水體積 ${fmt(latest.VW / 1_000_000, 1)} 百萬 m³。`;
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

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));
  document.querySelector("#pageTitle").textContent = pageTitles[pageId] || "案件儀表板";
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

document.querySelector("#dateDisplay").textContent = new Date().toLocaleDateString("zh-TW", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showPage(item.dataset.page));
});

document.querySelector(".ai-fab").addEventListener("click", () => showPage("ai"));
form.addEventListener("input", compute);
form.addEventListener("change", compute);
document.querySelector("#loadMatayan").addEventListener("click", () => loadPreset(matayanPreset));
document.querySelector("#clearForm").addEventListener("click", () => {
  form.reset();
  [...form.elements].forEach((el) => {
    if (el.type === "number" || el.tagName === "INPUT") el.value = "";
  });
  compute();
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

compute();
