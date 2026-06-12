/* =========================================================
   すごろくゲーム  server.js
   バージョン: v3.0
   日付: 2026-06-12
   v3.0での変更点:
     - ルート選択を追加（追分経由 / 岩見沢経由）
       ・追分ルート: 38駅（栗山→追分→南千歳→札幌→小樽）
       ・岩見沢ルート: 31駅（栗山→岩見沢→札幌→小樽）
     - 開始時に選んだルートの駅リスト・ゴール位置をstateで配信
   v2.2: リセット再接続/satellite ほか
   ※ client.js / index.html も v3.0 とセットで使うこと
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

// ===== 2つのルートの駅リスト =====
const ROUTES = {
  // 追分経由（従来の38駅）
  oiwake: [
    { kanji: "栗山", kana: "くりやま", romaji: "Kuriyama" },
    { kanji: "由仁", kana: "ゆに", romaji: "Yuni" },
    { kanji: "古山", kana: "ふるさん", romaji: "Furusan" },
    { kanji: "三川", kana: "みかわ", romaji: "Mikawa" },
    { kanji: "追分", kana: "おいわけ", romaji: "Oiwake" },
    { kanji: "安平", kana: "あびら", romaji: "Abira" },
    { kanji: "早来", kana: "はやきた", romaji: "Hayakita" },
    { kanji: "遠浅", kana: "とあさ", romaji: "Toasa" },
    { kanji: "沼ノ端", kana: "ぬまのはた", romaji: "Numanohata" },
    { kanji: "植苗", kana: "うえなえ", romaji: "Uenae" },
    { kanji: "南千歳", kana: "みなみちとせ", romaji: "Minami-Chitose" },
    { kanji: "千歳", kana: "ちとせ", romaji: "Chitose" },
    { kanji: "長都", kana: "おさつ", romaji: "Osatsu" },
    { kanji: "サッポロビール庭園", kana: "さっぽろびーるていえん", romaji: "Sapporo Beer Teien" },
    { kanji: "恵庭", kana: "えにわ", romaji: "Eniwa" },
    { kanji: "恵み野", kana: "めぐみの", romaji: "Megumino" },
    { kanji: "島松", kana: "しままつ", romaji: "Shimamatsu" },
    { kanji: "北広島", kana: "きたひろしま", romaji: "Kita-Hiroshima" },
    { kanji: "上野幌", kana: "かみのっぽろ", romaji: "Kami-Nopporo" },
    { kanji: "新札幌", kana: "しんさっぽろ", romaji: "Shin-Sapporo" },
    { kanji: "平和", kana: "へいわ", romaji: "Heiwa" },
    { kanji: "白石", kana: "しろいし", romaji: "Shiroishi" },
    { kanji: "苗穂", kana: "なえぼ", romaji: "Naebo" },
    { kanji: "札幌", kana: "さっぽろ", romaji: "Sapporo" },
    { kanji: "桑園", kana: "そうえん", romaji: "Sōen" },
    { kanji: "琴似", kana: "ことに", romaji: "Kotoni" },
    { kanji: "発寒中央", kana: "はっさむちゅうおう", romaji: "Hassamu-Chūō" },
    { kanji: "発寒", kana: "はっさむ", romaji: "Hassamu" },
    { kanji: "稲積公園", kana: "いなづみこうえん", romaji: "Inazumi-Kōen" },
    { kanji: "手稲", kana: "ていね", romaji: "Teine" },
    { kanji: "稲穂", kana: "いなほ", romaji: "Inaho" },
    { kanji: "星置", kana: "ほしおき", romaji: "Hoshioki" },
    { kanji: "ほしみ", kana: "ほしみ", romaji: "Hoshimi" },
    { kanji: "銭函", kana: "ぜにばこ", romaji: "Zenibako" },
    { kanji: "朝里", kana: "あさり", romaji: "Asari" },
    { kanji: "小樽築港", kana: "おたるちっこう", romaji: "Otaru-Chikkō" },
    { kanji: "南小樽", kana: "みなみおたる", romaji: "Minami-Otaru" },
    { kanji: "小樽", kana: "おたる", romaji: "Otaru" },
  ],
  // 岩見沢経由（31駅）
  iwamizawa: [
    { kanji: "栗山", kana: "くりやま", romaji: "Kuriyama" },
    { kanji: "栗丘", kana: "くりおか", romaji: "Kurioka" },
    { kanji: "栗沢", kana: "くりさわ", romaji: "Kurisawa" },
    { kanji: "志文", kana: "しぶん", romaji: "Shibun" },
    { kanji: "岩見沢", kana: "いわみざわ", romaji: "Iwamizawa" },
    { kanji: "上幌向", kana: "かみほろむい", romaji: "Kami-Horomui" },
    { kanji: "幌向", kana: "ほろむい", romaji: "Horomui" },
    { kanji: "豊幌", kana: "とよほろ", romaji: "Toyohoro" },
    { kanji: "江別", kana: "えべつ", romaji: "Ebetsu" },
    { kanji: "野幌", kana: "のっぽろ", romaji: "Nopporo" },
    { kanji: "高砂", kana: "たかさご", romaji: "Takasago" },
    { kanji: "大麻", kana: "おおあさ", romaji: "Ōasa" },
    { kanji: "森林公園", kana: "しんりんこうえん", romaji: "Shinrin-Kōen" },
    { kanji: "厚別", kana: "あつべつ", romaji: "Atsubetsu" },
    { kanji: "白石", kana: "しろいし", romaji: "Shiroishi" },
    { kanji: "苗穂", kana: "なえぼ", romaji: "Naebo" },
    { kanji: "札幌", kana: "さっぽろ", romaji: "Sapporo" },
    { kanji: "桑園", kana: "そうえん", romaji: "Sōen" },
    { kanji: "琴似", kana: "ことに", romaji: "Kotoni" },
    { kanji: "発寒中央", kana: "はっさむちゅうおう", romaji: "Hassamu-Chūō" },
    { kanji: "発寒", kana: "はっさむ", romaji: "Hassamu" },
    { kanji: "稲積公園", kana: "いなづみこうえん", romaji: "Inazumi-Kōen" },
    { kanji: "手稲", kana: "ていね", romaji: "Teine" },
    { kanji: "稲穂", kana: "いなほ", romaji: "Inaho" },
    { kanji: "星置", kana: "ほしおき", romaji: "Hoshioki" },
    { kanji: "ほしみ", kana: "ほしみ", romaji: "Hoshimi" },
    { kanji: "銭函", kana: "ぜにばこ", romaji: "Zenibako" },
    { kanji: "朝里", kana: "あさり", romaji: "Asari" },
    { kanji: "小樽築港", kana: "おたるちっこう", romaji: "Otaru-Chikkō" },
    { kanji: "南小樽", kana: "みなみおたる", romaji: "Minami-Otaru" },
    { kanji: "小樽", kana: "おたる", romaji: "Otaru" },
  ],
};

const MAX_PLAYERS = 5;

let routeKey = "oiwake";          // 現在のルート
let STATIONS = ROUTES[routeKey];
let GOAL = STATIONS.length - 1;

let players = [];
let currentTurn = 0;
let started = false;
let finished = false;
let finishedCount = 0;
let moves = [];
let seqCounter = 0;

function broadcastState() {
  io.emit("state", {
    players, currentTurn, started, finished,
    goal: GOAL, stations: STATIONS, routeKey, moves,
  });
}

function clearAll() {
  players = [];
  currentTurn = 0;
  started = false;
  finished = false;
  finishedCount = 0;
  moves = [];
  seqCounter = 0;
}

function resetGame() {
  clearAll();
  io.emit("resetReady");
}

function startGame() {
  if (players.filter((p) => !p.isCPU).length === 0) return;
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
    if (players[next].rank === 0) { currentTurn = next; return; }
  }
}

function rollDice() {
  if (!started || finished) return;
  const player = players[currentTurn];
  if (!player) return;
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

  seqCounter += 1;
  moves.push({ seq: seqCounter, index: currentTurn, name: player.name, dice, from, to });
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
  if (players[currentTurn] && players[currentTurn].isCPU) setTimeout(rollDice, 6500);
}

io.on("connection", (socket) => {
  if (started) {
    socket.emit("rejected", "ゲームは進行中です。リセットすると参加できます。");
    return;
  }
  if (players.filter((p) => !p.isCPU).length >= MAX_PLAYERS) {
    socket.emit("rejected", "ゲームは満員です。リセットすると参加できます。");
    return;
  }

  const player = {
    id: socket.id, name: "Player" + (players.length + 1),
    pos: 0, isCPU: false, rank: 0,
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

  // ルート選択（開始前のみ）
  socket.on("setRoute", (key) => {
    if (started) return;
    if (key === "oiwake" || key === "iwamizawa") {
      routeKey = key;
      STATIONS = ROUTES[routeKey];
      GOAL = STATIONS.length - 1;
      broadcastState();
    }
  });

  socket.on("start", () => { if (!started) startGame(); });

  socket.on("roll", () => {
    if (!started || finished) return;
    if (players[currentTurn] && players[currentTurn].id === socket.id) rollDice();
  });

  socket.on("reset", () => { resetGame(); });

  socket.on("disconnect", () => {
    if (!started) {
      players = players.filter((x) => x.id !== socket.id);
      if (players.filter((x) => !x.isCPU).length === 0) clearAll();
      broadcastState();
      return;
    }
    const p = players.find((x) => x.id === socket.id);
    if (p) { p.isCPU = true; }
    if (players.filter((x) => !x.isCPU).length === 0) {
      clearAll();
    } else if (players[currentTurn] && players[currentTurn].isCPU) {
      maybeRunCPU();
    }
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on " + PORT));
