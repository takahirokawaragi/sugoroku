/* =========================================================
   すごろくゲーム  client.js
   バージョン: v1.5
   日付: 2026-06-12
   このファイル: ブラウザ側（画面表示・ルーレット演出・音）
   v1.5での変更点:
     - 各マスを駅名標ふう3段（漢字・ひらがな・ローマ字）で表示
   v1.4: 漢字+ひらがな表示, v1.0〜v1.3: 演出方式・38駅化など
   ※ server.js / index.html も v1.5 とセットで使うこと
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
let stations = [];         // {kanji, kana, romaji} の配列
let currentRotation = 0;
let lastWinnerShown = false;

let lastShownSeq = 0;
let animating = false;
let latestState = null;

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

// ===== ルーレットを回す → 止まったら onStop =====
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

// ===== 駅名の取り出し（保険つき）=====
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

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true; rollBtn.disabled = true;
});

socket.on("state", (state) => {
  goal = state.goal;
  stations = state.stations || [];
  latestState = state;

  if (!state.started || state.finished) {
    finalizeState(state);
  }
  processNextMove();
});

// ===== 盤面描画（駅名標ふう3段：漢字・ひらがな・ローマ字）=====
function buildCell(i) {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (i === 0) cell.classList.add("start");
  if (i === goal) cell.classList.add("goal");

  // 漢字（一番上）
  const kanji = document.createElement("div");
  kanji.className = "stKanji";
  kanji.textContent = stKanji(i);
  cell.appendChild(kanji);

  // ひらがな（その下）
  const kana = document.createElement("div");
  kana.className = "stKana";
  kana.textContent = stKana(i);
  cell.appendChild(kana);

  // 黄緑の帯＋ローマ字
  const band = document.createElement("div");
  band.className = "stBand";
  const romaji = document.createElement("div");
  romaji.className = "stRomaji";
  romaji.textContent = stRomaji(i);
  band.appendChild(romaji);
  cell.appendChild(band);

  // START / GOAL の小ラベル
  if (i === 0 || i === goal) {
    const tag = document.createElement("div");
    tag.className = "stTag";
    tag.textContent = (i === 0) ? "START" : "GOAL";
    cell.appendChild(tag);
  }
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

  if (state.finished) {
    statusEl.textContent = "🏁 全員ゴール（小樽）！ゲーム終了";
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
