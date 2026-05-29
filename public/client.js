/* =========================================================
   すごろくゲーム  client.js
   バージョン: v1.0
   日付: 2026-05-29
   このファイル: ブラウザ側（画面表示・ルーレット演出・音）
   v1.0での変更点:
     - サーバーの moves(seq番号つき) を順番に1つずつ演出する方式に変更
     - 「ルーレットが止まってからコマが進む」流れを徹底
     - 順番の逆転・1周でのフリーズを解消
     - ルーレットの見た目と音は前のバージョンのまま
   ※ server.js も同じ v1.0 とセットで使うこと
   ========================================================= */

const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

// ルーレットの区画の色（1→10の順）
const WHEEL_COLORS = [
  "#f4d000", "#f5a623", "#e8731c", "#e8231c", "#e6007e",
  "#9b3fb5", "#5b3fb5", "#1c9ee8", "#2e8b3f", "#8bc63f",
];

let myId = null;
let goal = 40;
let currentRotation = 0;
let lastWinnerShown = false;

// ===== 演出の管理 =====
let lastShownSeq = 0;      // どの seq まで演出し終えたか
let animating = false;     // 今、演出中か
let latestState = null;    // 最新のサーバー状態を覚えておく

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const resultEl = document.getElementById("result");
const startBtn = document.getElementById("startBtn");
const rollBtn = document.getElementById("rollBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");
const nameArea = document.getElementById("nameArea");

// ===== 音 =====
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep(freq, durationMs, type = "square", volume = 0.2) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}
let tickTimer = null;
function startTicking() {
  let interval = 60;
  const tick = () => {
    beep(900, 30, "square", 0.12);
    interval += 12;
    if (interval < 280) tickTimer = setTimeout(tick, interval);
  };
  tick();
}
function stopTicking() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }
function stopSound() {
  beep(660, 120, "triangle", 0.3);
  setTimeout(() => beep(880, 160, "triangle", 0.3), 120);
}
function stepSound() { beep(1200, 60, "square", 0.2); }
function winSound() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => setTimeout(() => beep(n, 200, "triangle", 0.3), i * 180));
}

// ===== ルーレット描画（前のバージョンのまま）=====
function drawWheel() {
  const size = wheel.width;
  const r = size / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ccc";
  ctx.stroke();

  const outerR = r - 6;
  const innerR = r * 0.42;

  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * seg - Math.PI / 2;
    const end = (i + 1) * seg - Math.PI / 2;

    ctx.beginPath();
    ctx.arc(r, r, outerR, start, end);
    ctx.arc(r, r, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    const textR = (outerR + innerR) / 2;
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(String(i + 1), 0, -textR + 4);
    ctx.fillText(String(i + 1), 0, -textR + 4);
    ctx.restore();
  }

  ctx.beginPath();
  const deco = 8;
  for (let i = 0; i < deco; i++) {
    const a = (Math.PI * 2 / deco) * i;
    const x = r + Math.cos(a) * innerR * 0.5;
    const y = r + Math.sin(a) * innerR * 0.5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 2;
  ctx.stroke();
}
drawWheel();

// ===== ルーレットを回す → 止まったら onStop =====
function spinTo(dice, onStop) {
  ensureAudio();
  startTicking();
  const seg = 360 / SEGMENTS;
  const targetAngle = 360 * 5 + (360 - (dice - 1) * seg - seg / 2);
  currentRotation += targetAngle;
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(() => {
    stopTicking();
    stopSound();
    if (onStop) setTimeout(onStop, 400);
  }, 4000);
}

// ===== コマを1歩ずつ進める（指定の位置を上書きして描く）=====
function animateSteps(playerIndex, from, to, onDone) {
  let current = from;
  const stepOnce = () => {
    if (current >= to) { if (onDone) onDone(); return; }
    current += 1;
    drawBoardWithOverride(playerIndex, current);
    stepSound();
    if (current >= to) { if (onDone) setTimeout(onDone, 300); return; }
    setTimeout(stepOnce, 350);
  };
  if (from === to) { if (onDone) onDone(); return; }
  stepOnce();
}

// ===== 演出のメイン：まだ見せていない move を順番に1つずつ =====
function processNextMove() {
  if (animating) return;
  if (!latestState) return;
  const moves = latestState.moves || [];
  // まだ見せていない、いちばん古い move を探す
  const next = moves.find((m) => m.seq === lastShownSeq + 1);
  if (!next) {
    // もう演出するものがない → 最新状態をそのまま表示して終わり
    finalizeState(latestState);
    return;
  }

  animating = true;
  rollBtn.disabled = true;
  statusEl.textContent = next.name + " がルーレットを回しています...";

  // まず古い位置（from）で盤面を描く
  drawBoardWithOverride(next.index, next.from);

  // ルーレットを回す → 止まったらコマを進める
  spinTo(next.dice, () => {
    statusEl.textContent = next.name + " が " + next.dice + " を出しました";
    animateSteps(next.index, next.from, next.to, () => {
      lastShownSeq = next.seq;
      animating = false;
      // 次の move があれば続けて演出
      processNextMove();
    });
  });
}

// ===== 名前・ボタン =====
nameBtn.addEventListener("click", () => {
  ensureAudio();
  const name = nameInput.value.trim();
  if (name) socket.emit("setName", name);
});
startBtn.addEventListener("click", () => { ensureAudio(); socket.emit("start"); });
rollBtn.addEventListener("click", () => { ensureAudio(); rollBtn.disabled = true; socket.emit("roll"); });

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true; rollBtn.disabled = true;
});

socket.on("state", (state) => {
  goal = state.goal;
  latestState = state;

  // ゲーム前 or 終了は、すぐ表示を更新
  if (!state.started || state.finished) {
    finalizeState(state);
  }
  // 演出すべき move があれば順番に演出する
  processNextMove();
});

// ===== 盤面描画 =====
function buildCell(i) {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (i === 0) cell.classList.add("start");
  if (i === goal) cell.classList.add("goal");
  const num = document.createElement("div");
  num.className = "num";
  num.textContent = i === 0 ? "START" : i === goal ? "GOAL" : i;
  cell.appendChild(num);
  return cell;
}

function placePawns(cells, positions) {
  if (!latestState) return;
  latestState.players.forEach((p, idx) => {
    const pos = positions[idx];
    const cell = cells[pos];
    if (!cell) return;
    let pawnsEl = cell.querySelector(".pawns");
    if (!pawnsEl) {
      pawnsEl = document.createElement("div");
      pawnsEl.className = "pawns";
      cell.appendChild(pawnsEl);
    }
    const wrap = document.createElement("div");
    wrap.className = "pawnWrap";
    const pawn = document.createElement("div");
    pawn.className = "pawn";
    pawn.style.background = COLORS[idx];
    const nm = document.createElement("div");
    nm.className = "pawnName";
    nm.textContent = p.name;
    wrap.appendChild(pawn);
    wrap.appendChild(nm);
    pawnsEl.appendChild(wrap);
  });
}

// すでに演出し終えた手の位置を計算して返す（lastShownSeq までを反映した位置）
function positionsUpToShown() {
  const pos = {};
  latestState.players.forEach((p, i) => { pos[i] = 0; });
  const moves = latestState.moves || [];
  moves.forEach((m) => {
    if (m.seq <= lastShownSeq) pos[m.index] = m.to;
  });
  return pos;
}

// 通常描画（演出し終えた位置で描く）
function drawBoard() {
  boardEl.innerHTML = "";
  const cells = [];
  for (let i = 0; i <= goal; i++) {
    const cell = buildCell(i);
    cells.push(cell);
    boardEl.appendChild(cell);
  }
  placePawns(cells, positionsUpToShown());
}

// 1人だけ途中位置で描く（アニメ用）
function drawBoardWithOverride(overrideIdx, overridePos) {
  boardEl.innerHTML = "";
  const cells = [];
  for (let i = 0; i <= goal; i++) {
    const cell = buildCell(i);
    cells.push(cell);
    boardEl.appendChild(cell);
  }
  const pos = positionsUpToShown();
  pos[overrideIdx] = overridePos;
  placePawns(cells, pos);
}

// ===== 演出が全部終わったときの最終表示 =====
function finalizeState(state) {
  drawBoard();

  playersEl.innerHTML = state.players
    .map((p, idx) => `<span style="color:${COLORS[idx]}">●</span>${p.name}（${p.pos}）`)
    .join("　");

  if (state.finished) {
    statusEl.textContent = "🏁 全員ゴール！ゲーム終了";
    startBtn.disabled = true; rollBtn.disabled = true;
    showResult(state);
    return;
  }
  if (!state.started) {
    statusEl.textContent = "名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false; rollBtn.disabled = true;
    nameArea.style.display = "";
    return;
  }

  startBtn.disabled = true;
  nameArea.style.display = "none";
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn
    ? "あなたの番です！ルーレットを回してください"
    : (current ? current.name + " の番です..." : "");
  rollBtn.disabled = !myTurn || animating;
}

function showResult(state) {
  if (!state.finished) { resultEl.textContent = ""; return; }
  const ranked = [...state.players].filter(p => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.textContent = "【結果】\n" +
    ranked.map(p => `${p.rank}位：${p.name}`).join("\n");
  if (!lastWinnerShown) { lastWinnerShown = true; ensureAudio(); winSound(); }
}
