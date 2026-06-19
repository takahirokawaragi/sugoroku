/* =========================================================
   すごろくゲーム  client.js
   バージョン: v3.5
   日付: 2026-06-19（金）14:26 JST
   v3.5での変更点:
     - 盤面を絶対座標キャンバス方式に全面変更。各駅に座標(x,y)を
       割り当て、添付路線図に近い「斜めに流れる一本道」に配置。
       栗山(右)を起点に、岩見沢方面は右上→左へ、追分方面は右下→左へ、
       白石で合流して小樽(左上)へ。座標は STATION_LAYOUT で定義。
     - 駅と駅の間を SVG の線(#rails)でつなぐ線路描画を追加（斜めもOK）。
     - 栗山(pos=0)は両ルート共通の1マスとして1つだけ描画。
       白石以降の共通区間も1マスだけ描画（従来踏襲）。
     - 画面追従を変更：自分の番だけでなく、いま動いているプレイヤー
       （ルーレットを回した人）のコマへ、全員の画面が追従する。
     - コマ置きスペースは index.html 側で電車1台分の高さに固定。
   v3.4: 栗山統合・L字配置（グリッド方式・本v3.5で置き換え）
   v3.1: 両ルート同時表示・コマ進行方向で自動反転
   v2.2: iPhone音復活・721系風電車・看板の見た目
   ※ server.js v3.5 / index.html v3.5 とセットで使うこと
   ========================================================= */

const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

const WHEEL_COLORS = [
  "#f4d000", "#f5a623", "#e8731c", "#e8231c", "#e6007e",
  "#9b3fb5", "#5b3fb5", "#1c9ee8", "#2e8b3f", "#8bc63f",
];

const ROUTE_NAMES = { oiwake: "追分経由", iwamizawa: "岩見沢経由" };

// ===== 駅の配置座標（添付路線図に近い斜めの一本道）=====
// グリッド的な「列(gx)・行(gy)」で大まかに置き、後でpx換算する。
// gx:右ほど大きい / gy:下ほど大きい。座標はざっくり（雰囲気重視）。
const CELL_DX = 96;  // 列間隔(px)
const CELL_DY = 92;  // 行間隔(px)
const MARGIN_X = 40;
const MARGIN_Y = 40;

// 岩見沢分岐(pos0..13): 栗山→栗丘→栗沢→志文→岩見沢→上幌向→幌向→豊幌→江別→高砂→野幌→大麻→森林公園→厚別
// 栗山を右側(gx=18,gy=6)に置き、上へ→左へ流す
const LAYOUT_IWAMIZAWA = [
  { gx: 18, gy: 6 },  // 0 栗山（共通起点）
  { gx: 18, gy: 5 },  // 1 栗丘
  { gx: 18, gy: 4 },  // 2 栗沢
  { gx: 18, gy: 3 },  // 3 志文
  { gx: 18, gy: 2 },  // 4 岩見沢（ここで左へ）
  { gx: 17, gy: 1 },  // 5 上幌向
  { gx: 16, gy: 1 },  // 6 幌向
  { gx: 15, gy: 2 },  // 7 豊幌
  { gx: 14, gy: 2 },  // 8 江別
  { gx: 13, gy: 2 },  // 9 高砂
  { gx: 13, gy: 3 },  // 10 野幌
  { gx: 13, gy: 4 },  // 11 大麻
  { gx: 12, gy: 5 },  // 12 森林公園
  { gx: 11, gy: 5 },  // 13 厚別（次が白石）
];

// 追分分岐(pos0..20): 栗山→由仁→古山→三川→追分→安平→早来→遠浅→沼ノ端→植苗→南千歳→千歳→長都→サッポロビール庭園→恵庭→恵み野→島松→北広島→上野幌→新札幌→平和
// 栗山から下へ→左へ流す
const LAYOUT_OIWAKE = [
  { gx: 18, gy: 6 },  // 0 栗山（共通起点・iwamizawaと同じ座標）
  { gx: 18, gy: 7 },  // 1 由仁
  { gx: 18, gy: 8 },  // 2 古山
  { gx: 18, gy: 9 },  // 3 三川
  { gx: 18, gy: 10 }, // 4 追分（ここで左へ）
  { gx: 17, gy: 11 }, // 5 安平
  { gx: 16, gy: 11 }, // 6 早来
  { gx: 15, gy: 12 }, // 7 遠浅
  { gx: 14, gy: 13 }, // 8 沼ノ端
  { gx: 13, gy: 13 }, // 9 植苗
  { gx: 13, gy: 12 }, // 10 南千歳
  { gx: 13, gy: 11 }, // 11 千歳
  { gx: 13, gy: 10 }, // 12 長都
  { gx: 13, gy: 9 },  // 13 サッポロビール庭園
  { gx: 13, gy: 8 },  // 14 恵庭
  { gx: 13, gy: 7 },  // 15 恵み野
  { gx: 13, gy: 6 },  // 16 島松
  { gx: 12, gy: 6 },  // 17 北広島
  { gx: 11, gy: 6 },  // 18 上野幌
  { gx: 11, gy: 5.5 },// 19 新札幌（厚別の少し下）
  { gx: 11, gy: 5 },  // 20 平和（厚別と同じ列・次が白石）
];

// 共通区間(白石〜小樽): 白石→苗穂→札幌→桑園→琴似→発寒中央→発寒→稲積公園→手稲→稲穂→星置→ほしみ→銭函→朝里→小樽築港→南小樽→小樽
// 厚別/平和の左隣(白石)から、左上へ斜めに上がって小樽へ
const LAYOUT_COMMON = [
  { gx: 10, gy: 4 },  // 0 白石（合流）
  { gx: 9,  gy: 4 },  // 1 苗穂
  { gx: 8,  gy: 4 },  // 2 札幌
  { gx: 8,  gy: 3 },  // 3 桑園
  { gx: 7,  gy: 3 },  // 4 琴似
  { gx: 6,  gy: 4 },  // 5 発寒中央
  { gx: 6,  gy: 3 },  // 6 発寒
  { gx: 5,  gy: 3 },  // 7 稲積公園
  { gx: 4,  gy: 2 },  // 8 手稲
  { gx: 3,  gy: 2 },  // 9 稲穂
  { gx: 3,  gy: 1 },  // 10 星置
  { gx: 2,  gy: 1 },  // 11 ほしみ
  { gx: 1,  gy: 1 },  // 12 銭函
  { gx: 1,  gy: 0.5 },// 13 朝里（少し上）
  { gx: 1,  gy: 0 },  // 14 小樽築港
  { gx: 0,  gy: -0.5 },// 15 南小樽
  { gx: 0,  gy: -1.5 },// 16 小樽（ゴール）
];

function gridToPx(g) {
  // gx,gy を画面座標へ。gx は右ほど大、画面では右に行くほど left 大。
  return {
    left: MARGIN_X + g.gx * CELL_DX,
    top:  MARGIN_Y + (g.gy + 2) * CELL_DY, // gyに+2して上の余白を確保
  };
}

let myId = null;
let routes = { oiwake: [], iwamizawa: [] };
let goals = { oiwake: 0, iwamizawa: 0 };
let commonStart = { oiwake: 0, iwamizawa: 0 };
let currentRotation = 0;

let fanfaredIndexes = {};
let lastShownSeq = 0;
let animating = false;
let latestState = null;

const boardEl = document.getElementById("board");
const railsEl = document.getElementById("rails");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const resultEl = document.getElementById("result");
const startBtn = document.getElementById("startBtn");
const rollBtn = document.getElementById("rollBtn");
const resetBtn = document.getElementById("resetBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");
const routeOiwakeBtn = document.getElementById("routeOiwakeBtn");
const routeIwamizawaBtn = document.getElementById("routeIwamizawaBtn");
const routeLabel = document.getElementById("routeLabel");
const routeArea = document.getElementById("routeArea");
const boardScrollEl = document.querySelector(".boardScroll");

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

// ===== ルーレット描画 =====
function drawWheel() {
  const size = wheel.width;
  const r = size / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#ccc"; ctx.stroke();
  const outerR = r - 6;
  const innerR = r * 0.42;
  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * seg - Math.PI / 2;
    const end = (i + 1) * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(r, r, outerR, start, end);
    ctx.arc(r, r, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.35)";
    const textR = (outerR + innerR) / 2;
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(String(i + 1), 0, -textR + 4);
    ctx.fillText(String(i + 1), 0, -textR + 4);
    ctx.restore();
  }
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

// ===== レイアウト：各ルートの pos -> 座標 =====
function layoutFor(routeKey) {
  const csI = commonStart.iwamizawa;
  const csO = commonStart.oiwake;
  const branch = routeKey === "iwamizawa" ? LAYOUT_IWAMIZAWA : LAYOUT_OIWAKE;
  const cs = routeKey === "iwamizawa" ? csI : csO;
  const arr = [];
  // 分岐部分
  for (let pos = 0; pos < cs; pos++) {
    arr.push({ pos, g: branch[pos] });
  }
  // 共通区間
  for (let j = 0; j < LAYOUT_COMMON.length; j++) {
    arr.push({ pos: cs + j, g: LAYOUT_COMMON[j], common: true });
  }
  return arr;
}

// 進行方向（左へ進むか右へ進むか）で電車の向きを決める
function dirOf(routeKey, pos) {
  const lay = layoutFor(routeKey);
  const cur = lay.find((x) => x.pos === pos);
  const prev = lay.find((x) => x.pos === pos - 1);
  if (!cur || !prev) return "L";
  return (cur.g.gx <= prev.g.gx) ? "L" : "R";
}

// 現在の各プレイヤー位置（lastShownSeqまで反映）
function positionsUpToShown() {
  const pos = {};
  latestState.players.forEach((p, i) => { pos[i] = 0; });
  const moves = latestState.moves || [];
  moves.forEach((m) => { if (m.seq <= lastShownSeq) pos[m.index] = m.to; });
  return pos;
}

// ===== 盤面描画 =====
let cellMap = {};

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

function makeCell(routeKey, item) {
  const cell = document.createElement("div");
  cell.className = "cell";
  const px = gridToPx(item.g);
  cell.style.left = px.left + "px";
  cell.style.top = px.top + "px";
  const st = stationOf(routeKey, item.pos);
  if (item.pos === 0) cell.classList.add("start");
  const goal = goals[routeKey];
  const isGoal = item.common && item.pos === goal;
  if (isGoal) cell.classList.add("goal");
  if (st.kanji.length >= 6) cell.classList.add("longName");

  cell.appendChild(buildSign(routeKey, item.pos));

  if (item.pos === 0) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "START"; cell.appendChild(tag);
  } else if (isGoal) {
    const tag = document.createElement("div"); tag.className = "stTag"; tag.textContent = "GOAL"; cell.appendChild(tag);
  }

  const pawns = document.createElement("div");
  pawns.className = "pawns";
  cell.appendChild(pawns);
  return cell;
}

function makeTrain(colorIndex, name, dir) {
  const wrap = document.createElement("div");
  wrap.className = "pawnWrap";
  const train = document.createElement("div");
  train.className = "train";
  if (dir === "L") train.classList.add("flip");
  train.style.setProperty("--bandColor", COLORS[colorIndex]);
  train.innerHTML =
    '<div class="trainBody">' +
      '<div class="trainRoof"></div>' +
      '<div class="trainWindows">' +
        '<span class="door"></span><span></span><span></span><span></span>' +
        '<span class="door"></span><span class="cab"></span>' +
      '</div>' +
      '<div class="trainBand"></div>' +
    '</div>' +
    '<div class="trainSkirt"></div>' +
    '<div class="trainWheels"><i></i><i></i><i></i><i></i></div>';
  const nm = document.createElement("div");
  nm.className = "pawnName"; nm.textContent = name;
  wrap.appendChild(train); wrap.appendChild(nm);
  return wrap;
}

// 盤面全体のサイズを座標から算出して #board に設定
function sizeBoard() {
  let maxL = 0, maxT = 0;
  const all = [
    ...LAYOUT_IWAMIZAWA, ...LAYOUT_OIWAKE, ...LAYOUT_COMMON,
  ];
  all.forEach((g) => {
    const px = gridToPx(g);
    if (px.left > maxL) maxL = px.left;
    if (px.top > maxT) maxT = px.top;
  });
  const w = maxL + 84 + MARGIN_X;
  const h = maxT + 120 + MARGIN_Y;
  boardEl.style.width = w + "px";
  boardEl.style.height = h + "px";
  railsEl.setAttribute("width", w);
  railsEl.setAttribute("height", h);
  railsEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  return { w, h };
}

// セル中心の座標（線路を結ぶ用）
function cellCenter(g) {
  const px = gridToPx(g);
  return { x: px.left + 42, y: px.top + 50 };
}

// 線路を SVG で描画（各ルートの隣り合う駅を線で結ぶ。斜めもOK）
function drawRails() {
  while (railsEl.firstChild) railsEl.removeChild(railsEl.firstChild);
  const drawnSeg = {}; // 重複線（共通区間）を防ぐ

  ["iwamizawa", "oiwake"].forEach((rk) => {
    const lay = layoutFor(rk);
    for (let i = 0; i < lay.length - 1; i++) {
      const a = cellCenter(lay[i].g);
      const b = cellCenter(lay[i + 1].g);
      const key = [Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)].join(",");
      if (drawnSeg[key]) continue;
      drawnSeg[key] = true;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", "#9aa6b2");
      line.setAttribute("stroke-width", "6");
      line.setAttribute("stroke-linecap", "round");
      railsEl.appendChild(line);
    }
  });
}

function renderBoard(positions, override) {
  // 既存の駅セルを削除（railsは残す）
  Array.from(boardEl.querySelectorAll(".cell")).forEach((el) => el.remove());
  cellMap = {};

  sizeBoard();
  drawRails();

  const drawnByXY = {}; // "left,top" -> cell（栗山・共通区間の重複描画防止）

  ["iwamizawa", "oiwake"].forEach((rk) => {
    const lay = layoutFor(rk);
    lay.forEach((item) => {
      const isShared = item.pos === 0 || item.common;
      const px = gridToPx(item.g);
      const xykey = px.left + "," + px.top;
      if (isShared && drawnByXY[xykey]) {
        cellMap[rk + ":" + item.pos] = drawnByXY[xykey];
        return;
      }
      const cell = makeCell(rk, item);
      boardEl.appendChild(cell);
      if (isShared) drawnByXY[xykey] = cell;
      cellMap[rk + ":" + item.pos] = cell;
    });
  });

  latestState.players.forEach((p, idx) => {
    let pos = positions[idx];
    if (override && override.idx === idx) pos = override.pos;
    const rk = p.routeKey || "oiwake";
    const dir = dirOf(rk, pos);
    const cell = cellMap[rk + ":" + pos];
    if (!cell) return;
    const pawnsEl = cell.querySelector(".pawns");
    if (pawnsEl) pawnsEl.appendChild(makeTrain(idx, p.name, dir));
  });
}

// 指定プレイヤーのコマへ画面を寄せる（全員の画面で動いている人を追う）
function scrollToPawn(playerIndex, pos) {
  const rk = latestState.players[playerIndex].routeKey || "oiwake";
  const cell = cellMap[rk + ":" + pos];
  if (cell && cell.scrollIntoView) {
    cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
}

function animateSteps(playerIndex, from, to, onDone) {
  let current = from;
  const stepOnce = () => {
    if (current >= to) { if (onDone) onDone(); return; }
    current += 1;
    renderBoard(positionsUpToShown(), { idx: playerIndex, pos: current });
    stepSound();
    scrollToPawn(playerIndex, current); // 動いている人を全員が追う
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
  rollBtn.disabled = true;
  const rk = latestState.players[next.index].routeKey || "oiwake";
  statusEl.textContent = next.name + " がルーレットを回しています...";
  renderBoard(positionsUpToShown(), { idx: next.index, pos: next.from });
  scrollToPawn(next.index, next.from); // 回す前にその人へ寄せる

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

// ===== ボタン =====
nameBtn.addEventListener("click", () => {
  clickSound("name");
  const name = nameInput.value.trim();
  if (name) socket.emit("setName", name);
});
routeOiwakeBtn.addEventListener("click", () => { clickSound("route"); socket.emit("setRoute", "oiwake"); });
routeIwamizawaBtn.addEventListener("click", () => { clickSound("route"); socket.emit("setRoute", "iwamizawa"); });
startBtn.addEventListener("click", () => { clickSound("start"); socket.emit("start"); });
rollBtn.addEventListener("click", () => { unlockAudio(); rollBtn.disabled = true; socket.emit("roll"); });
resetBtn.addEventListener("click", () => {
  clickSound("reset");
  if (confirm("ゲームをリセットして最初に戻しますか？")) socket.emit("reset");
});

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => { statusEl.textContent = msg; startBtn.disabled = true; rollBtn.disabled = true; });

socket.on("resetReady", () => {
  nameInput.value = "";
  lastShownSeq = 0; animating = false; fanfaredIndexes = {}; currentRotation = 0;
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
    startBtn.disabled = true; rollBtn.disabled = true;
    showResult(state);
    return;
  }
  if (!state.started) {
    statusEl.textContent = "ルートと名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false; rollBtn.disabled = true;
    resultEl.classList.remove("show");
    return;
  }
  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn ? "あなたの番です！ルーレットを回してください"
    : (current ? current.name + " の番です..." : "");
  rollBtn.disabled = !myTurn || animating;

  // 待機中も、現在の手番のプレイヤーへ画面を寄せる（全員）
  if (current) {
    const idx = state.players.findIndex((p) => p.id === current.id);
    if (idx >= 0) scrollToPawn(idx, state.players[idx].pos);
  }
}

function showResult(state) {
  if (!state.finished) { resultEl.classList.remove("show"); return; }
  const ranked = [...state.players].filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.innerHTML = "<h2>🏁 結果</h2>" +
    ranked.map((p) => `${p.rank}位：${p.name}（${ROUTE_NAMES[p.routeKey || "oiwake"]}）`).join("<br>");
  resultEl.classList.add("show");
}
