const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];

let myId = null;
let goal = 20;

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const startBtn = document.getElementById("startBtn");
const rollBtn = document.getElementById("rollBtn");

startBtn.addEventListener("click", () => socket.emit("start"));
rollBtn.addEventListener("click", () => socket.emit("roll"));

socket.on("joined", (id) => { myId = id; });

socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true;
  rollBtn.disabled = true;
});

socket.on("state", (state) => {
  goal = state.goal;
  drawBoard(state);
  updateStatus(state);
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
    ? "あなたの番です！サイコロを振ってください"
    : current.name + " の番です...";
  rollBtn.disabled = !myTurn;
}
