/* =========================================================
   すごろくゲーム  client.js
   バージョン: v4.0
   日付: 2026-06-21（日）11:35 JST
   v4.0での変更点（v3.8現物を土台に機能のみ追加）:
     - 栗山の分裂バグ修正：追分ルートの起点(栗山)を岩見沢側の栗山セルと
       共有し、栗山セルを1枚だけ描画。両ルートの起点座標を一致させた。
     - 栗山→栗丘 / 栗山→由仁 の最初の1区間だけ距離を拡大。
       （栗丘を上へ、由仁を右下へ離す。他の駅・看板・コマは不変）
     - 効果音を mp3/wav に差し替え：
         コマ移動         = train.mp3
         最後のゴール      = goal.mp3 ＋ gameover.wav を同時再生
         1〜4位のゴール    = rank.mp3
         リセット          = reset.wav（鳴っている音を止めて再生）
         ゲーム開始        = start.wav
         自分の番          = your_turn.wav
       roll.mp3 はルーレット回転速度に合わせ連続再生（v3.8の方式を維持）。
     - 駅位置一覧(#players)・最終順位表示(#result)を撤去。
     - ゲーム開始ボタンは開始後グレーアウト。
     - 看板/コマ/ルーレット描画/座標骨格は v3.8 現物のまま。MARGIN=1800。
   ※ server.js v3.8 / index.html v4.0 とセットで使うこと
   ========================================================= */

const socket = io();
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa"];
const SEGMENTS = 10;
const MAX_SEATS = 5;

const WHEEL_COLORS = [
  "#f4d000", "#f5a623", "#e8731c", "#e8231c", "#e6007e",
  "#9b3fb5", "#5b3fb5", "#1c9ee8", "#2e8b3f", "#8bc63f",
];

const ROUTE_NAMES = { oiwake: "追分経由", iwamizawa: "岩見沢経由" };

let myId = null;
let mySeat = -1;
let routes = { oiwake: [], iwamizawa: [] };
let goals = { oiwake: 0, iwamizawa: 0 };
let commonStart = { oiwake: 0, iwamizawa: 0 };
let currentRotation = 0;

let fanfaredIndexes = {};
let lastShownSeq = 0;
let animating = false;
let latestState = null;
let canRoll = false;

let draftNames = ["", "", "", "", ""];

const boardEl = document.getElementById("board");
const boardScrollEl = document.querySelector(".boardScroll");
const seatsEl = document.getElementById("seats");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");

// =========================================================
//  駅座標テーブル（白石中心の三差路・広域図準拠）
//  v4.0：栗山を岩見沢側のみで保持し、栗丘/由仁の始点間隔を拡大。
// =========================================================
const MARGIN = 1800;
const SHI_X = 3400;
const SHI_Y = 1400;

const COMMON_COUNT = 17;
const COMMON_STEP_X = 250;
const COMMON_STEP_Y = 60;
const RAW_COMMON = (function () {
  const arr = [];
  for (let i = 0; i < COMMON_COUNT; i++) {
    arr.push({ x: SHI_X - COMMON_STEP_X * i, y: SHI_Y - COMMON_STEP_Y * i });
  }
  return arr;
})();

// v4.0：栗丘(index1)を従来 -430 → -520 へ上に離す（栗山との間隔拡大）
const RAW_IWAMIZAWA_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山（両ルート共有の起点）
  { x: SHI_X + 1850, y: SHI_Y - 520 },  // 1 栗丘（v4.0 上へ離す）
  { x: SHI_X + 1850, y: SHI_Y - 700 },  // 2 栗沢
  { x: SHI_X + 1850, y: SHI_Y - 880 },  // 3 志文
  { x: SHI_X + 1850, y: SHI_Y - 1060 }, // 4 岩見沢
  { x: SHI_X + 1600, y: SHI_Y - 1060 }, // 5 上幌向
  { x: SHI_X + 1360, y: SHI_Y - 1030 }, // 6 幌向
  { x: SHI_X + 1140, y: SHI_Y - 960 },  // 7 豊幌
  { x: SHI_X + 940,  y: SHI_Y - 870 },  // 8 江別
  { x: SHI_X + 760,  y: SHI_Y - 780 },  // 9 高砂
  { x: SHI_X + 600,  y: SHI_Y - 680 },  // 10 野幌
  { x: SHI_X + 450,  y: SHI_Y - 580 },  // 11 大麻
  { x: SHI_X + 310,  y: SHI_Y - 470 },  // 12 森林公園
  { x: SHI_X + 180,  y: SHI_Y - 350 },  // 13 厚別
];

// v4.0：栗山(index0)は岩見沢側と同一座標を保持しつつ、描画時は共有して
//        セルを1枚に統合する。由仁(index1)を従来より右下へ離す。
const RAW_OIWAKE_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山（岩見沢側と同一・描画は共有）
  { x: SHI_X + 2110, y: SHI_Y - 20 },   // 1 由仁（v4.0 右下へ離す）
  { x: SHI_X + 2190, y: SHI_Y + 180 },  // 2 古山
  { x: SHI_X + 2220, y: SHI_Y + 400 },  // 3 三川
  { x: SHI_X + 2220, y: SHI_Y + 640 },  // 4 追分
  { x: SHI_X + 2000, y: SHI_Y + 840 },  // 5 安平
  { x: SHI_X + 1760, y: SHI_Y + 1040 }, // 6 早来
  { x: SHI_X + 1530, y: SHI_Y + 1230 }, // 7 遠浅
  { x: SHI_X + 1310, y: SHI_Y + 1380 }, // 8 沼ノ端
  { x: SHI_X + 1310, y: SHI_Y + 1160 }, // 9 植苗
  { x: SHI_X + 1310, y: SHI_Y + 980 },  // 10 南千歳
  { x: SHI_X + 1310, y: SHI_Y + 820 },  // 11 千歳
  { x: SHI_X + 1310, y: SHI_Y + 660 },  // 12 長都
  { x: SHI_X + 1310, y: SHI_Y + 500 },  // 13 サッポロビール庭園
  { x: SHI_X + 1310, y: SHI_Y + 340 },  // 14 恵庭
  { x: SHI_X + 1310, y: SHI_Y + 180 },  // 15 恵み野
  { x: SHI_X + 1310, y: SHI_Y + 20 },   // 16 島松
  { x: SHI_X + 1310, y: SHI_Y - 140 },  // 17 北広島
  { x: SHI_X + 1010, y: SHI_Y + 180 },  // 18 上野幌
  { x: SHI_X + 690,  y: SHI_Y + 340 },  // 19 新札幌
  { x: SHI_X + 370,  y: SHI_Y + 420 },  // 20 平和
];

const ALL_RAW = RAW_IWAMIZAWA_BRANCH.concat(RAW_OIWAKE_BRANCH, RAW_COMMON);
const MIN_X = Math.min.apply(null, ALL_RAW.map((c) => c.x));
const MIN_Y = Math.min.apply(null, ALL_RAW.map((c) => c.y));
const MAX_X = Math.max.apply(null, ALL_RAW.map((c) => c.x));
const MAX_Y = Math.max.apply(null, ALL_RAW.map((c) => c.y));

function norm(arr) {
  return arr.map((c) => ({
    x: Math.round(c.x - MIN_X + MARGIN),
    y: Math.round(c.y - MIN_Y + MARGIN),
  }));
}
const COORD_IWAMIZAWA_BRANCH = norm(RAW_IWAMIZAWA_BRANCH);
const COORD_OIWAKE_BRANCH = norm(RAW_OIWAKE_BRANCH);
const COORD_COMMON = norm(RAW_COMMON);

const BOARD_W = Math.round(MAX_X - MIN_X) + MARGIN * 2;
const BOARD_H = Math.round(MAX_Y - MIN_Y) + MARGIN * 2;

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

// ===== ルーレット右上フロート・直径=縦幅50% =====
(function setupWheel() {
  if (!wheel) return;
  wheel.width = 360;
  wheel.height = 360;
  wheel.style.cursor = "pointer";
  applyWheelSize();
})();

function applyWheelSize() {
  if (!wheel) return;
  const d = Math.round(window.innerHeight * 0.5);
  wheel.style.width = d + "px";
  wheel.style.height = d + "px";
  const wrap = document.getElementById("rouletteWrap");
  if (wrap) {
    wrap.style.width = d + "px";
  }
}
window.addEventListener("resize", applyWheelSize);

// =========================================================
//  音（mp3/wav 再生・public/sounds/）  v4.0で差し替え
// =========================================================
const SOUND_FILES = {
  move: "/sounds/train.mp3",        // コマ移動
  goal: "/sounds/goal.mp3",         // 最後のゴール
  gameover: "/sounds/gameover.wav", // 最後のゴール（goalと同時）
  rank: "/sounds/rank.mp3",         // 1〜4位ゴール
  reset: "/sounds/reset.wav",       // リセット
  start: "/sounds/start.wav",       // ゲーム開始
  yourTurn: "/sounds/your_turn.wav",// 自分の番
  roll: "/sounds/roll.mp3",         // ルーレット回転（連続再生）
};
const audioCache = {};
let audioUnlocked = false;

function preloadSounds() {
  Object.keys(SOUND_FILES).forEach((key) => {
    try {
      const a = new Audio(SOUND_FILES[key]);
      a.preload = "auto";
      audioCache[key] = a;
    } catch (e) { /* ignore */ }
  });
}
preloadSounds();

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  Object.keys(audioCache).forEach((key) => {
    const a = audioCache[key];
    if (!a) return;
    try {
      a.muted = true;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
         .catch(() => { a.muted = false; });
      } else {
        a.pause(); a.currentTime = 0; a.muted = false;
      }
    } catch (e) { /* ignore */ }
  });
}
document.addEventListener("pointerdown", unlockAudio, { once: false });

function playSound(key) {
  const a = audioCache[key];
  if (!a) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

// 現在鳴っている主要効果音を止める（リセット時用）
function stopAllSounds() {
  Object.keys(audioCache).forEach((key) => {
    if (key === "roll") return; // rollはtickerで個別管理
    const a = audioCache[key];
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ }
  });
  stopRollTicking();
}

// ===== roll.mp3 をルーレット回転速度に合わせ連続再生（v3.8方式維持）=====
let rollTickTimer = null;
function startRollTicking() {
  let interval = 60;
  const tick = () => {
    try {
      const src = audioCache.roll;
      if (src && src.src) {
        const a = new Audio(src.src);
        a.volume = 0.9;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* ignore */ }
    interval += 12;
    if (interval < 280) rollTickTimer = setTimeout(tick, interval);
  };
  tick();
}
function stopRollTicking() {
  if (rollTickTimer) { clearTimeout(rollTickTimer); rollTickTimer = null; }
}

// ===== ルーレット描画（v3.8現物のまま・変更なし）=====
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
  startRollTicking();
  const seg = 360 / SEGMENTS;
  const targetCenter = (dice - 1) * seg + seg / 2;
  const finalFacing = (360 - targetCenter) % 360;
  const currentFacing = ((currentRotation % 360) + 360) % 360;
  let delta = finalFacing - currentFacing;
  if (delta < 0) delta += 360;
  currentRotation += delta + 360 * 5;
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(() => { stopRollTicking(); if (onStop) setTimeout(onStop, 400); }, 4000);
}

// ===== 駅情報 =====
function stationOf(routeKey, i) {
  const arr = routes[routeKey] || [];
  return arr[i] || { kanji: String(i), kana: "", romaji: "" };
}

function positionsUpToShown() {
  const pos = {};
  latestState.players.forEach((p, i) => { pos[i] = 0; });
  const mv = latestState.moves || [];
  mv.forEach((m) => { if (m.seq <= lastShownSeq) pos[m.index] = m.to; });
  return pos;
}

// ===== 背景路線図 SVG（v3.8現物のまま）=====
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

  const iwaTip = COORD_IWAMIZAWA_BRANCH[4];
  const oiwTip = COORD_OIWAKE_BRANCH[4];
  const comTip = COORD_COMMON[COMMON_COUNT - 1];
  svg += `<text x="${iwaTip.x + 120}" y="${iwaTip.y - 40}" font-size="44" fill="${COL_IWA}" font-weight="bold">岩見沢経由</text>`;
  svg += `<text x="${oiwTip.x + 120}" y="${oiwTip.y + 70}" font-size="44" fill="${COL_OIW}" font-weight="bold">追分経由</text>`;
  svg += `<text x="${comTip.x - 30}" y="${comTip.y - 80}" font-size="44" fill="${COL_COM}" font-weight="bold">函館本線</text>`;

  svg += `</svg>`;
  return svg;
}

// ===== 721系コマ（v3.8現物のまま・変更なし）=====
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
    '</div>';
  const nm = document.createElement("div");
  nm.className = "pawnName"; nm.textContent = name;
  wrap.appendChild(train); wrap.appendChild(nm);
  return wrap;
}

// ===== 盤面描画 =====
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

  if (pos === 0) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "START"; cell.appendChild(tag);
  } else if (isGoal) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "GOAL"; cell.appendChild(tag);
  }

  cell.appendChild(buildSign(routeKey, pos));

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

  // v4.0：栗山(pos 0)は両ルートで1枚だけ描画して共有する（分裂バグ修正）
  let startCellDrawn = null;

  ["iwamizawa", "oiwake"].forEach((rk) => {
    const arr = routes[rk] || [];
    const cs = commonStart[rk];
    for (let pos = 0; pos < arr.length; pos++) {
      // 起点(栗山)はルート間で共有
      if (pos === 0) {
        if (startCellDrawn) {
          cellMap[rk + ":0"] = startCellDrawn;
          continue;
        }
        const cell = makeCell(rk, 0);
        boardEl.appendChild(cell);
        startCellDrawn = cell;
        cellMap[rk + ":0"] = cell;
        continue;
      }
      // 共通区間は座標キーで共有
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
    if (!p) return;
    let pos = positions[idx];
    if (override && override.idx === idx) pos = override.pos;
    const rk = p.routeKey || "oiwake";
    const cell = cellMap[rk + ":" + pos];
    if (!cell) return;
    const pawnsEl = cell.querySelector(".pawns");
    if (pawnsEl) pawnsEl.appendChild(makeTrain(idx, p.name, "L"));
  });
}

// ===== 中央追従 =====
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
    idx = mySeat >= 0 ? mySeat : 0;
  }
  const p = latestState.players[idx];
  if (!p) return;
  const rk = p.routeKey || "oiwake";
  centerOnCell(p.pos, rk, smooth);
}

function animateSteps(playerIndex, from, to, onDone) {
  let current = from;
  const pl = latestState.players[playerIndex];
  const rk = (pl && pl.routeKey) || "oiwake";
  const stepOnce = () => {
    if (current >= to) { if (onDone) onDone(); return; }
    current += 1;
    renderBoard(positionsUpToShown(), { idx: playerIndex, pos: current });
    centerOnCell(current, rk, true);
    playSound("move"); // v4.0：コマ移動音 = train.mp3
    if (current >= to) { if (onDone) setTimeout(onDone, 300); return; }
    setTimeout(stepOnce, 350);
  };
  if (from === to) { if (onDone) onDone(); return; }
  stepOnce();
}

// 着順に応じたゴール音（v4.0）
function playGoalSound(playerIndex) {
  // 全プレイヤー数（参加席数）と、これまでのゴール数で「最後か」を判定
  const total = latestState.players.filter((p) => p).length;
  const finishedSoFar = latestState.players.filter((p) => p && p.rank && p.rank > 0).length;
  const isLast = finishedSoFar >= total;
  if (isLast) {
    // 最後のプレイヤー → goal.mp3 と gameover.wav を同時
    playSound("goal");
    playSound("gameover");
  } else {
    // 1〜4位 → rank.mp3
    playSound("rank");
  }
}

function processNextMove() {
  if (animating || !latestState) return;
  const mv = latestState.moves || [];
  const next = mv.find((m) => m.seq === lastShownSeq + 1);
  if (!next) { finalizeState(latestState); return; }

  animating = true;
  canRoll = false;
  const pl = latestState.players[next.index];
  const rk = (pl && pl.routeKey) || "oiwake";
  renderBoard(positionsUpToShown(), { idx: next.index, pos: next.from });
  centerOnCell(next.from, rk, true);

  spinTo(next.dice, () => {
    animateSteps(next.index, next.from, next.to, () => {
      lastShownSeq = next.seq;
      if (next.to >= goals[rk] && !fanfaredIndexes[next.index]) {
        fanfaredIndexes[next.index] = true;
        playGoalSound(next.index); // v4.0：着順別ゴール音
      }
      animating = false;
      processNextMove();
    });
  });
}

// ===== ルーレットを回す =====
function tryRoll() {
  if (!canRoll) return;
  unlockAudio();
  canRoll = false;
  socket.emit("roll");
}
wheel.addEventListener("click", tryRoll);

// =========================================================
//  5席メニュー（七並べと同一の挙動・v3.8現物のまま）
// =========================================================
function renderSeats(state) {
  if (!seatsEl) return;
  seatsEl.innerHTML = "";

  for (let i = 0; i < MAX_SEATS; i++) {
    const p = state.players[i];   // null=空席
    const occupied = !!p;
    const isMine = occupied && p.id === myId;
    const isCurrent = state.started && !state.finished && state.currentTurn === i && occupied;

    const row = document.createElement("div");
    row.className = "seat";
    if (!occupied) row.classList.add("empty");
    if (isCurrent) {
      row.classList.add("current");
      row.style.borderColor = COLORS[i];
    }

    const badge = document.createElement("button");
    badge.className = "seatBadge";
    badge.textContent = "P" + (i + 1);
    badge.disabled = true;
    badge.style.opacity = "1";
    badge.style.background = occupied ? COLORS[i] : "#9bb4cc";
    row.appendChild(badge);

    const input = document.createElement("input");
    input.className = "seatName";
    input.type = "text";
    input.maxLength = 12;
    input.placeholder = "なまえ";
    if (occupied) {
      input.value = p.name;
      input.disabled = !isMine || state.started;
    } else {
      input.value = draftNames[i] || "";
      input.disabled = state.started || (mySeat >= 0);
    }
    input.addEventListener("input", (e) => { draftNames[i] = e.target.value; });
    row.appendChild(input);

    const iwaBtn = document.createElement("button");
    iwaBtn.className = "seatRouteBtn iwa";
    iwaBtn.textContent = "岩見沢";
    const oiwBtn = document.createElement("button");
    oiwBtn.className = "seatRouteBtn oiw";
    oiwBtn.textContent = "追分";

    if (occupied) {
      const rk = p.routeKey || "oiwake";
      if (rk === "iwamizawa") { iwaBtn.classList.add("selected"); grayOut(oiwBtn); }
      else { oiwBtn.classList.add("selected"); grayOut(iwaBtn); }
    } else {
      grayOut(iwaBtn);
      grayOut(oiwBtn);
    }

    const canClickEmpty = !occupied && mySeat < 0 && !state.started;
    const canClickMine  = isMine && !state.started;

    if (canClickEmpty || canClickMine) {
      ungray(iwaBtn); ungray(oiwBtn);
      if (occupied) {
        const rk = p.routeKey || "oiwake";
        if (rk === "iwamizawa") oiwBtn.classList.remove("selected"); else iwaBtn.classList.remove("selected");
      }
      iwaBtn.addEventListener("click", () => confirmSeat(i, "iwamizawa", input));
      oiwBtn.addEventListener("click", () => confirmSeat(i, "oiwake", input));
    } else {
      iwaBtn.disabled = true;
      oiwBtn.disabled = true;
    }

    row.appendChild(iwaBtn);
    row.appendChild(oiwBtn);

    const rank = document.createElement("span");
    rank.className = "seatRank";
    rank.dataset.seat = String(i);
    rank.textContent = (occupied && p.rank && p.rank > 0) ? (p.rank + "位") : "";
    row.appendChild(rank);

    seatsEl.appendChild(row);
  }
}

function grayOut(btn) {
  btn.style.background = "#9bb4cc";
  btn.style.opacity = ".7";
}
function ungray(btn) {
  btn.style.opacity = "1";
  btn.style.background = "";
}

function confirmSeat(seatIndex, routeKey, input) {
  unlockAudio();
  const name = (input.value || "").trim() || ("P" + (seatIndex + 1));
  draftNames[seatIndex] = name;
  socket.emit("joinSeat", { seat: seatIndex, name, routeKey });
}

// ===== ボタン =====
startBtn.addEventListener("click", () => {
  unlockAudio();
  startBtn.disabled = true; // v4.0：開始後すぐグレーアウト
  playSound("start");       // v4.0：ゲーム開始音 = start.wav
  socket.emit("start");
});
resetBtn.addEventListener("click", () => {
  unlockAudio();
  if (confirm("ゲームをリセットして最初に戻しますか？")) {
    stopAllSounds();       // v4.0：鳴っている音を止めて
    playSound("reset");    // reset.wav
    socket.emit("reset");
  }
});

socket.on("joined", (id) => { myId = id; mySeat = -1; });
socket.on("seated", ({ seat }) => { mySeat = seat; });
socket.on("rejected", (msg) => { if (statusEl) statusEl.textContent = msg; });

socket.on("resetReady", () => {
  draftNames = ["", "", "", "", ""];
  mySeat = -1;
  lastShownSeq = 0; animating = false; fanfaredIndexes = {}; currentRotation = 0;
  canRoll = false;
  wheel.style.transition = "none"; wheel.style.transform = "rotate(0deg)";
  setTimeout(() => { wheel.style.transition = ""; }, 50);
  myId = null;
  socket.disconnect();
  setTimeout(() => socket.connect(), 300);
});

let lastMyTurn = false;

socket.on("state", (state) => {
  routes = state.routes || routes;
  goals = state.goals || goals;
  commonStart = state.commonStart || commonStart;
  if (!state.started) { lastShownSeq = 0; animating = false; fanfaredIndexes = {}; }
  latestState = state;
  if (mySeat < 0) {
    const meIdx = state.players.findIndex((p) => p && p.id === myId);
    if (meIdx >= 0) mySeat = meIdx;
  }
  if (!state.started || state.finished) finalizeState(state);
  processNextMove();
});

function finalizeState(state) {
  renderSeats(state);
  renderBoard(positionsUpToShown());

  const allMovesShown = !state.moves || state.moves.length === 0 ||
    state.moves[state.moves.length - 1].seq === lastShownSeq;

  if (state.finished && allMovesShown && !animating) {
    if (statusEl) statusEl.textContent = "🏁 全員ゴール！ゲーム終了";
    startBtn.disabled = true; canRoll = false;
    lastMyTurn = false;
    centerOnActivePlayer(true);
    return;
  }
  if (!state.started) {
    if (statusEl) statusEl.textContent = "名前を入れてルートを選び「ゲーム開始」を押してください";
    startBtn.disabled = false; canRoll = false;
    lastMyTurn = false;
    centerOnActivePlayer(false);
    return;
  }
  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  if (statusEl) statusEl.textContent = "";
  canRoll = !!myTurn && !animating;

  if (myTurn && !lastMyTurn && !animating) {
    playSound("yourTurn"); // v4.0：自分の番 = your_turn.wav
  }
  lastMyTurn = !!myTurn;

  if (!animating) centerOnActivePlayer(true);
}
