/* =========================================================
   すごろくゲーム  client.js
   バージョン: v1.8
   日付: 2026-06-12
   v1.8での変更点:
     - リセットボタンを常に表示（いつでも押せる）
     - リセットはサーバーの新状態で名前入力に戻る方式に対応
       （forceReload に依存しない）
     - 駅名標/電車コマのクラス名を index.html v1.8 のCSSと完全一致
   v1.7: 各自ゴールでファンファーレ、電車コマ ほか
   ※ server.js / index.html も v1.8 とセットで使うこと
   ========================================================= */

const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

const WHEEL_COLORS = [
  "#f4d000", "#f5a623", "#e8731c", "#e8231c", "#e6007e",
  "#9b3fb5", "#5b3fb5", "#1c9ee8", "#2e8b3f", "#8bc63f",
];

let myId = null;
let goal = 37;
let stations = [];
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

// リセットボタンは最初から常に表示
resetBtn.style.display = "";

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

// ===== ファンファーレ =====
function fanfare() {
  ensureAudio();
  const seq = [
    { f: 523, t: 0,   d: 140 },
    { f: 523, t: 160, d: 140 },
    { f: 523, t: 320, d: 140 },
    { f: 659, t: 480, d: 260 },
    { f: 784, t: 760, d: 260 },
    { f: 1047, t: 1040, d: 520 }
  ];
  seq.forEach((n) => {
    setTimeout(() => {
      beep(n.f, n.d, "triangle", 0.32);
      beep(n.f * 1.5, n.d, "square", 0.10);
    }, n.t);
  });
}

// ===== ルーレット描画 =====
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

// ===== ルーレットを回す =====
function spinTo(dice, onStop) {
  ensureAudio();
  startTicking();
  const seg = 360 / SEGMENTS;
  const targetCenter = (dice - 1) * seg + seg / 2;
  const finalFacing = (360 - targetCenter) % 360;
  const currentFacing = ((currentRotation % 360) + 360) % 360;
  let delta = finalFacing - currentFacing;
  if (delta < 0) delta += 360;
  currentRotation += delta + 360 * 5;
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(() => {
    stopTicking();
    stopSound();
    if (onStop) setTimeout(onStop, 400);
  }, 4000);
}

// ===== 駅名 =====
function stKanji(i) { const s = stations[i]; return s ? (s.kanji || String(i)) : String(i); }
function stKana(i)  { const s = stations[i]; return s ? (s.kana || "") : ""; }
function stRomaji(i){ const s = stations[i]; return s ? (s.romaji || "") : ""; }

// ===== コマを1歩ずつ進める =====
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

// ===== 演出のメイン =====
function processNextMove() {
  if (animating) return;
  if (!latestState) return;
  const moves = latestState.moves || [];
  const next = moves.find((m) => m.seq === lastShownSeq + 1);
  if (!next) {
    finalizeState(latestState);
    return;
  }

  animating = true;
  rollBtn.disabled = true;
  statusEl.textContent = next.name + " がルーレットを回しています...";

  drawBoardWithOverride(next.index, next.from);

  spinTo(next.dice, () => {
    statusEl.textContent = next.name + " が " + next.dice + " を出して「" + stKanji(next.to) + "」へ";
    animateSteps(next.index, next.from, next.to, () => {
      lastShownSeq = next.seq;
      if (next.to >= goal && !fanfaredIndexes[next.index]) {
        fanfaredIndexes[next.index] = true;
        statusEl.textContent = next.name + " が小樽にゴール！";
        fanfare();
      }
      animating = false;
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
resetBtn.addEventListener("click", () => {
  if (confirm("ゲームをリセットして最初に戻しますか？")) {
    socket.emit("reset");
  }
});

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true; rollBtn.disabled = true;
});

socket.on("state", (state) => {
  goal = state.goal;
  stations = state.stations || [];

  // リセット等でゲームがまっさらに戻ったら、演出の進行状況も初期化
  if (!state.started) {
    lastShownSeq = 0;
    animating = false;
    fanfaredIndexes = {};
  }

  latestState = state;

  if (!state.started || state.finished) {
    finalizeState(state);
  }
  processNextMove();
});

// ===== 盤面描画 =====
function buildCell(i) {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (i === 0) cell.classList.add("start");
  if (i === goal) cell.classList.add("goal");

  const sign = document.createElement("div");
  sign.className = "stSign";

  const kanji = document.createElement("div");
  kanji.className = "stKanji";
  kanji.textContent = stKanji(i);
  sign.appendChild(kanji);

  const kana = document.createElement("div");
  kana.className = "stKana";
  kana.textContent = stKana(i);
  sign.appendChild(kana);

  const band = document.createElement("div");
  band.className = "stBand";
  const romaji = document.createElement("div");
  romaji.className = "stRomaji";
  romaji.textContent = stRomaji(i);
  band.appendChild(romaji);
  sign.appendChild(band);

  cell.appendChild(sign);

  const pawns = document.createElement("div");
  pawns.className = "pawns";
  cell.appendChild(pawns);

  if (i === 0 || i === goal) {
    const tag = document.createElement("div");
    tag.className = "stTag";
    tag.textContent = (i === 0) ? "START" : "GOAL";
    cell.appendChild(tag);
  }
  return cell;
}

function makeTrain(colorIndex, name) {
  const wrap = document.createElement("div");
  wrap.className = "pawnWrap";

  const train = document.createElement("div");
  train.className = "train";
  train.style.setProperty("--bodyColor", COLORS[colorIndex]);
  train.innerHTML =
    '<div class="trainBody">' +
      '<div class="trainBand"></div>' +
      '<div class="trainWindows"><span></span><span></span><span></span></div>' +
      '<div class="trainFace"></div>' +
    '</div>' +
    '<div class="trainWheels"><i></i><i></i></div>';

  const nm = document.createElement("div");
  nm.className = "pawnName";
  nm.textContent = name;

  wrap.appendChild(train);
  wrap.appendChild(nm);
  return wrap;
}

function placePawns(cells, positions) {
  if (!latestState) return;
  latestState.players.forEach((p, idx) => {
    const pos = positions[idx];
    const cell = cells[pos];
    if (!cell) return;
    const pawnsEl = cell.querySelector(".pawns");
    if (!pawnsEl) return;
    pawnsEl.appendChild(makeTrain(idx, p.name));
  });
}

function positionsUpToShown() {
  const pos = {};
  latestState.players.forEach((p, i) => { pos[i] = 0; });
  const moves = latestState.moves || [];
  moves.forEach((m) => {
    if (m.seq <= lastShownSeq) pos[m.index] = m.to;
  });
  return pos;
}

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

function finalizeState(state) {
  drawBoard();

  playersEl.innerHTML = state.players
    .map((p, idx) => {
      return `<span style="color:${COLORS[idx]}">●</span>${p.name}（${stKanji(p.pos)}）`;
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
    statusEl.textContent = "名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false; rollBtn.disabled = true;
    resultEl.classList.remove("show");
    return;
  }

  startBtn.disabled = true;
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn
    ? "あなたの番です！ルーレットを回してください"
    : (current ? current.name + " の番です..." : "");
  rollBtn.disabled = !myTurn || animating;
}

function showResult(state) {
  if (!state.finished) { resultEl.classList.remove("show"); return; }
  const ranked = [...state.players].filter(p => p.rank > 0).sort((a, b) => a.rank - b.rank);
  resultEl.innerHTML = "<h2>🏁 結果</h2>" +
    ranked.map(p => `${p.rank}位：${p.name}`).join("<br>");
  resultEl.classList.add("show");
}
