const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.send("ok"));

// ===== ゲーム設定 =====
const GOAL = 40;          // マス数を40に
const MAX_PLAYERS = 5;

// ===== ゲーム状態 =====
let players = [];         // { id, name, pos, isCPU, rank }
let currentTurn = 0;
let started = false;
let finished = false;     // 全員ゴールしたら true
let lastDice = null;
let lastRolledIndex = null;
let finishedCount = 0;    // 何人ゴールしたか（順位用）

function broadcastState() {
  io.emit("state", {
    players, currentTurn, started, finished,
    goal: GOAL, lastDice, lastRolledIndex,
  });
}

function startGame() {
  while (players.length < MAX_PLAYERS) {
    const i = players.length;
    players.push({ id: "cpu-" + i, name: "CPU" + (i + 1), pos: 0, isCPU: true, rank: 0 });
  }
  started = true;
  finished = false;
  currentTurn = 0;
  lastDice = null;
  lastRolledIndex = null;
  finishedCount = 0;
  broadcastState();
  maybeRunCPU();
}

// 次の「まだゴールしていない人」に手番を移す
function advanceTurn() {
  for (let i = 1; i <= players.length; i++) {
    const next = (currentTurn + i) % players.length;
    if (players[next].rank === 0) { // まだゴールしていない
      currentTurn = next;
      return;
    }
  }
}

function rollDice() {
  if (!started || finished) return;
  const player = players[currentTurn];
  if (player.rank !== 0) { advanceTurn(); maybeRunCPU(); return; } // ゴール済みは飛ばす

  const dice = Math.floor(Math.random() * 10) + 1; // 1〜10
  lastDice = dice;
  lastRolledIndex = currentTurn;
  player.pos += dice;

  if (player.pos >= GOAL) {
    player.pos = GOAL;
    finishedCount += 1;
    player.rank = finishedCount; // 何位でゴールしたか
  }

  // 全員ゴールしたか？
  if (players.every((p) => p.rank > 0)) {
    finished = true;
    broadcastState();
    return;
  }

  advanceTurn();
  broadcastState();
  maybeRunCPU();
}

function maybeRunCPU() {
  if (!started || finished) return;
  if (players[currentTurn].isCPU) {
    // コマが1歩ずつ進む演出の時間も考え、長めに待つ
    setTimeout(rollDice, 6500);
  }
}

io.on("connection", (socket) => {
  if (started || players.filter((p) => !p.isCPU).length >= MAX_PLAYERS) {
    socket.emit("rejected", "ゲームは満員または進行中です");
    return;
  }

  const player = {
    id: socket.id,
    name: "Player" + (players.length + 1),
    pos: 0,
    isCPU: false,
    rank: 0,
  };
  players.push(player);
  socket.emit("joined", player.id);
  broadcastState();

  // 名前を受け取って反映
  socket.on("setName", (name) => {
    const p = players.find((x) => x.id === socket.id);
    if (p && !started) {
      p.name = String(name).slice(0, 12) || p.name; // 12文字まで
      broadcastState();
    }
  });

  socket.on("start", () => {
    if (!started) startGame();
  });

  socket.on("roll", () => {
    if (!started || finished) return;
    if (players[currentTurn].id === socket.id) rollDice();
  });

  socket.on("disconnect", () => {
    const p = players.find((x) => x.id === socket.id);
    if (p) {
      p.isCPU = true;
      p.name = p.name.replace("(CPU)", "") + "(CPU)";
    }
    if (players.filter((x) => !x.isCPU).length === 0) {
      players = [];
      started = false;
      finished = false;
      currentTurn = 0;
      lastDice = null;
      lastRolledIndex = null;
      finishedCount = 0;
    } else if (started && players[currentTurn] && players[currentTurn].isCPU) {
      maybeRunCPU();
    }
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on " + PORT));
