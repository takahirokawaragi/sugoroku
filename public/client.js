/* =========================================================
   すごろくゲーム  client.js
   バージョン: v3.7.1
   日付: 2026-06-21（日）06:26 JST
   v3.7.1での変更点:
     - 左メニューを「元のすごろく式」に差し戻し（A案）：
       ・P1〜P5バッジは常時グレーアウトの飾り（席ロックなし）。
       ・5つの名前入力欄はどこでも入力可（自席ロックを廃止）。
       ・各行に岩見沢/追分ボタンを残し、名前を入れて押すと確定。
     - 追分ボタンの横に着順「1位〜5位」を表示（.seatRank）。
       サーバーの p.rank を使用。未ゴールは空欄。
     - 統一プレイヤーカラーを七並べと完全一致に変更：
       P1 #e53935 / P2 #1e88e5 / P3 #43a047 /
       P4 #fb8c00 / P5 #8e24aa（全ゲーム共通）。
     - タイトル「オンライン鉄道すごろく」を七並べと同一デザインに
       （ヒラギノ角ゴW9＋レインボーグラデ＋縁取り）。CSSは index.html 側。
     - 音をビープ合成から mp3/wav 再生へ切替（public/sounds/）。
       手番=yourTurn / ボタン=button / ルーレット=roll / ゴール=goal。
       ファイル未配置・再生失敗時は無音で続行。
     - 盤面 MARGIN を 1100→1800 へ拡大。小樽（左上端）到達時も
       コマが画面の上下左右中央へ来るよう余白を確保。
     - ルーレット右上フロート・直径50vh、盤面・コマ・座標は v3.6.6 を維持。
     - server.js は変更不要。
   --- 以下 過去履歴 ---
   v3.7.0: 左メニューを七並べ式5席に刷新・ルーレット右上分離・タイトルバナー固定
   v3.6.6: 沼ノ端を最下段へ・合流末尾を白石下側に配置し平和付近の重なり解消
   v3.6.5: 追分経由の北上区間を縦一直線化
   v3.6.3: 駅座標を白石中心の三差路で全面再設計
   v3.6.0: 盤面を背景路線図(SVG)＋駅マス絶対配置方式に変更
   v3.5.2: 721系コマ作り直し・赤青丸廃止し横帯で識別・名前全表示
   ※ server.js v3.5 / index.html v3.7.1 とセットで使うこと
   ========================================================= */

const socket = io();
// 統一プレイヤーカラー（全ゲーム共通・七並べと一致）
const COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa"];
const SEGMENTS = 10;
const MAX_SEATS = 5;

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

// 5席ぶんの下書き名前（席ロックなし＝どこでも入力可）
let draftNames = ["", "", "", "", ""];

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
//  pos は server.js の配列インデックスと一致
// =========================================================
// v3.7.1: 小樽（左上端）到達時もコマを画面中央へ置けるよう余白拡大
const MARGIN = 1800;

// 白石の RAW 基準座標
const SHI_X = 3400;
const SHI_Y = 1400;

// --- 共通区間（白石〜小樽: 左上がり一直線・駅間ゆったり）---
const COMMON_COUNT = 17;
const COMMON_STEP_X = 250;
const COMMON_STEP_Y = 60;
const RAW_COMMON = (function () {
  const arr = [];
  for (let i = 0; i < COMMON_COUNT; i++) {
    arr.push({ x: SHI_X - COMMON_STEP_X * i, y: SHI_Y - COMMON_STEP_Y * i });
  }
  return arr; // [0]=白石 ... [16]=小樽
})();

// --- 岩見沢経由 分岐（pos 0〜13: 栗山〜厚別）---
const RAW_IWAMIZAWA_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山
  { x: SHI_X + 1850, y: SHI_Y - 430 },  // 1 栗丘
  { x: SHI_X + 1850, y: SHI_Y - 610 },  // 2 栗沢
  { x: SHI_X + 1850, y: SHI_Y - 790 },  // 3 志文
  { x: SHI_X + 1850, y: SHI_Y - 970 },  // 4 岩見沢
  { x: SHI_X + 1600, y: SHI_Y - 970 },  // 5 上幌向
  { x: SHI_X + 1360, y: SHI_Y - 940 },  // 6 幌向
  { x: SHI_X + 1140, y: SHI_Y - 870 },  // 7 豊幌
  { x: SHI_X + 940,  y: SHI_Y - 780 },  // 8 江別
  { x: SHI_X + 760,  y: SHI_Y - 690 },  // 9 高砂
  { x: SHI_X + 600,  y: SHI_Y - 590 },  // 10 野幌
  { x: SHI_X + 450,  y: SHI_Y - 490 },  // 11 大麻
  { x: SHI_X + 310,  y: SHI_Y - 380 },  // 12 森林公園
  { x: SHI_X + 180,  y: SHI_Y - 260 },  // 13 厚別
];

// --- 追分経由 分岐（pos 0〜20: 栗山〜平和）---
const RAW_OIWAKE_BRANCH = [
  { x: SHI_X + 1850, y: SHI_Y - 250 },  // 0 栗山（岩見沢経由と同地点）
  { x: SHI_X + 1980, y: SHI_Y - 80 },   // 1 由仁
  { x: SHI_X + 2060, y: SHI_Y + 100 },  // 2 古山
  { x: SHI_X + 2090, y: SHI_Y + 320 },  // 3 三川
  { x: SHI_X + 2090, y: SHI_Y + 560 },  // 4 追分
  { x: SHI_X + 1870, y: SHI_Y + 760 },  // 5 安平
  { x: SHI_X + 1630, y: SHI_Y + 960 },  // 6 早来
  { x: SHI_X + 1400, y: SHI_Y + 1150 }, // 7 遠浅
  { x: SHI_X + 1180, y: SHI_Y + 1300 }, // 8 沼ノ端
  { x: SHI_X + 1180, y: SHI_Y + 1080 }, // 9 植苗
  { x: SHI_X + 1180, y: SHI_Y + 900 },  // 10 南千歳
  { x: SHI_X + 1180, y: SHI_Y + 740 },  // 11 千歳
  { x: SHI_X + 1180, y: SHI_Y + 580 },  // 12 長都
  { x: SHI_X + 1180, y: SHI_Y + 420 },  // 13 サッポロビール庭園
  { x: SHI_X + 1180, y: SHI_Y + 260 },  // 14 恵庭
  { x: SHI_X + 1180, y: SHI_Y + 100 },  // 15 恵み野
  { x: SHI_X + 1180, y: SHI_Y - 60 },   // 16 島松
  { x: SHI_X + 1180, y: SHI_Y - 220 },  // 17 北広島
  { x: SHI_X + 880,  y: SHI_Y + 120 },  // 18 上野幌
  { x: SHI_X + 560,  y: SHI_Y + 280 },  // 19 新札幌
  { x: SHI_X + 240,  y: SHI_Y + 360 },  // 20 平和
];

// 全 RAW 座標を正の領域へ収め、MARGIN を加える
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

// ===== ルーレットを右上フロート・直径=縦幅50%（描画/動きは無変更）=====
// canvas 内部解像度は 360px のまま。表示サイズだけ 50vh にスケール。
(function setupWheel() {
  if (!wheel) return;
  wheel.width = 360;
  wheel.height = 360;
  wheel.style.cursor = "pointer";
  applyWheelSize();
})();

function applyWheelSize() {
  if (!wheel) return;
  const d = Math.round(window.innerHeight * 0.5); // 直径＝縦幅の1/2
  wheel.style.width = d + "px";
  wheel.style.height = d + "px";
  const wrap = document.getElementById("rouletteWrap");
  if (wrap) {
    wrap.style.width = d + "px";
    // ポインタ(三角)の高さぶん少し足す
    wrap.style.height = (d + 18) + "px";
  }
}
window.addEventListener("resize", applyWheelSize);

// =========================================================
//  音（mp3/wav 再生・public/sounds/）
//  ファイル未配置や再生失敗時は無音で続行。
//  - yourTurn : 自分の手番が回ってきた時
//  - button   : 各ボタン押下
//  - roll     : ルーレット回転中
//  - goal     : ゴール
// =========================================================
const SOUND_FILES = {
  yourTurn: "/sounds/yourTurn.mp3",
  button: "/sounds/button.mp3",
  roll: "/sounds/roll.mp3",
  goal: "/sounds/goal.mp3",
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

// 初回のユーザー操作で音を解放（iOS/モバイル対策）
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
function stopSoundFx(key) {
  const a = audioCache[key];
  if (!a) return;
  try { a.pause(); a.currentTime = 0; } catch (e) {}
}

// ===== ルーレット描画（数字を帯の上下中央に揃える・変更なし）=====
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
  playSound("roll");
  const seg = 360 / SEGMENTS;
  const targetCenter = (dice - 1) * seg + seg / 2;
  const finalFacing = (360 - targetCenter) % 360;
  const currentFacing = ((currentRotation % 360) + 360) % 360;
  let delta = finalFacing - currentFacing;
  if (delta < 0) delta += 360;
  currentRotation += delta + 360 * 5;
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(() => { stopSoundFx("roll"); if (onStop) setTimeout(onStop, 400); }, 4000);
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

  const iwaTip = COORD_IWAMIZAWA_BRANCH[4];
  const oiwTip = COORD_OIWAKE_BRANCH[4];
  const comTip = COORD_COMMON[COMMON_COUNT - 1];
  svg += `<text x="${iwaTip.x + 120}" y="${iwaTip.y - 40}" font-size="44" fill="${COL_IWA}" font-weight="bold">岩見沢経由</text>`;
  svg += `<text x="${oiwTip.x + 120}" y="${oiwTip.y + 70}" font-size="44" fill="${COL_OIW}" font-weight="bold">追分経由</text>`;
  svg += `<text x="${comTip.x - 30}" y="${comTip.y - 80}" font-size="44" fill="${COL_COM}" font-weight="bold">函館本線</text>`;

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
  renderBoard(positionsUpToShown(), { idx: next.index, pos: next.from });
  centerOnCell(next.from, rk, true);

  spinTo(next.dice, () => {
    animateSteps(next.index, next.from, next.to, () => {
      lastShownSeq = next.seq;
      if (next.to >= goals[rk] && !fanfaredIndexes[next.index]) {
        fanfaredIndexes[next.index] = true;
        playSound("goal");
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

// =========================================================
//  5席メニュー（元のすごろく式・A案）
//   ・P1〜P5バッジは常時グレーアウトの飾り（席ロックなし）。
//   ・5つの名前欄はどこでも入力可。
//   ・各行の岩見沢/追分ボタンで、その席の名前＋ルートを確定。
//   ・追分ボタンの横に着順「1位〜5位」を表示（p.rank）。
// =========================================================
function renderSeats(state) {
  if (!seatsEl) return;
  seatsEl.innerHTML = "";

  for (let i = 0; i < MAX_SEATS; i++) {
    const p = state.players[i]; // 居なければ undefined（空席）
    const isOccupied = !!p;
    const isCurrent = state.started && !state.finished && state.currentTurn === i && isOccupied;

    const row = document.createElement("div");
    row.className = "seat";
    if (!isOccupied) row.classList.add("empty");
    if (isCurrent) {
      row.classList.add("current");
      row.style.borderColor = COLORS[i];
    }

    // カラーバッジ（常時グレーアウトの飾り＝ボタンだが押せない）
    const badge = document.createElement("button");
    badge.className = "seatBadge";
    badge.style.background = COLORS[i];
    badge.textContent = "P" + (i + 1);
    badge.disabled = true;
    row.appendChild(badge);

    // 名前入力欄（席ロックなし：どこでも入力可）
    const input = document.createElement("input");
    input.className = "seatName";
    input.type = "text";
    input.maxLength = 12;
    input.placeholder = "なまえ";
    if (isOccupied) {
      const confirmed = p.name && !/^Player\d+$/.test(p.name);
      input.value = confirmed ? p.name : (draftNames[i] || "");
      input.disabled = state.started; // 開始後は固定
    } else {
      input.value = draftNames[i] || "";
      input.disabled = state.started;
    }
    input.addEventListener("input", (e) => { draftNames[i] = e.target.value; });
    row.appendChild(input);

    // 岩見沢ボタン
    const iwaBtn = document.createElement("button");
    iwaBtn.className = "seatRouteBtn iwa";
    iwaBtn.textContent = "岩見沢";
    // 追分ボタン
    const oiwBtn = document.createElement("button");
    oiwBtn.className = "seatRouteBtn oiw";
    oiwBtn.textContent = "追分";

    // 選択状態（確定済みのルートをハイライト）
    if (isOccupied) {
      const rk = p.routeKey || "oiwake";
      if (rk === "iwamizawa") iwaBtn.classList.add("selected");
      else oiwBtn.classList.add("selected");
    }

    if (!state.started) {
      iwaBtn.addEventListener("click", () => confirmSeat(i, "iwamizawa", input));
      oiwBtn.addEventListener("click", () => confirmSeat(i, "oiwake", input));
    } else {
      iwaBtn.disabled = true;
      oiwBtn.disabled = true;
    }
    row.appendChild(iwaBtn);
    row.appendChild(oiwBtn);

    // 追分ボタンの横に着順「1位〜5位」（未ゴールは空欄）
    const rank = document.createElement("span");
    rank.className = "seatRank";
    rank.dataset.seat = String(i);
    if (isOccupied && p.rank && p.rank > 0) {
      rank.textContent = p.rank + "位";
    } else {
      rank.textContent = "";
    }
    row.appendChild(rank);

    seatsEl.appendChild(row);
  }
}

// 名前を確定→ルートを確定（その席のルートボタンで両方送る）
function confirmSeat(seatIndex, routeKey, input) {
  unlockAudio();
  playSound("button");
  const name = (input.value || "").trim();
  if (name) {
    draftNames[seatIndex] = name;
    socket.emit("setName", name);
  }
  socket.emit("setRoute", routeKey);
}

// ===== ボタン =====
startBtn.addEventListener("click", () => { unlockAudio(); playSound("button"); socket.emit("start"); });
resetBtn.addEventListener("click", () => {
  unlockAudio();
  playSound("button");
  if (confirm("ゲームをリセットして最初に戻しますか？")) socket.emit("reset");
});

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => { statusEl.textContent = msg; startBtn.disabled = true; canRoll = false; });

socket.on("resetReady", () => {
  draftNames = ["", "", "", "", ""];
  lastShownSeq = 0; animating = false; fanfaredIndexes = {}; currentRotation = 0;
  canRoll = false;
  wheel.style.transition = "none"; wheel.style.transform = "rotate(0deg)";
  setTimeout(() => { wheel.style.transition = ""; }, 50);
  resultEl.classList.remove("show");
  myId = null;
  socket.disconnect();
  setTimeout(() => socket.connect(), 300);
});

// 自分の手番が回ってきた瞬間に1回だけ鳴らすための記録
let lastMyTurn = false;

socket.on("state", (state) => {
  routes = state.routes || routes;
  goals = state.goals || goals;
  commonStart = state.commonStart || commonStart;
  if (!state.started) { lastShownSeq = 0; animating = false; fanfaredIndexes = {}; }
  latestState = state;
  if (!state.started || state.finished) finalizeState(state);
  processNextMove();
});

function finalizeState(state) {
  renderSeats(state);
  renderBoard(positionsUpToShown());

  if (playersEl) {
    playersEl.innerHTML = state.players
      .map((p, idx) => {
        const rk = p.routeKey || "oiwake";
        const st = stationOf(rk, p.pos);
        return `<span style="color:${COLORS[idx]}">●</span>${p.name}（${ROUTE_NAMES[rk]}・${st.kanji}）`;
      })
      .join("　");
  }

  const allMovesShown = !state.moves || state.moves.length === 0 ||
    state.moves[state.moves.length - 1].seq === lastShownSeq;

  if (state.finished && allMovesShown && !animating) {
    if (statusEl) statusEl.textContent = "🏁 全員ゴール（小樽）！ゲーム終了";
    startBtn.disabled = true; canRoll = false;
    lastMyTurn = false;
    showResult(state);
    centerOnActivePlayer(true);
    return;
  }
  if (!state.started) {
    if (statusEl) statusEl.textContent = "名前を入れてルートを選び「ゲーム開始」を押してください";
    startBtn.disabled = false; canRoll = false;
    lastMyTurn = false;
    resultEl.classList.remove("show");
    centerOnActivePlayer(false);
    return;
  }
  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  if (statusEl) statusEl.textContent = "";
  canRoll = !!myTurn && !animating;

  // 自分の手番が新たに回ってきた時だけ yourTurn を鳴らす
  if (myTurn && !lastMyTurn && !animating) {
    playSound("yourTurn");
  }
  lastMyTurn = !!myTurn;

  if (!animating) centerOnActivePlayer(true);
}

function showResult(state) {
  if (!state.finished) { resultEl.classList.remove("show"); return; }
  const ranked = [...state.players].filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.innerHTML = "<h2>🏁 結果</h2>" +
    ranked.map((p) => `${p.rank}位：${p.name}（${ROUTE_NAMES[p.routeKey || "oiwake"]}）`).join("<br>");
  resultEl.classList.add("show");
}
