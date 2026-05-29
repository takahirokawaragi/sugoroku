const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// UptimeRobotの自動ping用。ここにアクセスが来るとサーバーが起き続ける
app.get("/health", (req, res) => res.send("ok"));

// ===== ゲーム設定 =====
const GOAL = 20;
const MAX_PLAYERS = 5;

// ===== ゲーム状態（サーバーだけが持つ正式なデータ）=====
let players = [];        // { id, name, pos, isCPU }
let currentTurn = 0;
let started = false;
let winner = null;

function broadcastState() {
  io.emit("state", { players, currentTurn, started, winner, goal: GOAL });
}

function startGame() {
  while (players.length < MAX_PLAYERS) {
    const i = players.length;
    players.push({ id: "cpu-" + i, name: "CPU" + i, pos: 0, isCPU: true });
  }
  started = true;
  currentTurn = 0;
  winner = null;
  broadcastState();
  maybeRunCPU();
}

function rollDice() {
  if (!started || winner) return;
  const player = players[currentTurn];
  const dice = Math.floor(Math.random() * 6) + 1;
  player.lastDice = dice;
  player.pos += dice;
  if (player.pos >= GOAL) {
    player.pos = GOAL;
    winner = player.name;
  } else {
    currentTurn = (currentTurn + 1) % players.length;
  }
  broadcastState();
  maybeRunCPU();
}

function maybeRunCPU() {
  if (!started || winner) return;
  if (players[currentTurn].isCPU) {
    setTimeout(rollDice, 1200);
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
  };
  players.push(player);
  socket.emit("joined", player.id);
  broadcastState();

  socket.on("start", () => {
    if (!started) startGame();
  });

  socket.on("roll", () => {
    if (!started || winner) return;
    if (players[currentTurn].id === socket.id) rollDice();
  });

  socket.on("disconnect", () => {
    const p = players.find((x) => x.id === socket.id);
    if (p) {
      p.isCPU = true;
      p.name = p.name.replace("(CPU)", "") + "(CPU)";
    }
    // 人間が誰もいなくなったら全部リセット（次の人が遊べるように）
    if (players.filter((x) => !x.isCPU).length === 0) {
      players = [];
      started = false;
      winner = null;
      currentTurn = 0;
    }
    broadcastState();
    maybeRunCPU();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on " + PORT));
