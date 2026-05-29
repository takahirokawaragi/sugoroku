const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10; // ルーレットの区画数（1〜10）

let myId = null;
let goal = 20;
let spinning = false;     // 回転中フラグ
let currentRotation = 0;  // 円盤の現在の角度

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const startBtn = document.getElementById("startBtn");
const rollBtn = document.getElementById("rollBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");

// ===== 音（電子音。ファイル不要）=====
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
// 短いビープ音を鳴らす関数
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
// 回転中の「カチカチ」音を鳴らし続ける
let tickTimer = null;
function startTicking() {
  let interval = 60;
  const tick = () => {
    beep(900, 30, "square", 0.15);
    interval += 12; // だんだん遅くする
    if (interval < 260) tickTimer = setTimeout(tick, interval);
  };
  tick();
}
function stopTicking() {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
}
// 停止時の音（ポン）
function stopSound() {
  beep(660, 120, "triangle", 0.3);
  setTimeout(() => beep(880, 160, "triangle", 0.3), 120);
}
// ゴール時の音（ファンファーレ）
function winSound() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => setTimeout(() => beep(n, 200, "triangle", 0.3), i * 180));
}

// ===== ルーレット円盤を描く =====
function drawWheel() {
  const r = wheel.width / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, wheel.width, wheel.height);
  for (let i = 0; i < SEGMENTS; i++) {
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r - 4, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#f6c945" : "#4a90d9";
    ctx.fill();
    // 数字
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(i * seg - Math.PI / 2 + seg / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(String(i + 1), r * 0.65, 6);
    ctx.restore();
  }
}
drawWheel();

// ===== ルーレットを回す（dice = 出た目 1〜10）=====
function spinTo(dice) {
  spinning = true;
  rollBtn.disabled = true;
  ensureAudio();
  startTicking();

  const seg = 360 / SEGMENTS;
  // 出た目が真上（針の位置）に来るように角度を計算。数回転＋目標位置
  const targetAngle = 360 * 5 + (360 - (dice - 1) * seg - seg / 2);
  currentRotation += targetAngle;
  wheel.style.transform = `rotate(${currentRotation}deg)`;

  // 4秒後（回転アニメと同じ長さ）に停止音
  setTimeout(() => {
    stopTicking();
    stopSound();
    spinning = false;
  }, 4000);
}

startBtn.addEventListener("click", () => { ensureAudio(); socket.emit("start"); });
rollBtn.addEventListener("click", () => { ensureAudio(); socket.emit("roll"); });

socket.on("joined", (id) => { myId = id; });

socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true;
  rollBtn.disabled = true;
});

let lastWinner = null;
socket.on("state", (state) => {
  goal = state.goal;
  drawBoard(state);

  // 誰かがルーレットを回した（最後の目がある）なら回転させる
  const current = state.players[state.lastRolledIndex];
  if (state.lastDice && !spinning) {
    spinTo(state.lastDice);
  }

  // ゴール演出（初めて勝者が出た瞬間だけ鳴らす）
  if (state.winner && state.winner !== lastWinner) {
    lastWinner = state.winner;
    ensureAudio();
    setTimeout(winSound, 600);
  }

  // ステータス更新は回転が終わってから反映したいので少し遅らせる
  setTimeout(() => updateStatus(state), spinning ? 4200 : 0);
});

function drawBoard(state) {
  boardEl.innerHTML = "";
  for (let i = 0; i <= goal; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (i === 0) cell.classList.add("start");
    if (i === goal) cell.classList.add("goal");

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = i === 0 ? "START" : i === goal ? "GOAL" : i;
    cell.appendChild(num);

    const pawns = document.createElement("div");
    pawns.className = "pawns";
    state.players.forEach((p, idx) => {
      if (p.pos === i) {
        const pawn = document.createElement("div");
        pawn.className = "pawn";
        pawn.style.background = COLORS[idx];
        pawn.title = p.name;
        pawns.appendChild(pawn);
      }
    });
    cell.appendChild(pawns);
    boardEl.appendChild(cell);
  }
}

function updateStatus(state) {
  playersEl.innerHTML = state.players
    .map((p, idx) => `<span style="color:${COLORS[idx]}">●</span>${p.name}（${p.pos}）`)
    .join("　");

  if (state.winner) {
    statusEl.textContent = "🏆 " + state.winner + " のかち！";
    startBtn.disabled = true;
    rollBtn.disabled = true;
    return;
  }

  if (!state.started) {
    statusEl.textContent = "参加者を待っています（開始ボタンでスタート）";
    startBtn.disabled = false;
    rollBtn.disabled = true;
    return;
  }

  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn
    ? "あなたの番です！ルーレットを回してください"
    : current.name + " の番です...";
  rollBtn.disabled = !myTurn || spinning;
}
