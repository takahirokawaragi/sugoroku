/* =========================================================
   すごろくゲーム  server.js
   バージョン: v3.8
   日付: 2026-06-21（日）10:12 JST
   v3.8での変更点（席管理を七並べ方式へ全面刷新・3ファイル同時v3.8化）:
     - 接続順 players → 「seat番号で着席する固定スロット方式」へ変更。
       七並べ(server.js v1.8)の joinSeat 方式に合わせた。
     - 新イベント joinSeat({ seat, name, routeKey }) を追加。
       ・空席なら着席・ロック、使用中なら rejected。
       ・名前＋ルートを1回で確定（七並べと同じ挙動）。
     - 旧イベント setName / setRoute を廃止（混入バグの根本原因）。
       → 「隣の席に名前が入る」「他人の欄に書ける」バグを根絶。
     - currentTurn は seat 番号基準に統一。
     - startGame の CPU 補充は空席(seat)を埋める方式に変更。
     - state.players は5席ぶんの固定スロット配列（空席は null）で送る。
     - 駅データ・ルート・ゴール・rollDice 等の進行ロジックは v3.5 と同一。
     - client.js v3.8 / index.html v3.8 とセットで使用。
   --- 過去履歴 ---
   v3.5: 岩見沢ルート駅順修正（江別→高砂→野幌→大麻）
   v3.1: 両ルート同時配信・各自ルート選択・白石で合流
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

// ===== 分岐部分の駅（栗山〜白石の手前まで）=====
const BRANCH_IWAMIZAWA = [
  { kanji: "栗山", kana: "くりやま", romaji: "Kuriyama" },
  { kanji: "栗丘", kana: "くりおか", romaji: "Kurioka" },
  { kanji: "栗沢", kana: "くりさわ", romaji: "Kurisawa" },
  { kanji: "志文", kana: "しぶん", romaji: "Shibun" },
  { kanji: "岩見沢", kana: "いわみざわ", romaji: "Iwamizawa" },
  { kanji: "上幌向", kana: "かみほろむい", romaji: "Kami-Horomui" },
  { kanji: "幌向", kana: "ほろむい", romaji: "Horomui" },
  { kanji: "豊幌", kana: "とよほろ", romaji: "Toyohoro" },
  { kanji: "江別", kana: "えべつ", romaji: "Ebetsu" },
  { kanji: "高砂", kana: "たかさご", romaji: "Takasago" },
  { kanji: "野幌", kana: "のっぽろ", romaji: "Nopporo" },
  { kanji: "大麻", kana: "おおあさ", romaji: "Ōasa" },
  { kanji: "森林公園", kana: "しんりんこうえん", romaji: "Shinrin-Kōen" },
  { kanji: "厚別", kana: "あつべつ", romaji: "Atsubetsu" },
];

const BRANCH_OIWAKE = [
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
];

const COMMON = [
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
];

const ROUTES = {
  iwamizawa: BRANCH_IWAMIZAWA.concat(COMMON),
  oiwake: BRANCH_OIWAKE.concat(COMMON),
};
const GOALS = {
  iwamizawa: ROUTES.iwamizawa.length - 1,
  oiwake: ROUTES.oiwake.length - 1,
};
const COMMON_START = {
  iwamizawa: BRANCH_IWAMIZAWA.length,
  oiwake: BRANCH_OIWAKE.length,
};

const MAX_PLAYERS = 5;

// ===== 席管理（七並べ方式：seat番号で固定スロット）=====
let players = [];      // 着席している人だけ（各要素は seat を持つ）
let currentTurn = 0;   // 現在手番の seat 番号
let started = false;
let finished = false;
let finishedCount = 0;
let moves = [];
let seqCounter = 0;

function seatTaken(seat) {
  return players.some((p) => p.seat === seat);
}
function playerBySeat(seat) {
  return players.find((p) => p.seat === seat);
}
function playerBySocket(id) {
  return players.find((p) => p.socketId === id);
}

function broadcastState() {
  // client は players[i] を seat=i として扱う。空席は null。
  const seatArr = [];
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = playerBySeat(s);
    seatArr.push(p ? {
      id: p.socketId || ("cpu-" + s),
      seat: s,
      name: p.name,
      pos: p.pos,
      isCPU: p.isCPU,
      rank: p.rank,
      routeKey: p.routeKey,
    } : null);
  }
  io.emit("state", {
    players: seatArr,
    currentTurn,
    started, finished,
    routes: ROUTES, goals: GOALS, commonStart: COMMON_START,
    moves,
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

function humanCount() {
  return players.filter((p) => !p.isCPU).length;
}

function startGame() {
  if (humanCount() === 0) return;
  // 空席を CPU で補充（seat 固定）
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (!seatTaken(s)) {
      const rk = Math.random() < 0.5 ? "oiwake" : "iwamizawa";
      players.push({
        socketId: null, seat: s, name: "CPU" + (s + 1),
        pos: 0, isCPU: true, rank: 0, routeKey: rk,
      });
    }
  }
  players.sort((a, b) => a.seat - b.seat);

  started = true;
  finished = false;
  finishedCount = 0;
  moves = [];
  seqCounter = 0;

  currentTurn = players.length ? players[0].seat : 0;
  broadcastState();
  maybeRunCPU();
}

function advanceTurn() {
  for (let step = 1; step <= MAX_PLAYERS; step++) {
    const seat = (currentTurn + step) % MAX_PLAYERS;
    const p = playerBySeat(seat);
    if (p && p.rank === 0) { currentTurn = seat; return; }
  }
}

function rollDice() {
  if (!started || finished) return;
  const player = playerBySeat(currentTurn);
  if (!player) { advanceTurn(); maybeRunCPU(); return; }
  if (player.rank !== 0) { advanceTurn(); maybeRunCPU(); return; }

  const goal = GOALS[player.routeKey];
  const dice = Math.floor(Math.random() * 10) + 1;
  const from = player.pos;
  player.pos += dice;
  if (player.pos >= goal) {
    player.pos = goal;
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
  const p = playerBySeat(currentTurn);
  if (p && p.isCPU) setTimeout(rollDice, 6500);
}

io.on("connection", (socket) => {
  if (started) {
    socket.emit("rejected", "ゲームは進行中です。リセットすると参加できます。");
    return;
  }
  // 接続時はまだ着席させない（joinSeat で着席）
  socket.emit("joined", socket.id);
  broadcastState();

  // ===== 席に着く（名前＋ルートを1回で確定）=====
  socket.on("joinSeat", (payload) => {
    if (started) { socket.emit("rejected", "ゲーム進行中のため参加できません"); return; }
    const seat = payload && typeof payload.seat === "number" ? payload.seat : -1;
    const routeKey = payload && (payload.routeKey === "iwamizawa" || payload.routeKey === "oiwake")
      ? payload.routeKey : "oiwake";
    const name = String((payload && payload.name) || "").slice(0, 12) || ("P" + (seat + 1));

    if (seat < 0 || seat >= MAX_PLAYERS) return;

    // すでに自分が別の席に着いている場合は、その席を解放（席替え許可）
    const mine = playerBySocket(socket.id);
    if (mine && mine.seat !== seat) {
      players = players.filter((p) => p.socketId !== socket.id);
    }

    const occupant = playerBySeat(seat);
    if (occupant && occupant.socketId !== socket.id) {
      socket.emit("rejected", "その席は使用中です");
      return;
    }

    if (occupant && occupant.socketId === socket.id) {
      // 同じ席を再確定（名前・ルート更新）
      occupant.name = name;
      occupant.routeKey = routeKey;
    } else {
      players.push({
        socketId: socket.id, seat, name,
        pos: 0, isCPU: false, rank: 0, routeKey,
      });
    }
    players.sort((a, b) => a.seat - b.seat);
    socket.emit("seated", { seat });
    broadcastState();
  });

  socket.on("start", () => { if (!started) startGame(); });

  socket.on("roll", () => {
    if (!started || finished) return;
    const p = playerBySeat(currentTurn);
    if (p && p.socketId === socket.id) rollDice();
  });

  socket.on("reset", () => { resetGame(); });

  socket.on("disconnect", () => {
    if (!started) {
      players = players.filter((x) => x.socketId !== socket.id);
      if (humanCount() === 0) clearAll();
      broadcastState();
      return;
    }
    const p = playerBySocket(socket.id);
    if (p) { p.isCPU = true; p.socketId = null; }
    if (humanCount() === 0) {
      clearAll();
    } else {
      const cur = playerBySeat(currentTurn);
      if (cur && cur.isCPU) maybeRunCPU();
    }
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on " + PORT));
  