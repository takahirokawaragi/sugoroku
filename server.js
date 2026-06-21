/* =======================================================================
 * games-kawaragi  統合サーバー  server.js
 * Version: v3.9
 * Date   : 2026-06-21（日）11:00 JST
 * -----------------------------------------------------------------------
 * 七並べ /7/ ・ すごろく /sugoroku/ ・ ビンゴ /bingo/ 統合
 * すごろくの席管理を「座席番号で着席・ロックする方式(joinSeat)」で運用。
 * 名前混入バグ(隣の席に同じ名前が入る/確定後も他席に書ける)を根絶。
 * 音声イベントは 'event' チャンネルで全端末同時配信。
 *   start / reset / move / goal / gameover / rank / your_turn
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

/* =======================================================================
 *  すごろく  ロジック  (namespace: /sugoroku)
 * ======================================================================= */

// ---- 路線データ（駅名・ふりがな・ローマ字） --------------------------
// 岩見沢ルート（栗山→栗丘→…→白石）
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

// 追分ルート（栗山→由仁→…→白石）
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

// 共通区間（白石→…→札幌＝ゴール）
const COMMON = [
  { name:'白石',   kana:'しろいし',   roma:'Shiroishi' },
  { name:'平和',   kana:'へいわ',     roma:'Heiwa'     },
  { name:'苗穂',   kana:'なえぼ',     roma:'Naebo'     },
  { name:'札幌',   kana:'さっぽろ',   roma:'Sapporo'   },
];

// 起点（両ルート共通の出発駅＝栗山。単一の駅オブジェクトとして1つだけ持つ）
const COMMON_START = { name:'栗山', kana:'くりやま', roma:'Kuriyama' };

// ルート定義：起点(栗山) + 各分岐 + 共通区間
const ROUTES = {
  iwamizawa: [COMMON_START, ...BRANCH_IWAMIZAWA, ...COMMON],
  oiwake   : [COMMON_START, ...BRANCH_OIWAKE,    ...COMMON],
};

// ゴールインデックス（各ルートの最終駅＝札幌）
const GOALS = {
  iwamizawa: ROUTES.iwamizawa.length - 1,
  oiwake   : ROUTES.oiwake.length - 1,
};

const MAX_PLAYERS = 5;
const CPU_WAIT    = 6500; // CPU自動ロール遅延(ms)

/* ---- ゲーム状態 -------------------------------------------------------- */
// players は seat 番号(0..4)の固定スロット配列。null=空席。
let players       = new Array(MAX_PLAYERS).fill(null);
let currentTurn   = -1;     // 現在の手番 seat 番号
let started       = false;
let finished      = false;
let finishedCount = 0;
let seqCounter    = 0;

function makePlayer(seat, name, routeKey, isCPU, socketId) {
  return {
    seat,
    name,
    routeKey,                 // 'iwamizawa' | 'oiwake'
    isCPU: !!isCPU,
    socketId: socketId || null,
    pos: 0,                   // ルート上のインデックス(0=栗山)
    locked: true,             // 着席=ロック
    finishedFlag: false,
    rank: 0,                  // 着順(1..5)。0=未ゴール
    seq: ++seqCounter,
  };
}

function seatedPlayers() {
  return players.filter(p => p !== null);
}

// 着席している(=null以外)プレイヤーの seat 番号を昇順で返す
function seatOrder() {
  const arr = [];
  for (let i = 0; i < MAX_PLAYERS; i++) if (players[i]) arr.push(i);
  return arr;
}

/* ---- 状態ブロードキャスト -------------------------------------------- */
function broadcastState(nsp) {
  const seats = players.map((p, seat) => {
    if (!p) return { seat, occupied:false };
    return {
      seat,
      occupied: true,
      name: p.name,
      routeKey: p.routeKey,
      isCPU: p.isCPU,
      pos: p.pos,
      stationName: ROUTES[p.routeKey][p.pos].name,
      finishedFlag: p.finishedFlag,
      rank: p.rank,
    };
  });

  nsp.emit('state', {
    seats,
    currentTurn,            // seat 番号
    started,
    finished,
    finishedCount,
    routes: {               // クライアント描画用にルート定義も送る
      iwamizawa: ROUTES.iwamizawa,
      oiwake   : ROUTES.oiwake,
      goals    : GOALS,
      commonStartIndex: 0,
    },
  });
}

/* ---- リセット --------------------------------------------------------- */
function clearAll() {
  players       = new Array(MAX_PLAYERS).fill(null);
  currentTurn   = -1;
  started       = false;
  finished      = false;
  finishedCount = 0;
}

function resetGame(nsp) {
  // 着席情報(席ロック)は維持し、進行状態だけ初期化する
  for (const p of seatedPlayers()) {
    p.pos          = 0;
    p.finishedFlag = false;
    p.rank         = 0;
  }
  currentTurn   = -1;
  started       = false;
  finished      = false;
  finishedCount = 0;
  broadcastState(nsp);
}

/* ---- ゲーム開始 ------------------------------------------------------- */
function startGame(nsp) {
  if (started) return;

  // 空席を CPU で補充（最大5名まで）
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (!players[seat]) {
      const routeKey = (seat % 2 === 0) ? 'iwamizawa' : 'oiwake';
      players[seat] = makePlayer(seat, `CPU${seat + 1}`, routeKey, true, null);
    }
  }

  // 状態初期化
  for (const p of seatedPlayers()) {
    p.pos          = 0;
    p.finishedFlag = false;
    p.rank         = 0;
  }

  started       = true;
  finished      = false;
  finishedCount = 0;

  // 最初の手番＝着席順の先頭 seat
  const order = seatOrder();
  currentTurn = order.length ? order[0] : -1;

  broadcastState(nsp);
  notifyTurn(nsp);
  maybeRunCPU(nsp);
}

/* ---- 手番通知（自分の番の人にだけ your_turn を鳴らす） -------------- */
function notifyTurn(nsp) {
  if (currentTurn < 0) return;
  const p = players[currentTurn];
  if (!p) return;
  if (!p.isCPU && p.socketId) {
    nsp.to(p.socketId).emit('event', { type:'your_turn' });
  }
}

/* ---- 手番送り --------------------------------------------------------- */
function advanceTurn(nsp) {
  const order = seatOrder().filter(seat => !players[seat].finishedFlag);
  if (order.length === 0) {
    finished = true;
    currentTurn = -1;
    broadcastState(nsp);
    return;
  }

  let next = -1;
  for (let step = 1; step <= MAX_PLAYERS; step++) {
    const cand = (currentTurn + step) % MAX_PLAYERS;
    if (players[cand] && !players[cand].finishedFlag) { next = cand; break; }
  }
  currentTurn = next;
  broadcastState(nsp);
  notifyTurn(nsp);
  maybeRunCPU(nsp);
}

/* ---- サイコロ(ルーレット)結果適用 ------------------------------------ */
function applyRoll(nsp, seat, value) {
  if (!started || finished) return;
  if (seat !== currentTurn) return;
  const p = players[seat];
  if (!p || p.finishedFlag) return;

  const goalIdx = GOALS[p.routeKey];
  let np = p.pos + value;
  if (np >= goalIdx) np = goalIdx; // 到達でゴール
  p.pos = np;

  // コマ移動音
  nsp.emit('event', { type:'move' });

  // ゴール判定
  if (p.pos >= goalIdx) {
    p.finishedFlag = true;
    finishedCount += 1;
    p.rank = finishedCount;

    const totalSeated = seatedPlayers().length;
    if (finishedCount >= totalSeated) {
      // 最後のプレイヤーがゴール → goal + gameover を同時
      nsp.emit('event', { type:'goal' });
      nsp.emit('event', { type:'gameover' });
      finished = true;
    } else {
      // 1〜4位 → rank
      nsp.emit('event', { type:'rank', rank:p.rank });
    }
  }

  broadcastState(nsp);

  if (!finished) {
    advanceTurn(nsp);
  } else {
    currentTurn = -1;
    broadcastState(nsp);
  }
}

/* ---- CPU 自動進行 ----------------------------------------------------- */
function maybeRunCPU(nsp) {
  if (!started || finished) return;
  if (currentTurn < 0) return;
  const p = players[currentTurn];
  if (!p || !p.isCPU || p.finishedFlag) return;

  setTimeout(() => {
    if (!started || finished) return;
    if (currentTurn < 0) return;
    const cur = players[currentTurn];
    if (!cur || !cur.isCPU || cur.finishedFlag) return;
    const value = 1 + Math.floor(Math.random() * 6);
    nsp.emit('cpuRoll', { seat:currentTurn, value });
    applyRoll(nsp, currentTurn, value);
  }, CPU_WAIT);
}

/* ---- Socket.IO  /sugoroku ------------------------------------------- */
const sugoroku = io.of('/sugoroku');

sugoroku.on('connection', (socket) => {
  // 接続直後に現状を送る
  broadcastState(sugoroku);

  // 着席：座席番号・名前・ルートを同時に確定（席ロック方式）
  socket.on('joinSeat', ({ seat, name, routeKey }) => {
    if (started) return; // ゲーム中は着席不可
    seat = Number(seat);
    if (!(seat >= 0 && seat < MAX_PLAYERS)) return;
    if (players[seat]) return;            // 既に使用中 → 拒否
    if (!name || !String(name).trim()) return;
    if (routeKey !== 'iwamizawa' && routeKey !== 'oiwake') return;

    // 同一ソケットが既に他席に座っていれば、その席を空ける（席替え）
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) players[i] = null;
    }

    players[seat] = makePlayer(seat, String(name).trim(), routeKey, false, socket.id);
    broadcastState(sugoroku);
  });

  // 着席解除（明示的に席を立つ場合）
  socket.on('leaveSeat', () => {
    if (started) return;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) players[i] = null;
    }
    broadcastState(sugoroku);
  });

  // ゲーム開始
  socket.on('start', () => {
    sugoroku.emit('event', { type:'start' }); // start.wav を全端末で
    startGame(sugoroku);
  });

  // ルーレット結果（人間プレイヤー）
  socket.on('roll', ({ value }) => {
    let seat = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) { seat = i; break; }
    }
    if (seat < 0) return;
    const v = Number(value);
    if (!(v >= 1 && v <= 6)) return;
    applyRoll(sugoroku, seat, v);
  });

  // リセット
  socket.on('reset', () => {
    sugoroku.emit('event', { type:'reset' }); // reset.wav を全端末で
    resetGame(sugoroku);
  });

  // 切断
  socket.on('disconnect', () => {
    let changed = false;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (players[i] && players[i].socketId === socket.id) {
        if (started) {
          // ゲーム中の離脱は CPU 化して進行を止めない
          players[i].isCPU    = true;
          players[i].socketId = null;
          changed = true;
          if (currentTurn === i) {
            maybeRunCPU(sugoroku);
          }
        } else {
          players[i] = null;
          changed = true;
        }
      }
    }
    if (changed) broadcastState(sugoroku);
  });
});

/* ---- 起動 ------------------------------------------------------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[games-kawaragi] server.js v3.9 listening on ${PORT}  (2026-06-21 11:00 JST)`);
});
