/* =======================================================================
 * オンライン鉄道すごろく  server.js
 * Version: v4.0
 * Date   : 2026-06-21（日）11:13 JST
 * -----------------------------------------------------------------------
 * 【重要変更 v4.0】
 *   名前空間 '/sugoroku' を撤去し、ルート直下(io())で動作させる。
 *   → これまで index.html が /sugoroku/client.js を読みに行き 404 になって
 *     いた問題を根絶。client.js は public/ 直下、ソケットも既定名前空間。
 *   席管理は座席番号で着席・ロックする方式(joinSeat)。名前混入バグ無し。
 *   音声イベントは 'event' で全端末同時配信。
 *     start / reset / move / goal / gameover / rank / your_turn
 * ======================================================================= */

const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

/* ---- 静的公開 ---------------------------------------------------------- */
app.get('/health', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

/* ---- 路線データ ------------------------------------------------------- */
const BRANCH_IWAMIZAWA = [
  { name:'栗丘',   kana:'くりおか',   roma:'Kurioka'   },
  { name:'岩見沢', kana:'いわみざわ', roma:'Iwamizawa' },
  { name:'峰延',   kana:'みねのぶ',   roma:'Minenobu'  },
  { name:'光珠内', kana:'こうしゅない',roma:'Koshunai'  },
  { name:'美唄',   kana:'びばい',     roma:'Bibai'     },
  { name:'江別',   kana:'えべつ',     roma:'Ebetsu'    },
  { name:'高砂',   kana:'たかさご',   roma:'Takasago'  },
  { name:'野幌',   kana:'のっぽろ',   roma:'Nopporo'   },
  { name:'大麻',   kana:'おおあさ',   roma:'Oasa'      },
];

const BRANCH_OIWAKE = [
  { name:'由仁',   kana:'ゆに',       roma:'Yuni'      },
  { name:'追分',   kana:'おいわけ',   roma:'Oiwake'    },
  { name:'三川',   kana:'みかわ',     roma:'Mikawa'    },
  { name:'古山',   kana:'ふるさん',   roma:'Furusan'   },
  { name:'植苗',   kana:'うえなえ',   roma:'Uenae'     },
  { name:'沼ノ端', kana:'ぬまのはた', roma:'Numanohata'},
  { name:'苫小牧', kana:'とまこまい', roma:'Tomakomai' },
  { name:'南千歳', kana:'みなみちとせ',roma:'Minamichitose'},
];

const COMMON = [
  { name:'白石',   kana:'しろいし',   roma:'Shiroishi' },
  { name:'平和',   kana:'へいわ',     roma:'Heiwa'     },
  { name:'苗穂',   kana:'なえぼ',     roma:'Naebo'     },
  { name:'札幌',   kana:'さっぽろ',   roma:'Sapporo'   },
];

const COMMON_START = { name:'栗山', kana:'くりやま', roma:'Kuriyama' };

const ROUTES = {
  iwamizawa: [COMMON_START, ...BRANCH_IWAMIZAWA, ...COMMON],
  oiwake   : [COMMON_START, ...BRANCH_OIWAKE,    ...COMMON],
};

const GOALS = {
  iwamizawa: ROUTES.iwamizawa.length - 1,
  oiwake   : ROUTES.oiwake.length - 1,
};

const MAX_PLAYERS = 5;
const CPU_WAIT    = 6500;

/* ---- ゲーム状態 ------------------------------------------------------- */
let players       = new Array(MAX_PLAYERS).fill(null);
let currentTurn   = -1;
let started       = false;
let finished      = false;
let finishedCount = 0;
let seqCounter    = 0;

function makePlayer(seat, name, routeKey, isCPU, socketId) {
  return {
    seat, name, routeKey,
    isCPU: !!isCPU,
    socketId: socketId || null,
    pos: 0,
    locked: true,
    finishedFlag: false,
    rank: 0,
    seq: ++seqCounter,
  };
}

function seatedPlayers() { return players.filter(p => p !== null); }
function seatOrder() {
  const arr = [];
  for (let i = 0; i < MAX_PLAYERS; i++) if (players[i]) arr.push(i);
  return arr;
}

/* ---- 状態ブロードキャスト -------------------------------------------- */
function broadcastState() {
  const seats = players.map((p, seat) => {
    if (!p) return { seat, occupied:false };
    return {
      seat, occupied:true,
      name: p.name, routeKey: p.routeKey, isCPU: p.isCPU,
      pos: p.pos, stationName: ROUTES[p.routeKey][p.pos].name,
      finishedFlag: p.finishedFlag, rank: p.rank,
    };
  });
  io.emit('state', {
    seats, currentTurn, started, finished, finishedCount,
    routes: { iwamizawa: ROUTES.iwamizawa, oiwake: ROUTES.oiwake,
              goals: GOALS, commonStartIndex: 0 },
  });
}

/* ---- リセット --------------------------------------------------------- */
function resetGame() {
  for (const p of seatedPlayers()) { p.pos=0; p.finishedFlag=false; p.rank=0; }
  currentTurn = -1; started = false; finished = false; finishedCount = 0;
  broadcastState();
}

/* ---- ゲーム開始 ------------------------------------------------------- */
function startGame() {
  if (started) return;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (!players[seat]) {
      const routeKey = (seat % 2 === 0) ? 'iwamizawa' : 'oiwake';
      players[seat] = makePlayer(seat, `CPU${seat + 1}`, routeKey, true, null);
    }
  }
  for (const p of seatedPlayers()) { p.pos=0; p.finishedFlag=false; p.rank=0; }
  started = true; finished = false; finishedCount = 0;
  const order = seatOrder();
  currentTurn = order.length ? order[0] : -1;
  broadcastState();
  notifyTurn();
  maybeRunCPU();
}

/* ---- 手番通知（自分の番の人にだけ your_turn） ----------------------- */
function notifyTurn() {
  if (currentTurn < 0) return;
  const p = players[currentTurn];
  if (!p) return;
  if (!p.isCPU && p.socketId) io.to(p.socketId).emit('event', { type:'your_turn' });
}

/* ---- 手番送り --------------------------------------------------------- */
function advanceTurn() {
  const remain = seatOrder().filter(seat => !players[seat].finishedFlag);
  if (remain.length === 0) { finished = true; currentTurn = -1; broadcastState(); return; }
  let next = -1;
  for (let step = 1; step <= MAX_PLAYERS; step++) {
    const cand = (currentTurn + step) % MAX_PLAYERS;
    if (players[cand] && !players[cand].finishedFlag) { next = cand; break; }
  }
  currentTurn = next;
  broadcastState();
  notifyTurn();
  maybeRunCPU();
}

/* ---- ルーレット結果適用 ---------------------------------------------- */
function applyRoll(seat, value) {
  if (!started || finished) return;
  if (seat !== currentTurn) return;
  const p = players[seat];
  if (!p || p.finishedFlag) return;

  const goalIdx = GOALS[p.routeKey];
  let np = p.pos + value;
  if (np >= goalIdx) np = goalIdx;
  p.pos = np;

  io.emit('event', { type:'move' });

  if (p.pos >= goalIdx) {
    p.finishedFlag = true;
    finishedCount += 1;
    p.rank = finishedCount;
    const totalSeated = seatedPlayers().length;
    if (finishedCount >= totalSeated) {
      io.emit('event', { type:'goal' });
      io.emit('event', { type:'gameover' });
      finished = true;
    } else {
      io.emit('event', { type:'rank', rank:p.rank });
    }
  }

  broadcastState();
  if (!finished) advanceTurn();
  else { currentTurn = -1; broadcastState(); }
}

/* ---- CPU 自動進行 ----------------------------------------------------- */
function maybeRunCPU() {
  if (!started || finished || currentTurn < 0) return;
  const p = players[currentTurn];
  if (!p || !p.isCPU || p.finishedFlag) return;
  setTimeout(() => {
    if (!started || finished || currentTurn < 0) return;
    const cur = players[currentTurn];
    if (!cur || !cur.isCPU || cur.finishedFlag) return;
    const value = 1 + Math.floor(Math.random() * 6);
    io.emit('cpuRoll', { seat:currentTurn, value });
    applyRoll(currentTurn, value);
  }, CPU_WAIT);
}

/* ---- Socket.IO（既定名前空間） -------------------------------------- */
io.on('connection', (socket) => {
  broadcastState();

  socket.on('joinSeat', ({ seat, name, routeKey }) => {
    if (started) return;
    seat = Number(seat);
    if (!(seat >= 0 && seat < MAX_PLAYERS)) return;
    if (players[seat]) return;
    if (!name || !String(name).trim()) return;
    if (routeKey !== 'iwamizawa' && routeKey !== 'oiwake') return;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) players[i] = null;
    }
    players[seat] = makePlayer(seat, String(name).trim(), routeKey, false, socket.id);
    broadcastState();
  });

  socket.on('leaveSeat', () => {
    if (started) return;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) players[i] = null;
    }
    broadcastState();
  });

  socket.on('start', () => {
    io.emit('event', { type:'start' });
    startGame();
  });

  socket.on('roll', ({ value }) => {
    let seat = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) { seat = i; break; }
    }
    if (seat < 0) return;
    const v = Number(value);
    if (!(v >= 1 && v <= 6)) return;
    applyRoll(seat, v);
  });

  socket.on('reset', () => {
    io.emit('event', { type:'reset' });
    resetGame();
  });

  socket.on('disconnect', () => {
    let changed = false;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) {
        if (started) {
          players[i].isCPU = true; players[i].socketId = null; changed = true;
          if (currentTurn === i) maybeRunCPU();
        } else {
          players[i] = null; changed = true;
        }
      }
    }
    if (changed) broadcastState();
  });
});

/* ---- 起動 ------------------------------------------------------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[sugoroku] server.js v4.0 listening on ${PORT}  (2026-06-21 11:13 JST)`);
});
