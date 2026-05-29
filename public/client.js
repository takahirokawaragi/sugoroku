const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

// 添付画像に合わせた区画の色（1→10の順）
const WHEEL_COLORS = [
  "#f4d000", // 1 黄
  "#f5a623", // 2 オレンジ
  "#e8731c", // 3 濃いオレンジ
  "#e8231c", // 4 赤
  "#e6007e", // 5 ピンク（マゼンタ）
  "#9b3fb5", // 6 紫
  "#5b3fb5", // 7 青紫
  "#1c9ee8", // 8 水色
  "#2e8b3f", // 9 緑
  "#8bc63f", // 10 黄緑
];

let myId = null;
let goal = 40;
let busy = false;          // 回転＋コマ移動中フラグ
let currentRotation = 0;
let lastWinnerShown = false;

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
function stepSound() { beep(1200, 60, "square", 0.2); } // 1コマ進む音
function winSound() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => setTimeout(() => beep(n, 200, "triangle", 0.3), i * 180));
}

// ===== ルーレット描画（画像に寄せる）=====
function drawWheel() {
  const size = wheel.width;
  const r = size / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, size, size);

  // 外周の白フチ
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ccc";
  ctx.stroke();

  const outerR = r - 6;
  const innerR = r * 0.42; // 中央の白い部分

  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * seg - Math.PI / 2;
    const end = (i + 1) * seg - Math.PI / 2;

    // 色の区画（ドーナツ状）
    ctx.beginPath();
    ctx.arc(r, r, outerR, start, end);
    ctx.arc(r, r, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    // 数字（区画の中央、放射状に外向き）
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
    // 数字を外向き（中心から外を頭にする）に立てる
    ctx.rotate(Math.PI / 2);
    ctx.strokeText(String(i + 1), 0, -textR + 4);
    ctx.fillText(String(i + 1), 0, -textR + 4);
    ctx.restore();
  }

  // 中央の飾り（多角形）
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

// ===== ルーレットを回す → 止まったら onStop を呼ぶ =====
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

// ===== コマを1歩ずつ進める演出 =====
function animateSteps(playerIndex, fromPos, steps, onDone, state) {
  let current = fromPos;
  let remaining = steps;
  const stepOnce = () => {
    if (remaining <= 0) { if (onDone) onDone(); return; }
    current += 1;
    if (current > goal) current = goal;
    // 表示だけ動かす（その瞬間の位置で盤面を描く）
    drawBoardWithOverride(state, playerIndex, current);
    stepSound();
    remaining -= 1;
    if (current >= goal) { if (onDone) setTimeout(onDone, 300); return; }
    setTimeout(stepOnce, 350);
  };
  stepOnce();
}

// ===== 名前 =====
nameBtn.addEventListener("click", () => {
  ensureAudio();
  const name = nameInput.value.trim();
  if (name) socket.emit("setName", name);
});

startBtn.addEventListener("click", () => { ensureAudio(); socket.emit("start"); });
rollBtn.addEventListener("click", () => { ensureAudio(); socket.emit("roll"); });

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true; rollBtn.disabled = true;
});

let prevPositions = {}; // 各プレイヤーの「演出前の位置」を覚えておく

socket.on("state", (state) => {
  goal = state.goal;

  // ゲーム中に新しいサイコロが出ていて、まだ演出していなければ
  if (state.started && state.lastDice && state.lastRolledIndex != null && !busy) {
    const idx = state.lastRolledIndex;
    const newPos = state.players[idx].pos;
    const before = prevPositions[idx] != null ? prevPositions[idx] : 0;
    const steps = newPos - before;

    if (steps > 0) {
      busy = true;
      rollBtn.disabled = true;
      // まず回す → 止まったら1歩ずつ進める
      spinTo(state.lastDice, () => {
        animateSteps(idx, before, steps, () => {
          prevPositions[idx] = newPos;
          busy = false;
          finalizeState(state);
        }, state);
      });
      // 進行中は古い位置で盤面表示
      drawBoard(state, prevPositions);
      updateStatus(state, true);
      return;
    }
  }

  // 通常の表示更新
  syncPositions(state);
  drawBoard(state);
  updateStatus(state, false);
  showResult(state);
});

function syncPositions(state) {
  state.players.forEach((p, i) => {
    if (prevPositions[i] == null) prevPositions[i] = p.pos;
  });
}

function finalizeState(state) {
  drawBoard(state);
  updateStatus(state, false);
  showResult(state);
}

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

function placePawns(cells, positions, state) {
  state.players.forEach((p, idx) => {
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

// 通常描画（positionsを指定しなければ実際の位置）
function drawBoard(state, positions) {
  boardEl.innerHTML = "";
  const cells = [];
  for (let i = 0; i <= goal; i++) {
    const cell = buildCell(i);
    cells.push(cell);
    boardEl.appendChild(cell);
  }
  const pos = {};
  state.players.forEach((p, i) => {
    pos[i] = positions && positions[i] != null ? positions[i] : p.pos;
  });
  placePawns(cells, pos, state);
}

// 1人だけ途中位置で描く（アニメ用）
function drawBoardWithOverride(state, overrideIdx, overridePos) {
  boardEl.innerHTML = "";
  const cells = [];
  for (let i = 0; i <= goal; i++) {
    const cell = buildCell(i);
    cells.push(cell);
    boardEl.appendChild(cell);
  }
  const pos = {};
  state.players.forEach((p, i) => {
    pos[i] = (i === overrideIdx) ? overridePos : (prevPositions[i] != null ? prevPositions[i] : p.pos);
  });
  placePawns(cells, pos, state);
}

function updateStatus(state, duringAnim) {
  playersEl.innerHTML = state.players
    .map((p, idx) => `<span style="color:${COLORS[idx]}">●</span>${p.name}（${p.pos}）`)
    .join("　");

  if (state.finished) {
    statusEl.textContent = "🏁 全員ゴール！ゲーム終了";
    startBtn.disabled = true; rollBtn.disabled = true;
    return;
  }
  if (!state.started) {
    statusEl.textContent = "名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false; rollBtn.disabled = true;
    return;
  }
  startBtn.disabled = true;
  nameArea.style.display = "none"; // 開始後は名前入力を隠す
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn
    ? "あなたの番です！ルーレットを回してください"
    : (current ? current.name + " の番です..." : "");
  rollBtn.disabled = !myTurn || busy || duringAnim;
}

function showResult(state) {
  if (!state.finished) { resultEl.textContent = ""; return; }
  const ranked = [...state.players].filter(p => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.textContent = "【結果】\n" +
    ranked.map(p => `${p.rank}位：${p.name}`).join("\n");
  if (!lastWinnerShown) { lastWinnerShown = true; ensureAudio(); winSound(); }
}
