/* =========================================================
   すごろくゲーム  client.js
   バージョン: v3.3.5
   日付: 2026-06-20（土）17:21 JST
   v3.3.5での変更点:
     - 数字を外周ギリギリへ寄せ、カラー帯を細くして元画像に近づけた
       innerR 0.34→0.50 / 数字配置を外周寄り（outerR-outerR*0.13）
     - 2桁の数字(10)はフォントを自動縮小して枠内に収め、はみ出しを解消
   --- 以下 過去履歴 ---
   v3.3.4:
     - カラー帯を太くし数字を大型化（数字大きいが10がはみ出し）
   v3.3.3:
     - ルーレット全体を 1.5倍に拡大（index.html は無改変）
   v3.3.2:
     - ルーレットを添付画像のデザインに忠実に再現
       中心から外へ：小さな真円 → 大きな真円 → 十角形リング
       → 放射状の目盛り線10本 → カラフルな10分割（数字1〜10）→ 外枠
   v3.3:
     - 共通区間(白石→苗穂→札幌→…→小樽)の並び順バグを修正
     - computeLayout の列計算を見直し、駅の重なりをなくした
   v3.2: ルーレット画面固定・コマ追従
   v3.1: 両ルート同時表示（外周ループ）・コマ進行方向で自動反転
   v2.2: iPhone音復活・721系風電車・看板の見た目（緑帯・水色窓）
   ※ server.js v3.5 / index.html v3.2 とセットで使うこと
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

// ===== ルーレットを 1.5倍化（index.html は無改変）=====
// 従来：内部解像度260 / CSS表示160px / 枠160×174
// 1.5倍：CSS表示240px。内部解像度は高精細用に360で描画。
(function enlargeWheel() {
  if (!wheel) return;
  wheel.width = 360;          // 内部解像度
  wheel.height = 360;
  wheel.style.width = "240px"; // 表示サイズ＝160 × 1.5
  wheel.style.height = "240px";
  const wrap = document.getElementById("rouletteWrap");
  if (wrap) {
    wrap.style.width = "240px";
    wrap.style.height = "261px"; // 240 + ポインタ分の余白(約21px)
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

// ===== ルーレット描画（v3.3.5：数字を外周ギリギリへ・帯を細く・10はみ出し解消）=====
// 中心から外へ：小さな真円 → 大きな真円 → 十角形リング
//   → 放射状の目盛り線(10) → カラフル10分割(数字) → 外枠
function drawWheel() {
  const size = wheel.width;
  const r = size / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, size, size);

  // 全体の白い土台＋いちばん外側の細い外枠
  ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#cccccc"; ctx.stroke();

  const outerR = r - 6;       // カラー帯の外端
  const innerR = r * 0.50;    // ★カラー帯の内端（帯を細くして数字を外周へ）
  const lineGray = "#9aa1a8";

  // --- 外周：カラフルな10分割セグメント（数字つき）---
  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * seg - Math.PI / 2;
    const end = (i + 1) * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(r, r, outerR, start, end);
    ctx.arc(r, r, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    // 数字（外周ギリギリ・大きく。2桁は少し縮小してはみ出し防止）
    const label = String(i + 1);
    const baseFont = r * 0.30;
    const fontSize = (label.length >= 2) ? baseFont * 0.85 : baseFont; // ★10だけ縮小
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.font = "bold " + Math.round(fontSize) + "px sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.35)";
    const textR = outerR - outerR * 0.13; // ★外周ギリギリ
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(label, 0, -textR);
    ctx.fillText(label, 0, -textR);
    ctx.restore();
  }

  // 中心からの各層の半径
  const decagonR   = r * 0.30;   // 十角形リングの半径
  const circleBig  = r * 0.165;  // 大きな真円
  const circleSmall= r * 0.085;  // 小さな真円

  // --- 放射状の目盛り線（10本）：十角形の各辺の外から内端へ ---
  const tickOuter = innerR - 4;       // カラー帯のすぐ内側
  const tickInner = decagonR + 4;     // 十角形の少し外
  ctx.strokeStyle = lineGray;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i + 0.5) * seg - Math.PI / 2; // セグメント中央の角度
    ctx.beginPath();
    ctx.moveTo(r + Math.cos(a) * tickInner, r + Math.sin(a) * tickInner);
    ctx.lineTo(r + Math.cos(a) * tickOuter, r + Math.sin(a) * tickOuter);
    ctx.stroke();
  }

  // --- 十角形リング（中が白、灰色の輪郭）---
  // 頂点が各セグメントの境目に来る向き（10頂点）
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const ang = k * seg - Math.PI / 2; // セグメント境界の角度
    const x = r + Math.cos(ang) * decagonR;
    const y = r + Math.sin(ang) * decagonR;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = lineGray;
  ctx.stroke();

  // --- 大きな真円 ---
  ctx.beginPath();
  ctx.arc(r, r, circleBig, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = lineGray;
  ctx.stroke();

  // --- 小さな真円（いちばん内側）---
  ctx.beginPath();
  ctx.arc(r, r, circleSmall, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = lineGray;
  ctx.stroke();
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
//  外周ループのレイアウト座標を計算
//  - 上行(UP_ROW): 岩見沢ルートの分岐を右→左
//  - 下行(DOWN_ROW): 追分ルートの分岐を右→左
//  - 最上段(TOP_ROW): 共通区間を 白石(右)→小樽(左) で並べる
// =========================================================
const TOP_ROW = 1;
const UP_ROW = 3;
const MID_ROW = 5;
const DOWN_ROW = 7;

function computeLayout() {
  const result = { oiwake: [], iwamizawa: [] };
  const csI = commonStart.iwamizawa; // 岩見沢の分岐駅数（栗山〜厚別）
  const csO = commonStart.oiwake;    // 追分の分岐駅数（栗山〜平和）
  const branchMax = Math.max(csI, csO); // 長いほうの分岐に合わせる
  const commonLen = routes.iwamizawa.length - csI; // 共通区間の駅数（白石〜小樽）

  // 全体がプラス座標に収まるよう右端列を十分大きく取る
  const RIGHT_COL = branchMax + commonLen + 1;

  // --- 分岐：岩見沢（上行）栗山(右)→厚別(左) ---
  for (let i = 0; i < csI; i++) {
    result.iwamizawa.push({ pos: i, row: UP_ROW, col: RIGHT_COL - i, dir: "L" });
  }
  // --- 分岐：追分（下行）栗山(右)→平和(左) ---
  for (let i = 0; i < csO; i++) {
    result.oiwake.push({ pos: i, row: DOWN_ROW, col: RIGHT_COL - i, dir: "L" });
  }

  // --- 共通区間（最上段）白石(右)→小樽(左) ---
  // 白石の列 = 分岐左端のさらに1つ左
  const whiteishiCol = RIGHT_COL - branchMax - 1;
  for (let j = 0; j < commonLen; j++) {
    const col = whiteishiCol - j; // j=0:白石(右) … 末尾:小樽(左)
    result.iwamizawa.push({ pos: csI + j, row: TOP_ROW, col: col, dir: "L", common: true });
    result.oiwake.push({ pos: csO + j, row: TOP_ROW, col: col, dir: "L", common: true });
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

  const drawnCommon = {};
  ["iwamizawa", "oiwake"].forEach((rk) => {
    layout[rk].forEach((item) => {
      if (item.common) {
        const key = "C:" + item.col;
        if (drawnCommon[key]) {
          cellMap[rk + ":" + item.pos] = drawnCommon[key];
          return;
        }
        const cell = makeCell(rk, item);
        boardEl.appendChild(cell);
        drawnCommon[key] = cell;
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
