/* =========================================================
   すごろくゲーム  client.js
   バージョン: v3.4
   日付: 2026-06-19（金）11:20 JST
   v3.4での変更点:
     - 栗山(pos=0)を「1つの共通スタートマス」に統合。
       両ルート(岩見沢経由/追分経由)が同じ栗山セルから始まり、
       栗山の直後から上下に分岐するようにした。
       （栗山も白石以降の共通区間と同様、同じ列なら1セルだけ描画）
     - 盤面をL字配置に変更（computeLayout を全面書き換え）。
       栗山を右端・中段に置き、栗山の隣から
         岩見沢ルート=上段を右→左へ横一直線
         追分ルート =下段を右→左へ横一直線
       とし、白石で上段の共通区間に合流して小樽(左端)へ。
       縦スクロールも併用する前提のレイアウト。
     - 駅数・ルート長・ゲームロジックは変更なし（server.js v3.1 のまま）。
   v3.3: 共通区間の並び順バグ修正
   v3.2: ルーレット画面固定・コマ追従
   v3.1: 両ルート同時表示（外周ループ）・コマ進行方向で自動反転
   v2.2: iPhone音復活・721系風電車・看板の見た目（緑帯・水色窓）
   ※ server.js v3.1 / index.html v3.2 とセットで使うこと
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

const boardEl = document.getElementById("board");
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

// =========================================================
//  L字配置のレイアウト座標を計算（v3.4）
//  - 栗山(pos=0)は両ルート共通の1マス。右端・中段に置く。
//  - 岩見沢ルート: 栗山の隣(左)から上段を右→左へ横一直線
//  - 追分ルート  : 栗山の隣(左)から下段を右→左へ横一直線
//  - 共通区間(白石〜小樽)は上段に合流して左へ続く
//
//  行(row)の割り当て:
//    UP_ROW   = 上段（岩見沢の分岐＋共通区間）
//    MID_ROW  = 中段（栗山だけ）
//    DOWN_ROW = 下段（追分の分岐）
//
//  列(col)は右ほど大きい数。栗山を一番右に置き、左へ進むほど小さくする。
// =========================================================
const UP_ROW = 1;   // 岩見沢ルート＋共通区間
const MID_ROW = 2;  // 栗山（分岐点）
const DOWN_ROW = 3; // 追分ルート

function computeLayout() {
  const result = { oiwake: [], iwamizawa: [] };

  const csI = commonStart.iwamizawa; // 岩見沢の分岐駅数（栗山〜厚別＝14）
  const csO = commonStart.oiwake;    // 追分の分岐駅数（栗山〜平和＝21）
  const commonLen = routes.iwamizawa.length - csI; // 共通区間の駅数（白石〜小樽）

  // 栗山(pos=0)を除いた分岐の駅数（栗山の隣から数える）
  const branchI = csI - 1; // 岩見沢: 栗丘〜厚別
  const branchO = csO - 1; // 追分  : 由仁〜平和

  // 上段の駅数 = 岩見沢分岐(栗山除く) + 共通区間
  // 下段の駅数 = 追分分岐(栗山除く)
  // 栗山は両段の右隣にある1列を占有する。
  // 上段が左へどこまで伸びるか / 下段が左へどこまで伸びるかで全幅が決まる。
  const upLen = branchI + commonLen;   // 上段に並ぶ駅数
  const downLen = branchO;             // 下段に並ぶ駅数
  const widest = Math.max(upLen, downLen);

  // 栗山の列（一番右）。左へ行くほど col が小さくなるよう、十分大きい値を起点にする。
  const KURIYAMA_COL = widest + 2;

  // --- 栗山（pos=0）: 両ルート共通、中段の右端 ---
  // 進行方向は左向き(L)
  result.iwamizawa.push({ pos: 0, row: MID_ROW, col: KURIYAMA_COL, dir: "L", kuriyama: true });
  result.oiwake.push({ pos: 0, row: MID_ROW, col: KURIYAMA_COL, dir: "L", kuriyama: true });

  // --- 岩見沢ルート: 栗山の左隣(上段)から栗丘→…→厚別、続けて白石→…→小樽 ---
  // 上段の右端列 = 栗山の1つ左
  const upRightCol = KURIYAMA_COL - 1;
  for (let k = 0; k < upLen; k++) {
    // pos は 1(栗丘) から。upLen 個ぶん連続して上段へ。
    const pos = k + 1;
    const col = upRightCol - k; // 右→左
    const isCommon = pos >= csI; // 白石以降は共通区間
    result.iwamizawa.push({ pos, row: UP_ROW, col, dir: "L", common: isCommon });
  }

  // --- 追分ルート: 栗山の左隣(下段)から由仁→…→平和 ---
  const downRightCol = KURIYAMA_COL - 1;
  for (let k = 0; k < branchO; k++) {
    const pos = k + 1; // 1(由仁)〜branchO(平和)
    const col = downRightCol - k; // 右→左
    result.oiwake.push({ pos, row: DOWN_ROW, col, dir: "L" });
  }

  // --- 追分ルートの共通区間(白石〜小樽): 上段の岩見沢と同じ列に重ねる ---
  // 岩見沢側で白石が置かれた列に合わせ、追分の共通区間も同じ上段セルへマッピングする。
  // 岩見沢の白石は pos=csI、列は upRightCol-(csI-1)。
  const shiroishiCol = upRightCol - (csI - 1);
  for (let j = 0; j < commonLen; j++) {
    const posO = csO + j; // 追分での共通区間の pos（白石〜小樽）
    const col = shiroishiCol - j; // 右→左（岩見沢と完全に同じ列）
    result.oiwake.push({ pos: posO, row: UP_ROW, col, dir: "L", common: true });
  }

  return result;
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
let layout = null;
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
  cell.style.gridRow = String(item.row);
  cell.style.gridColumn = String(item.col);
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

function renderBoard(positions, override) {
  boardEl.innerHTML = "";
  cellMap = {};
  layout = computeLayout();

  // 同じ列に置かれる共通セル（栗山＝中段の1列、白石以降＝上段の各列）は
  // 1回だけ描画し、両ルートの cellMap から同じ要素を指すようにする。
  const drawnByRC = {}; // "row,col" -> cell

  ["iwamizawa", "oiwake"].forEach((rk) => {
    layout[rk].forEach((item) => {
      const isShared = item.kuriyama || item.common;
      if (isShared) {
        const key = item.row + "," + item.col;
        if (drawnByRC[key]) {
          cellMap[rk + ":" + item.pos] = drawnByRC[key];
          return;
        }
        const cell = makeCell(rk, item);
        boardEl.appendChild(cell);
        drawnByRC[key] = cell;
        cellMap[rk + ":" + item.pos] = cell;
      } else {
        const cell = makeCell(rk, item);
        boardEl.appendChild(cell);
        cellMap[rk + ":" + item.pos] = cell;
      }
    });
  });

  latestState.players.forEach((p, idx) => {
    let pos = positions[idx];
    if (override && override.idx === idx) pos = override.pos;
    const rk = p.routeKey || "oiwake";
    const item = layout[rk].find((it) => it.pos === pos);
    const dir = item ? item.dir : "L";
    const cell = cellMap[rk + ":" + pos];
    if (!cell) return;
    const pawnsEl = cell.querySelector(".pawns");
    if (pawnsEl) pawnsEl.appendChild(makeTrain(idx, p.name, dir));
  });
}

function scrollToMyPawn(pos, rk) {
  const cell = cellMap[rk + ":" + pos];
  if (cell) cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function animateSteps(playerIndex, from, to, onDone) {
  let current = from;
  const me = latestState.players.findIndex((p) => p.id === myId);
  const rk = latestState.players[playerIndex].routeKey || "oiwake";
  const stepOnce = () => {
    if (current >= to) { if (onDone) onDone(); return; }
    current += 1;
    renderBoard(positionsUpToShown(), { idx: playerIndex, pos: current });
    stepSound();
    if (playerIndex === me) scrollToMyPawn(current, rk);
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

  const meIdx = state.players.findIndex((p) => p.id === myId);
  if (meIdx >= 0) {
    const rk = state.players[meIdx].routeKey || "oiwake";
    scrollToMyPawn(state.players[meIdx].pos, rk);
  }
}

function showResult(state) {
  if (!state.finished) { resultEl.classList.remove("show"); return; }
  const ranked = [...state.players].filter((p) => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.innerHTML = "<h2>🏁 結果</h2>" +
    ranked.map((p) => `${p.rank}位：${p.name}（${ROUTE_NAMES[p.routeKey || "oiwake"]}）`).join("<br>");
  resultEl.classList.add("show");
}
