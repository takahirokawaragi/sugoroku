/* =========================================================
   すごろくゲーム  client.js
   バージョン: v4.2
   日付: 2026-06-21（日）22:20 JST
   土台: v4.1 client.js（=現物 v3.8 ベース）
   v4.2での変更点:
     1) 手番枠・「あなたの番」音・順位表示を、moves再生(アニメ)が
        すべて終わってから反映するよう統一（サーバーが先に手番を進める
        ため起きていた「枠ずれ・番の音抜け・順位前後」を解消）。
     2) ゲーム開始ボタンは押下で即グレーアウトし、その後 state が
        来ても戻さない（iStartedPressed フラグで保持）。
     3) 開始音(start.wav)→あなたの番(your_turn.wav)の順で鳴らす
        （start直後はyour_turnを1.4秒抑制）。
     4) コース決定(confirmSeat)で button.mp3 を鳴らす。
     5) ルーレット音(roll.mp3)の途切れを軽減（多重Audioプール方式）。
     6) v4.1の機能（栗山1枚化・栗丘/由仁の距離拡大・移動音train・
        駅一覧/順位表示の撤去・goal+gameover/rank出し分け）は維持。
     ※ 看板/コマ/ルーレット描画・座標骨格・席UIは現物のまま。
     ※ server.js v3.8 / index.html v4.2 とセット。
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

// v4.2: 開始ボタン保持／番の音抑制
let iStartedPressed = false;
let suppressYourTurnUntil = 0;

const boardEl = document.getElementById("board");
const boardScrollEl = document.querySelector(".boardScroll");
const seatsEl = document.getElementById("seats");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const resultEl = document.getElementById("result");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");

// =========================================================
//  駅座標テーブル（白石中心の三差路・広域図準拠）
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

// v4.1/v4.2: 栗山(index0)は共有。栗丘(index1)を上へ離す
const RAW_IWAMIZAWA_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山（共有起点）
  { x: SHI_X + 1850, y: SHI_Y - 610 },  // 1 栗丘（上へ離す）
  { x: SHI_X + 1850, y: SHI_Y - 790 },  // 2 栗沢
  { x: SHI_X + 1850, y: SHI_Y - 970 },  // 3 志文
  { x: SHI_X + 1850, y: SHI_Y - 1150 }, // 4 岩見沢
  { x: SHI_X + 1600, y: SHI_Y - 1150 }, // 5 上幌向
  { x: SHI_X + 1360, y: SHI_Y - 1120 }, // 6 幌向
  { x: SHI_X + 1140, y: SHI_Y - 1050 }, // 7 豊幌
  { x: SHI_X + 940,  y: SHI_Y - 960 },  // 8 江別
  { x: SHI_X + 760,  y: SHI_Y - 870 },  // 9 高砂
  { x: SHI_X + 600,  y: SHI_Y - 770 },  // 10 野幌
  { x: SHI_X + 450,  y: SHI_Y - 670 },  // 11 大麻
  { x: SHI_X + 310,  y: SHI_Y - 560 },  // 12 森林公園
  { x: SHI_X + 180,  y: SHI_Y - 440 },  // 13 厚別
];

// v4.1/v4.2: 栗山(index0)は共有。由仁(index1)を右下へ離す
const RAW_OIWAKE_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山（共有起点・岩見沢index0と同一）
  { x: SHI_X + 2130, y: SHI_Y + 40 },   // 1 由仁（右下へ離す）
  { x: SHI_X + 2210, y: SHI_Y + 250 },  // 2 古山
  { x: SHI_X + 2240, y: SHI_Y + 480 },  // 3 三川
  { x: SHI_X + 2240, y: SHI_Y + 720 },  // 4 追分
  { x: SHI_X + 2020, y: SHI_Y + 920 },  // 5 安平
  { x: SHI_X + 1780, y: SHI_Y + 1120 }, // 6 早来
  { x: SHI_X + 1550, y: SHI_Y + 1310 }, // 7 遠浅
  { x: SHI_X + 1330, y: SHI_Y + 1460 }, // 8 沼ノ端
  { x: SHI_X + 1330, y: SHI_Y + 1240 }, // 9 植苗
  { x: SHI_X + 1330, y: SHI_Y + 1060 }, // 10 南千歳
  { x: SHI_X + 1330, y: SHI_Y + 900 },  // 11 千歳
  { x: SHI_X + 1330, y: SHI_Y + 740 },  // 12 長都
  { x: SHI_X + 1330, y: SHI_Y + 580 },  // 13 サッポロビール庭園
  { x: SHI_X + 1330, y: SHI_Y + 420 },  // 14 恵庭
  { x: SHI_X + 1330, y: SHI_Y + 260 },  // 15 恵み野
  { x: SHI_X + 1330, y: SHI_Y + 100 },  // 16 島松
  { x: SHI_X + 1330, y: SHI_Y - 60 },   // 17 北広島
  { x: SHI_X + 1030, y: SHI_Y + 260 },  // 18 上野幌
  { x: SHI_X + 710,  y: SHI_Y + 420 },  // 19 新札幌
  { x: SHI_X + 390,  y: SHI_Y + 500 },  // 20 平和
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
//  音（mp3/wav 再生・public/sounds/）
// =========================================================
const SOUND_FILES = {
  train: "/sounds/train.mp3",       // コマ移動
  yourTurn: "/sounds/your_turn.wav",// 自分の番
  start: "/sounds/start.wav",       // ゲーム開始
  reset: "/sounds/reset.wav",       // リセット
  rank: "/sounds/rank.mp3",         // 1〜4位ゴール
  goal: "/sounds/goal.mp3",         // 最後のゴール
  gameover: "/sounds/gameover.wav", // 最後のゴール（同時）
  button: "/sounds/button.mp3",     // コース決定・各ボタン
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

// v4.2: roll.mp3 はプール化して途切れを軽減
const ROLL_POOL_SIZE = 6;
const rollPool = [];
let rollPoolIdx = 0;
(function buildRollPool() {
  for (let i = 0; i < ROLL_POOL_SIZE; i++) {
    try {
      const a = new Audio(SOUND_FILES.roll || "/sounds/roll.mp3");
      a.preload = "auto";
      a.volume = 0.9;
      rollPool.push(a);
    } catch (e) { /* ignore */ }
  }
})();
// SOUND_FILES に roll を持たせておく（上の参照用）
SOUND_FILES.roll = "/sounds/roll.mp3";

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const all = Object.keys(audioCache).map((k) => audioCache[k]).concat(rollPool);
  all.forEach((a) => {
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

function playRollOnce() {
  const a = rollPool[rollPoolIdx % rollPool.length];
  rollPoolIdx++;
  if (!a) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

// ===== roll.mp3 をルーレット回転速度に合わせ連続再生（プール使用）=====
let rollTickTimer = null;
function startRollTicking() {
  let interval = 60;
  const tick = () => {
    playRollOnce();
    interval += 12;
    if (interval < 280) rollTickTimer = setTimeout(tick, interval);
  };
  tick();
}
function stopRollTicking() {
  if (rollTickTimer) { clearTimeout(rollTickTimer); rollTickTimer = null; }
}

// ===== ルーレット描画（現物のまま）=====
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

// ===== 背景路線図 SVG =====
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

// ===== 721系コマ（現物のまま）=====
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
      } else if (pos === 0) {
        const ckey = "KURIYAMA";
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
    playSound("train"); // コマ移動音=train.mp3
    renderBoard(positionsUpToShown(), { idx: playerIndex, pos: current });
    centerOnCell(current, rk, true);
    if (current >= to) { if (onDone) setTimeout(onDone, 300); return; }
    setTimeout(stepOnce, 350);
  };
  if (from === to) { if (onDone) onDone(); return; }
  stepOnce();
}

// v4.2: moves をすべて再生し終えたか
function allMovesShownNow() {
  const mv = (latestState && latestState.moves) || [];
  if (mv.length === 0) return true;
  return mv[mv.length - 1].seq === lastShownSeq;
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
        const finishedCount = latestState.players.filter(
          (pp) => pp && pp.rank && pp.rank > 0
        ).length;
        const activeCount = latestState.players.filter((pp) => !!pp).length;
        if (finishedCount >= activeCount) {
          playSound("goal");
          playSound("gameover");
        } else {
          playSound("rank");
        }
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
//  5席メニュー
// =========================================================
function renderSeats(state) {
  if (!seatsEl) return;
  seatsEl.innerHTML = "";

  // v4.2: アニメ再生が終わるまでは「見せている手番」を使う
  const shownTurn = displayedCurrentTurn(state);

  for (let i = 0; i < MAX_SEATS; i++) {
    const p = state.players[i];
    const occupied = !!p;
    const isMine = occupied && p.id === myId;
    const isCurrent = state.started && !state.finished && shownTurn === i && occupied;

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

    // v4.2: 順位はアニメ再生が全部終わってから表示
    const rank = document.createElement("span");
    rank.className = "seatRank";
    rank.dataset.seat = String(i);
    const showRank = allMovesShownNow() && occupied && p.rank && p.rank > 0;
    rank.textContent = showRank ? (p.rank + "位") : "";
    row.appendChild(rank);

    seatsEl.appendChild(row);
  }
}

// v4.2: 見せている手番（アニメ中はその move の人、終わっていれば本物のcurrentTurn）
function displayedCurrentTurn(state) {
  if (!state.started) return state.currentTurn;
  if (allMovesShownNow()) return state.currentTurn;
  // 未再生の次の move の人を「今の手番」として見せる
  const mv = state.moves || [];
  const next = mv.find((m) => m.seq === lastShownSeq + 1);
  if (next) return next.index;
  return state.currentTurn;
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
  playSound("button"); // v4.2: コース決定音=button.mp3
  const name = (input.value || "").trim() || ("P" + (seatIndex + 1));
  draftNames[seatIndex] = name;
  socket.emit("joinSeat", { seat: seatIndex, name, routeKey });
}

// ===== ボタン =====
startBtn.addEventListener("click", () => {
  unlockAudio();
  iStartedPressed = true;        // v4.2: 押した記録
  startBtn.disabled = true;      // v4.2: 即グレーアウト
  playSound("start");            // 開始音=start.wav
  suppressYourTurnUntil = Date.now() + 1400; // v4.2: 開始→番の順にする
  socket.emit("start");
});
resetBtn.addEventListener("click", () => {
  unlockAudio();
  playSound("reset");            // リセット音=reset.wav
  if (confirm("ゲームをリセットして最初に戻しますか？")) socket.emit("reset");
});

socket.on("joined", (id) => { myId = id; mySeat = -1; });
socket.on("seated", ({ seat }) => { mySeat = seat; });
socket.on("rejected", (msg) => { if (statusEl) statusEl.textContent = msg; });

socket.on("resetReady", () => {
  draftNames = ["", "", "", "", ""];
  mySeat = -1;
  lastShownSeq = 0; animating = false; fanfaredIndexes = {}; currentRotation = 0;
  canRoll = false;
  iStartedPressed = false;       // v4.2: 開始フラグ解除
  suppressYourTurnUntil = 0;
  wheel.style.transition = "none"; wheel.style.transform = "rotate(0deg)";
  setTimeout(() => { wheel.style.transition = ""; }, 50);
  resultEl.classList.remove("show");
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

  // v4.2: 駅一覧は出さない
  if (playersEl) playersEl.innerHTML = "";

  const movesDone = allMovesShownNow();

  if (state.finished && movesDone && !animating) {
    if (statusEl) statusEl.textContent = "🏁 全員ゴール！ゲーム終了";
    startBtn.disabled = true; canRoll = false;
    lastMyTurn = false;
    resultEl.classList.remove("show"); // 順位表示は出さない
    centerOnActivePlayer(true);
    return;
  }
  if (!state.started) {
    if (statusEl) statusEl.textContent = "名前を入れてルートを選び「ゲーム開始」を押してください";
    // v4.2: 自分が開始を押していたら、未開始stateが来ても戻さない
    startBtn.disabled = iStartedPressed ? true : false;
    canRoll = false;
    lastMyTurn = false;
    resultEl.classList.remove("show");
    centerOnActivePlayer(false);
    return;
  }
  startBtn.disabled = true;

  // v4.2: 手番の確定（音・canRoll）はアニメ再生が全部終わってから
  if (!movesDone || animating) {
    canRoll = false;
    return;
  }

  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  if (statusEl) statusEl.textContent = "";
  canRoll = !!myTurn;

  if (myTurn && !lastMyTurn) {
    // v4.2: 開始直後は start.wav 優先、少し遅らせて鳴らす
    const now = Date.now();
    if (now < suppressYourTurnUntil) {
      const wait = suppressYourTurnUntil - now;
      setTimeout(() => { playSound("yourTurn"); }, wait);
    } else {
      playSound("yourTurn");
    }
  }
  lastMyTurn = !!myTurn;

  centerOnActivePlayer(true);
}

// v4.2: 順位表示は無効化（要望により非表示）
function showResult() {
  if (resultEl) resultEl.classList.remove("show");
}

console.log("[sugoroku] client.js v4.2 ready (2026-06-21 22:20 JST)");
