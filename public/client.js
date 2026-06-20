/* =========================================================
   すごろくゲーム  client.js
   バージョン: v3.6.2
   日付: 2026-06-21（日）01:20 JST
   v3.6.2での変更点:
     - 線の錯綜を解消（岩見沢経由を白石へ素直に下ろし、
       追分経由の北上線を内側へ寄せ交差を1点に整理）
     - 共通区間(白石〜小樽)の駅間を約300pxに拡大し線路を見やすく
     - 盤面の上下左右に余白(MARGIN)を確保し、全駅座標をオフセット。
       端の駅(白石〜小樽)でも中央固定追従が効くように
     - 盤面サイズを拡大
   --- 以下 過去履歴 ---
   v3.6.1: 駅座標を広域図に合わせ再設計・共通区間の重なり解消
   v3.6.0: 盤面を背景路線図(SVG)＋駅マス絶対配置方式に変更
   v3.5.2: 721系コマ作り直し・赤青丸廃止し横帯で識別・名前全表示
   ※ server.js v3.5 / index.html v3.6.2 とセットで使うこと
   ========================================================= */

const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

const WHEEL_COLORS = [
  "#f4d000", "#f5a623", "#e8731c", "#e8231c", "#e6007e",
  "#9b3fb5", "#5b3fb5", "#1c9ee8", "#2e8b3f", "#8bc63f",
];

const ROUTE_NAMES = { oiwake: "追分経由", iwamizawa: "岩見沢経由" };

let myId = null;
let routes = { oiwake: [], iwamizawa: [] };
let goals = { oiwake: 0, iwamizawa: 0 };
let commonStart = { oiwake: 0, iwamizawa: 0 };
let currentRotation = 0;

let fanfaredIndexes = {};
let lastShownSeq = 0;
let animating = false;
let latestState = null;

let canRoll = false;

const boardEl = document.getElementById("board");
const boardScrollEl = document.querySelector(".boardScroll");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const resultEl = document.getElementById("result");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");
const routeOiwakeBtn = document.getElementById("routeOiwakeBtn");
const routeIwamizawaBtn = document.getElementById("routeIwamizawaBtn");
const routeLabel = document.getElementById("routeLabel");
const routeArea = document.getElementById("routeArea");

// =========================================================
//  駅座標テーブル（背景路線図方式・広域図に準拠）
//  pos は server.js の配列インデックスと一致
//  ※ 端の駅でも中央固定が効くよう、全座標に MARGIN を加算する
// =========================================================
const MARGIN = 1100;          // 上下左右の余白（中央固定用）
const CONTENT_W = 4300;       // 駅が占める実体の横幅
const CONTENT_H = 2050;       // 駅が占める実体の縦幅
const BOARD_W = CONTENT_W + MARGIN * 2;
const BOARD_H = CONTENT_H + MARGIN * 2;

// --- 岩見沢経由 分岐（pos 0〜13: 栗山〜厚別）---
// 栗山→上へ岩見沢→緩く左下→江別以降は下りながら白石へ素直に集約
const RAW_IWAMIZAWA_BRANCH = [
  { x: 4000, y: 1180 }, // 0 栗山
  { x: 4000, y: 1000 }, // 1 栗丘
  { x: 4000, y: 820 },  // 2 栗沢
  { x: 4000, y: 650 },  // 3 志文
  { x: 4000, y: 480 },  // 4 岩見沢
  { x: 3740, y: 540 },  // 5 上幌向
  { x: 3490, y: 610 },  // 6 幌向
  { x: 3240, y: 690 },  // 7 豊幌
  { x: 3000, y: 780 },  // 8 江別
  { x: 2820, y: 900 },  // 9 高砂
  { x: 2660, y: 1020 }, // 10 野幌
  { x: 2520, y: 1140 }, // 11 大麻
  { x: 2400, y: 1240 }, // 12 森林公園
  { x: 2300, y: 1330 }, // 13 厚別
];

// --- 追分経由 分岐（pos 0〜20: 栗山〜平和）---
// 栗山→（右下で追分）→下に安平→左下へ早来/遠浅/沼ノ端
// →右上に植苗→上に南千歳→左へ→北広島から上へ。
// 北上線は白石より十分内側(x小さめ)で、岩見沢経由と交差しないようにする
const RAW_OIWAKE_BRANCH = [
  { x: 4000, y: 1180 }, // 0 栗山
  { x: 4100, y: 1370 }, // 1 由仁
  { x: 4160, y: 1560 }, // 2 古山
  { x: 4180, y: 1750 }, // 3 三川
  { x: 4180, y: 1940 }, // 4 追分
  { x: 3960, y: 2000 }, // 5 安平
  { x: 3700, y: 1930 }, // 6 早来
  { x: 3460, y: 1860 }, // 7 遠浅
  { x: 3220, y: 1800 }, // 8 沼ノ端
  { x: 3340, y: 1610 }, // 9 植苗（沼ノ端の右上）
  { x: 3220, y: 1420 }, // 10 南千歳（植苗の上）
  { x: 2980, y: 1360 }, // 11 千歳
  { x: 2740, y: 1320 }, // 12 長都
  { x: 2500, y: 1320 }, // 13 サッポロビール庭園
  { x: 2260, y: 1320 }, // 14 恵庭
  { x: 2020, y: 1320 }, // 15 恵み野
  { x: 1800, y: 1340 }, // 16 島松
  { x: 1620, y: 1460 }, // 17 北広島
  { x: 1620, y: 1260 }, // 18 上野幌
  { x: 1620, y: 1060 }, // 19 新札幌
  { x: 1620, y: 860 },  // 20 平和
];

// --- 共通区間（白石〜小樽: 左上がり・駅間を約300pxに拡大）---
const COMMON_COUNT = 17;
const RAW_COMMON_START_X = 1900; // 白石（追分の北上線・岩見沢の下り線が合流）
const RAW_COMMON_END_X = 100;    // 小樽
const RAW_COMMON_START_Y = 700;  // 白石
const RAW_COMMON_END_Y = 120;    // 小樽

// 上記 RAW 値を確保した上で、駅間が約300px以上になるよう横幅を再計算
// （白石→小樽の x スパンを広く取り直す）
const COMMON_SPAN_X = 4200;      // 共通区間の横スパン（広く）
const COMMON_SPAN_Y = 1000;      // 共通区間の縦スパン（左上がり）
const RAW_COORD_COMMON = (function () {
  const arr = [];
  const startX = RAW_COMMON_START_X + (COMMON_SPAN_X - (RAW_COMMON_START_X - RAW_COMMON_END_X));
  // 白石を最も右に、小樽を左上に。白石x = startX、小樽x = startX - COMMON_SPAN_X
  for (let i = 0; i < COMMON_COUNT; i++) {
    const t = i / (COMMON_COUNT - 1);
    arr.push({
      x: Math.round(startX - COMMON_SPAN_X * t),
      y: Math.round(RAW_COMMON_START_Y - COMMON_SPAN_Y * t),
    });
  }
  return arr;
})();

// 全 RAW 座標に MARGIN を加算して実座標へ
function applyMargin(arr) {
  return arr.map((c) => ({ x: c.x + MARGIN, y: c.y + MARGIN }));
}
const COORD_IWAMIZAWA_BRANCH = applyMargin(RAW_IWAMIZAWA_BRANCH);
const COORD_OIWAKE_BRANCH = applyMargin(RAW_OIWAKE_BRANCH);
const COORD_COMMON = applyMargin(RAW_COORD_COMMON);

function coordOf(routeKey, pos) {
  const cs = commonStart[routeKey];
  if (typeof cs === "number" && pos >= cs) {
    return COORD_COMMON[pos - cs] || COORD_COMMON[COORD_COMMON.length - 1];
  }
  if (routeKey === "iwamizawa") {
    return COORD_IWAMIZAWA_BRANCH[pos] || COORD_IWAMIZAWA_BRANCH[0];
  }
  return COORD_OIWAKE_BRANCH[pos] || COORD_OIWAKE_BRANCH[0];
}

// ===== ルーレットを 1.5倍化（index.html は無改変）=====
(function enlargeWheel() {
  if (!wheel) return;
  wheel.width = 360;
  wheel.height = 360;
  wheel.style.width = "240px";
  wheel.style.height = "240px";
  wheel.style.cursor = "pointer";
  const wrap = document.getElementById("rouletteWrap");
  if (wrap) {
    wrap.style.width = "240px";
    wrap.style.height = "261px";
  }
})();

// ===== 音（iOS Safari対策：壊れたら作り直す）=====
let audioCtx = null;
function createAudio() {
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { audioCtx = null; }
}
function unlockAudio() {
  if (!audioCtx) { createAudio(); }
  if (!audioCtx) return;
  if (audioCtx.state === "running") return;
  try { audioCtx.resume(); } catch (e) {}
  if (audioCtx.state !== "running") {
    try { audioCtx.close(); } catch (e) {}
    createAudio();
    if (audioCtx) { try { audioCtx.resume(); } catch (e) {} }
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && audioCtx && audioCtx.state !== "running") {
    try { audioCtx.resume(); } catch (e) {}
  }
});

function beep(freq, durationMs, type = "square", volume = 0.2) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq; gain.gain.value = volume;
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + durationMs / 1000);
}
function clickSound(kind) {
  unlockAudio();
  if (kind === "name")  { beep(880, 90, "square", 0.22); setTimeout(() => beep(1320, 120, "square", 0.22), 90); }
  else if (kind === "start") { beep(523, 110, "triangle", 0.25); setTimeout(() => beep(784, 150, "triangle", 0.25), 110); }
  else if (kind === "reset") { beep(440, 110, "sawtooth", 0.2); setTimeout(() => beep(330, 140, "sawtooth", 0.2), 110); }
  else if (kind === "route") { beep(740, 80, "square", 0.2); setTimeout(() => beep(988, 100, "square", 0.2), 80); }
  else { beep(700, 90, "square", 0.2); }
}
let tickTimer = null;
function startTicking() {
  let interval = 60;
  const tick = () => { beep(900, 30, "square", 0.12); interval += 12; if (interval < 280) tickTimer = setTimeout(tick, interval); };
  tick();
}
function stopTicking() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }
function stopSound() { beep(660, 120, "triangle", 0.3); setTimeout(() => beep(880, 160, "triangle", 0.3), 120); }
function stepSound() { beep(1200, 60, "square", 0.2); }
function fanfare() {
  const seq = [
    { f: 523, t: 0, d: 140 }, { f: 523, t: 160, d: 140 }, { f: 523, t: 320, d: 140 },
    { f: 659, t: 480, d: 260 }, { f: 784, t: 760, d: 260 }, { f: 1047, t: 1040, d: 520 }
  ];
  seq.forEach((n) => setTimeout(() => { beep(n.f, n.d, "triangle", 0.32); beep(n.f * 1.5, n.d, "square", 0.10); }, n.t));
}

// ===== ルーレット描画（数字を帯の上下中央に揃える）=====
function drawWheel() {
  const size = wheel.width;
  const r = size / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, size, size);

  ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#cccccc"; ctx.stroke();

  const outerR = r - 6;
  const prevInnerR = r * 0.50;
  const prevBandW = outerR - prevInnerR;
  const bandW = prevBandW * 0.70;
  const innerR = outerR - bandW;
  const lineGray = "#9aa1a8";

  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * seg - Math.PI / 2;
    const end = (i + 1) * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(r, r, outerR, start, end);
    ctx.arc(r, r, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    const label = String(i + 1);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.font = "bold " + Math.round(r * 0.30) + "px sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.35)";
    const textR = (outerR + innerR) / 2;
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(label, 0, -textR);
    ctx.fillText(label, 0, -textR);
    ctx.restore();
  }

  const decagonR   = r * 0.30;
  const circleBig  = r * 0.165;
  const circleSmall= r * 0.085;

  const tickOuter = innerR - 4;
  const tickInner = decagonR + 4;
  ctx.strokeStyle = lineGray;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i + 0.5) * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(r + Math.cos(a) * tickInner, r + Math.sin(a) * tickInner);
    ctx.lineTo(r + Math.cos(a) * tickOuter, r + Math.sin(a) * tickOuter);
    ctx.stroke();
  }

  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const ang = k * seg - Math.PI / 2;
    const x = r + Math.cos(ang) * decagonR;
    const y = r + Math.sin(ang) * decagonR;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = lineGray; ctx.stroke();

  ctx.beginPath();
  ctx.arc(r, r, circleBig, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = lineGray; ctx.stroke();

  ctx.beginPath();
  ctx.arc(r, r, circleSmall, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = lineGray; ctx.stroke();
}
drawWheel();

function spinTo(dice, onStop) {
  startTicking();
  const seg = 360 / SEGMENTS;
  const targetCenter = (dice - 1) * seg + seg / 2;
  const finalFacing = (360 - targetCenter) % 360;
  const currentFacing = ((currentRotation % 360) + 360) % 360;
  let delta = finalFacing - currentFacing;
  if (delta < 0) delta += 360;
  currentRotation += delta + 360 * 5;
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(() => { stopTicking(); stopSound(); if (onStop) setTimeout(onStop, 400); }, 4000);
}

// ===== 駅情報の取得（ルート別）=====
function stationOf(routeKey, i) {
  const arr = routes[routeKey] || [];
  return arr[i] || { kanji: String(i), kana: "", romaji: "" };
}

function positionsUpToShown() {
  const pos = {};
  latestState.players.forEach((p, i) => { pos[i] = 0; });
  const moves = latestState.moves || [];
  moves.forEach((m) => { if (m.seq <= lastShownSeq) pos[m.index] = m.to; });
  return pos;
}

// =========================================================
//  背景路線図 SVG を生成（自作・著作権フリー）
// =========================================================
function lineThrough(coords, color, width) {
  const pts = coords.map((c) => `${c.x},${c.y}`).join(" ");
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`;
}

function buildRouteSVG() {
  const COL_IWA = "#d35400";
  const COL_OIW = "#16a085";
  const COL_COM = "#34495e";

  const iwaPath = COORD_IWAMIZAWA_BRANCH.concat([COORD_COMMON[0]]);
  const oiwPath = COORD_OIWAKE_BRANCH.concat([COORD_COMMON[0]]);
  const comPath = COORD_COMMON;

  let svg = `<svg id="routeSvg" width="${BOARD_W}" height="${BOARD_H}" viewBox="0 0 ${BOARD_W} ${BOARD_H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" fill="#fbf7ee" />`;
  svg += lineThrough(iwaPath, COL_IWA, 14);
  svg += lineThrough(oiwPath, COL_OIW, 14);
  svg += lineThrough(comPath, COL_COM, 16);

  function dots(coords) {
    let s = "";
    coords.forEach((c) => {
      s += `<circle cx="${c.x}" cy="${c.y}" r="9" fill="#fff" stroke="#555" stroke-width="3" />`;
    });
    return s;
  }
  svg += dots(COORD_IWAMIZAWA_BRANCH);
  svg += dots(COORD_OIWAKE_BRANCH);
  svg += dots(COORD_COMMON);

  // ルート名ラベル（線・駅に重ならない空き領域へ）
  const iwaEnd = COORD_IWAMIZAWA_BRANCH[4];   // 岩見沢付近
  const oiwEnd = COORD_OIWAKE_BRANCH[4];       // 追分付近
  const comEnd = COORD_COMMON[COMMON_COUNT - 1]; // 小樽付近
  svg += `<text x="${iwaEnd.x + 120}" y="${iwaEnd.y - 60}" font-size="42" fill="${COL_IWA}" font-weight="bold">岩見沢経由</text>`;
  svg += `<text x="${oiwEnd.x + 120}" y="${oiwEnd.y + 80}" font-size="42" fill="${COL_OIW}" font-weight="bold">追分経由</text>`;
  svg += `<text x="${comEnd.x - 40}" y="${comEnd.y - 80}" font-size="42" fill="${COL_COM}" font-weight="bold">函館本線</text>`;

  svg += `</svg>`;
  return svg;
}

// ===== 721系コマ（元画像寄り・横帯でプレイヤー識別）=====
function makeTrain(colorIndex, name, dir) {
  const wrap = document.createElement("div");
  wrap.className = "pawnWrap";
  const train = document.createElement("div");
  train.className = "train";
  if (dir === "L") train.classList.add("flip");
  train.style.setProperty("--bandColor", COLORS[colorIndex]);
  train.innerHTML =
    '<div class="trainBody">' +
      '<div class="trainRoof">' +
        '<i class="ac"></i><i class="ac"></i><i class="ac"></i>' +
      '</div>' +
      '<div class="trainFront"></div>' +
      '<div class="trainDest"></div>' +
      '<div class="trainWindows">' +
        '<span class="cab"></span>' +
        '<span class="door"></span>' +
        '<span></span><span></span><span></span>' +
        '<span class="door"></span>' +
        '<span></span><span></span><span></span>' +
        '<span class="door"></span>' +
        '<span></span>' +
      '</div>' +
      '<div class="lineThin"></div>' +
      '<div class="lineThick"></div>' +
    '</div>' +
    '<div class="trainUnder">' +
      '<div class="trainSkirt"></div>' +
      '<div class="underBox"></div>' +
    '</div>' +
    '<div class="trainWheels">' +
      '<div class="bogie"><i class="w1"></i><i class="w2"></i></div>' +
      '<div class="bogie"><i class="w1"></i><i class="w2"></i></div>' +
      '<div class="bogie"><i class="w1"></i><i class="w2"></i></div>' +
    '</div>';
  const nm = document.createElement("div");
  nm.className = "pawnName"; nm.textContent = name;
  wrap.appendChild(train); wrap.appendChild(nm);
  return wrap;
}

// ===== 盤面描画（座標方式）=====
let cellMap = {};
let coordCellDrawn = {};

function buildSign(routeKey, pos) {
  const sign = document.createElement("div");
  sign.className = "stSign";
  const st = stationOf(routeKey, pos);
  const kanji = document.createElement("div");
  kanji.className = "stKanji"; kanji.textContent = st.kanji;
  const kana = document.createElement("div");
  kana.className = "stKana"; kana.textContent = st.kana;
  const band = document.createElement("div");
  band.className = "stBand";
  const romaji = document.createElement("div");
  romaji.className = "stRomaji"; romaji.textContent = st.romaji;
  band.appendChild(romaji);
  sign.appendChild(kanji); sign.appendChild(kana); sign.appendChild(band);
  return sign;
}

function makeCell(routeKey, pos) {
  const c = coordOf(routeKey, pos);
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.style.left = c.x + "px";
  cell.style.top = c.y + "px";

  const st = stationOf(routeKey, pos);
  if (pos === 0) cell.classList.add("start");
  const goal = goals[routeKey];
  const isGoal = pos === goal;
  if (isGoal) cell.classList.add("goal");
  if (st.kanji.length >= 6) cell.classList.add("longName");

  cell.appendChild(buildSign(routeKey, pos));

  if (pos === 0) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "START"; cell.appendChild(tag);
  } else if (isGoal) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "GOAL"; cell.appendChild(tag);
  }

  const pawns = document.createElement("div");
  pawns.className = "pawns";
  cell.appendChild(pawns);
  return cell;
}

function renderBoard(positions, override) {
  boardEl.innerHTML = "";
  boardEl.style.width = BOARD_W + "px";
  boardEl.style.height = BOARD_H + "px";
  cellMap = {};
  coordCellDrawn = {};

  const bg = document.createElement("div");
  bg.className = "routeBg";
  bg.innerHTML = buildRouteSVG();
  boardEl.appendChild(bg);

  ["iwamizawa", "oiwake"].forEach((rk) => {
    const arr = routes[rk] || [];
    const cs = commonStart[rk];
    for (let pos = 0; pos < arr.length; pos++) {
      if (typeof cs === "number" && pos >= cs) {
        const ckey = "C:" + (pos - cs);
        if (coordCellDrawn[ckey]) {
          cellMap[rk + ":" + pos] = coordCellDrawn[ckey];
          continue;
        }
        const cell = makeCell(rk, pos);
        boardEl.appendChild(cell);
        coordCellDrawn[ckey] = cell;
        cellMap[rk + ":" + pos] = cell;
      } else {
        const cell = makeCell(rk, pos);
        boardEl.appendChild(cell);
        cellMap[rk + ":" + pos] = cell;
      }
    }
  });

  latestState.players.forEach((p, idx) => {
    let pos = positions[idx];
    if (override && override.idx === idx) pos = override.pos;
    const rk = p.routeKey || "oiwake";
    const cell = cellMap[rk + ":" + pos];
    if (!cell) return;
    const pawnsEl = cell.querySelector(".pawns");
    if (pawnsEl) pawnsEl.appendChild(makeTrain(idx, p.name, "L"));
  });
}

// ===== 指定駅(rk,pos)を盤面ビューポート中央へ（背景が動く）=====
function centerOnCell(pos, rk, smooth) {
  const cell = cellMap[rk + ":" + pos];
  if (!cell || !boardScrollEl) return;
  const targetLeft = cell.offsetLeft + cell.offsetWidth / 2 - boardScrollEl.clientWidth / 2;
  const targetTop  = cell.offsetTop + cell.offsetHeight / 2 - boardScrollEl.clientHeight / 2;
  boardScrollEl.scrollTo({
    left: targetLeft,
    top: targetTop,
    behavior: smooth ? "smooth" : "auto",
  });
}

function centerOnActivePlayer(smooth) {
  if (!latestState) return;
  let idx = -1;
  if (latestState.started && !latestState.finished &&
      typeof latestState.currentTurn === "number") {
    idx = latestState.currentTurn;
  } else {
    idx = latestState.players.findIndex((p) => p.id === myId);
    if (idx < 0) idx = 0;
  }
  const p = latestState.players[idx];
  if (!p) return;
  const rk = p.routeKey || "oiwake";
  centerOnCell(p.pos, rk, smooth);
}

function animateSteps(playerIndex, from, to, onDone) {
  let current = from;
  const rk = latestState.players[playerIndex].routeKey || "oiwake";
  const stepOnce = () => {
    if (current >= to) { if (onDone) onDone(); return; }
    current += 1;
    renderBoard(positionsUpToShown(), { idx: playerIndex, pos: current });
    stepSound();
    centerOnCell(current, rk, true);
    if (current >= to) { if (onDone) setTimeout(onDone, 300); return; }
    setTimeout(stepOnce, 350);
  };
  if (from === to) { if (onDone) onDone(); return; }
  stepOnce();
}

function processNextMove() {
  if (animating || !latestState) return;
  const moves = latestState.moves || [];
  const next = moves.find((m) => m.seq === lastShownSeq + 1);
  if (!next) { finalizeState(latestState); return; }

  animating = true;
  canRoll = false;
  const rk = latestState.players[next.index].routeKey || "oiwake";
  statusEl.textContent = next.name + " がルーレットを回しています...";
  renderBoard(positionsUpToShown(), { idx: next.index, pos: next.from });
  centerOnCell(next.from, rk, true);

  spinTo(next.dice, () => {
    const st = stationOf(rk, next.to);
    statusEl.textContent = next.name + " が " + next.dice + " を出して「" + st.kanji + "」へ";
    animateSteps(next.index, next.from, next.to, () => {
      lastShownSeq = next.seq;
      if (next.to >= goals[rk] && !fanfaredIndexes[next.index]) {
        fanfaredIndexes[next.index] = true;
        statusEl.textContent = next.name + " が小樽にゴール！";
        fanfare();
      }
      animating = false;
      processNextMove();
    });
  });
}

// ===== ルーレットを回す（本体クリック）=====
function tryRoll() {
  if (!canRoll) return;
  unlockAudio();
  canRoll = false;
  socket.emit("roll");
}
wheel.addEventListener("click", tryRoll);

// ===== ボタン =====
nameBtn.addEventListener("click", () => {
  clickSound("name");
  const name = nameInput.value.trim();
  if (name) socket.emit("setName", name);
});
routeOiwakeBtn.addEventListener("click", () => { clickSound("route"); socket.emit("setRoute", "oiwake"); });
routeIwamizawaBtn.addEventListener("click", () => { clickSound("route"); socket.emit("setRoute", "iwamizawa"); });
startBtn.addEventListener("click", () => { clickSound("start"); socket.emit("start"); });
resetBtn.addEventListener("click", () => {
  clickSound("reset");
  if (confirm("ゲームをリセットして最初に戻しますか？")) socket.emit("reset");
});

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => { statusEl.textContent = msg; startBtn.disabled = true; canRoll = false; });

socket.on("resetReady", () => {
  nameInput.value = "";
  lastShownSeq = 0; animating = false; fanfaredIndexes = {}; currentRotation = 0;
  canRoll = false;
  wheel.style.transition = "none"; wheel.style.transform = "rotate(0deg)";
  setTimeout(() => { wheel.style.transition = ""; }, 50);
  resultEl.classList.remove("show");
  myId = null;
  socket.disconnect();
  setTimeout(() => socket.connect(), 300);
});

socket.on("state", (state) => {
  routes = state.routes || routes;
  goals = state.goals || goals;
  commonStart = state.commonStart || commonStart;
  if (!state.started) { lastShownSeq = 0; animating = false; fanfaredIndexes = {}; }
  latestState = state;
  if (!state.started || state.finished) finalizeState(state);
  processNextMove();
});

// ===== ルート選択UI =====
function updateRouteUI(state) {
  const me = state.players.find((p) => p.id === myId);
  const myRoute = me ? (me.routeKey || "oiwake") : "oiwake";
  routeLabel.textContent = "あなたのルート：" + (ROUTE_NAMES[myRoute] || "");
  routeOiwakeBtn.classList.toggle("selected", myRoute === "oiwake");
  routeIwamizawaBtn.classList.toggle("selected", myRoute === "iwamizawa");
  routeArea.style.display = state.started ? "none" : "";
}

function finalizeState(state) {
  updateRouteUI(state);
  renderBoard(positionsUpToShown());

  playersEl.innerHTML = state.players
    .map((p, idx) => {
      const rk = p.routeKey || "oiwake";
      const st = stationOf(rk, p.pos);
      return `<span style="color:${COLORS[idx]}">●</span>${p.name}（${ROUTE_NAMES[rk]}・${st.kanji}）`;
    })
    .join("　");

  const allMovesShown = !state.moves || state.moves.length === 0 ||
    state.moves[state.moves.length - 1].seq === lastShownSeq;

  if (state.finished && allMovesShown && !animating) {
    statusEl.textContent = "🏁 全員ゴール（小樽）！ゲーム終了";
    startBtn.disabled = true; canRoll = false;
    showResult(state);
    centerOnActivePlayer(true);
    return;
  }
  if (!state.started) {
    statusEl.textContent = "ルートと名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false; canRoll = false;
    resultEl.classList.remove("show");
    centerOnActivePlayer(false);
    return;
  }
  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn ? "あなたの番です！ルーレットをタップして回してください"
    : (current ? current.name + " の番です..." : "");
  canRoll = !!myTurn && !animating;

  if (!animating) centerOnActivePlayer(true);
}

function showResult(state) {
  if (!state.finished) { resultEl.classList.remove("show"); return; }
  const ranked = [...state.players].filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.innerHTML = "<h2>🏁 結果</h2>" +
    ranked.map((p) => `${p.rank}位：${p.name}（${ROUTE_NAMES[p.routeKey || "oiwake"]}）`).join("<br>");
  resultEl.classList.add("show");
}
