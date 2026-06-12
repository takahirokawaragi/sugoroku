/* =========================================================
   すごろくゲーム  server.js
   バージョン: v1.0
   日付: 2026-05-29
   このファイル: サーバー側（ゲームの進行・順番・位置の管理）
   v1.0での変更点:
     - 「動いた1手ずつ」を seq 番号つきで記録する moves 方式に変更
     - これにより client 側で順番の逆転・フリーズを防ぐ
   ※ client.js も同じ v1.0 とセットで使うこと
   ========================================================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const GOAL = 40;
const MAX_PLAYERS = 5;

let players = [];
let currentTurn = 0;
let started = false;
let finished = false;
let finishedCount = 0;

// 「動いた記録」を1手ずつ積む。client はこれを順番に演出する。
let moves = [];   // { seq, index, name, dice, from, to }
let seqCounter = 0;

function broadcastState() {
  io.emit("state", {
    players, currentTurn, started, finished,
    goal: GOAL, moves,
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
  finishedCount = 0;
  moves = [];
  seqCounter = 0;
  broadcastState();
  maybeRunCPU();
}

function advanceTurn() {
  for (let i = 1; i <= players.length; i++) {
    const next = (currentTurn + i) % players.length;
    if (players[next].rank === 0) {
      currentTurn = next;
      return;
    }
  }
}

function rollDice() {
  if (!started || finished) return;
  const player = players[currentTurn];
  if (player.rank !== 0) { advanceTurn(); maybeRunCPU(); return; }

  const dice = Math.floor(Math.random() * 10) + 1;
  const from = player.pos;
  player.pos += dice;
  if (player.pos >= GOAL) {
    player.pos = GOAL;
    finishedCount += 1;
    player.rank = finishedCount;
  }
  const to = player.pos;

  // この1手を記録（client はこれを順番に演出する）
  seqCounter += 1;
  moves.push({
    seq: seqCounter,
    index: currentTurn,
    name: player.name,
    dice, from, to,
  });
  // 記録が増えすぎないよう、古いものは捨てる（直近30手だけ残す）
  if (moves.length > 30) moves = moves.slice(-30);

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

  socket.on("setName", (name) => {
    const p = players.find((x) => x.id === socket.id);
    if (p && !started) {
      p.name = String(name).slice(0, 12) || p.name;
      broadcastState();
    }
  });

  socket.on("start", () => { if (!started) startGame(); });

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
      finishedCount = 0;
      moves = [];
      seqCounter = 0;
    } else if (started && players[currentTurn] && players[currentTurn].isCPU) {
      maybeRunCPU();
    }
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on " + PORT));
