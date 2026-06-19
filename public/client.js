/* =========================================================================
 * すごろくゲーム client.js
 * Version: v3.6.1
 * Date:    2026-06-19 (金) 15:04 JST
 * ---------------------------------------------------------------------------
 * v3.6.1 変更点（v3.6 の作り直し）:
 *   - index.html v3.5 の構造に完全準拠：
 *       駅セル = .cell（.stSign/.stKanji/.stKana/.stBand/.stRomaji）
 *       コマ   = .train（721系風・進行方向で .flip）
 *       ルーレット = <canvas id="wheel"> に円盤を描画＆回転
 *       ボタン id = nameBtn/startBtn/rollBtn/resetBtn/routeOiwakeBtn/routeIwamizawaBtn
 *   - 駅名は {kanji,kana,romaji} オブジェクトから表示
 *   - 絶対座標配置・SVG線路（斜め許容）・栗山/共通の重複描画抑制
 *   - 全プレイヤー追従（moves 末尾の手番へ全員の画面を寄せる）
 *   - server.js v3.5 のフィールド（routeKey/isCPU/pos/rank）に準拠
 * ※ server.js v3.5 / index.html v3.5 とセットで使用。
 * ========================================================================= */

const socket = io();

/* ====================== レイアウト定数 ====================== */
const GRID_X = 150;
const GRID_Y = 120;
const BOARD_PAD_LEFT = 60;   // ルーレットは固定パネルで盤面と重なってOK（左余白は最小）
const BOARD_PAD_TOP  = 60;
const CELL_W = 84;           // index.html の .cell 幅に合わせる
const CELL_H = 120;          // 看板＋コマ置きのおおよその高さ

/* ====================== 駅レイアウト（座標） ======================
 * 駅数は server.js v3.5 と一致：
 *   岩見沢分岐 = 栗山 + 13駅
 *   追分分岐   = 栗山 + 20駅
 *   共通       = 17駅
 * 栗山(pos=0)は両ルート共通。以降 分岐→共通 の順。
 * ============================================================= */
const LAYOUT_KURIYAMA = { col: 21, row: 6 };

const LAYOUT_IWAMIZAWA = [
  { col: 20, row: 4 }, // 栗丘
  { col: 19, row: 3 }, // 栗沢
  { col: 18, row: 2 }, // 志文
  { col: 17, row: 2 }, // 岩見沢
  { col: 16, row: 2 }, // 上幌向
  { col: 15, row: 2 }, // 幌向
  { col: 14, row: 2 }, // 豊幌
  { col: 13, row: 3 }, // 江別
  { col: 12, row: 3 }, // 高砂
  { col: 11, row: 3 }, // 野幌
  { col: 10, row: 3 }, // 大麻
  { col: 9,  row: 4 }, // 森林公園
  { col: 8,  row: 4 }, // 厚別
];

const LAYOUT_OIWAKE = [
  { col: 20, row: 8 },  // 由仁
  { col: 19, row: 9 },  // 古山
  { col: 18, row: 9 },  // 三川
  { col: 17, row: 9 },  // 追分
  { col: 16, row: 10 }, // 安平
  { col: 15, row: 10 }, // 早来
  { col: 14, row: 10 }, // 遠浅
  { col: 13, row: 11 }, // 沼ノ端
  { col: 12, row: 11 }, // 植苗
  { col: 11, row: 11 }, // 南千歳
  { col: 10, row: 10 }, // 千歳
  { col: 9,  row: 10 }, // 長都
  { col: 9,  row: 9 },  // サッポロビール庭園
  { col: 9,  row: 8 },  // 恵庭
  { col: 9,  row: 7 },  // 恵み野
  { col: 8,  row: 7 },  // 島松
  { col: 8,  row: 6 },  // 北広島
  { col: 8,  row: 5 },  // 上野幌
  { col: 7,  row: 5 },  // 新札幌
  { col: 7,  row: 6 },  // 平和
];

const LAYOUT_COMMON = [
  { col: 6,  row: 5 }, // 白石（合流）
  { col: 5,  row: 5 }, // 苗穂
  { col: 4,  row: 5 }, // 札幌
  { col: 4,  row: 4 }, // 桑園
  { col: 4,  row: 3 }, // 琴似
  { col: 3,  row: 3 }, // 発寒中央
  { col: 3,  row: 2 }, // 発寒
  { col: 2,  row: 2 }, // 稲積公園
  { col: 2,  row: 1 }, // 手稲
  { col: 1,  row: 1 }, // 稲穂
  { col: 1,  row: 0 }, // 星置
  { col: 0,  row: 0 }, // ほしみ
  { col: 0,  row: 1 }, // 銭函
  { col: 0,  row: 2 }, // 朝里
  { col: 0,  row: 3 }, // 小樽築港
  { col: 0,  row: 4 }, // 南小樽
  { col: 0,  row: 5 }, // 小樽（ゴール）
];

/* コマの帯色（players の並び順） */
const BAND_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];

/* ====================== ユーティリティ ====================== */
function gridToPx(cell) {
  return { x: BOARD_PAD_LEFT + cell.col * GRID_X, y: BOARD_PAD_TOP + cell.row * GRID_Y };
}
function buildRouteLayout(routeKey) {
  const branch = routeKey === 'iwamizawa' ? LAYOUT_IWAMIZAWA : LAYOUT_OIWAKE;
  return [LAYOUT_KURIYAMA, ...branch, ...LAYOUT_COMMON];
}
function st(obj, key) { return (obj && obj[key]) ? obj[key] : ''; }

/* ====================== 状態 ====================== */
let myId = null;
let lastState = null;
let stationEls = {};
let lastMoveSeq = -1;
let isSpinning = false;

const board   = document.getElementById('board');
const railsEl = document.getElementById('rails');
const wheel   = document.getElementById('wheel');

/* ====================== ルーレット描画 ====================== */
function drawWheel(highlight) {
  if (!wheel) return;
  const ctx = wheel.getContext('2d');
  const W = wheel.width, H = wheel.height;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 4;
  ctx.clearRect(0, 0, W, H);
  const N = 10;
  const colors = ['#ffcf5c', '#ff9f40', '#7ec8e3', '#9ad36a', '#f283b6',
                  '#ffcf5c', '#ff9f40', '#7ec8e3', '#9ad36a', '#f283b6'];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / N) * 2 * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 数字
    const am = (a0 + a1) / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(am) * r * 0.66, cy + Math.sin(am) * r * 0.66);
    ctx.rotate(am + Math.PI / 2);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 0, 0);
    ctx.restore();
  }
  // 中心
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, 2 * Math.PI);
  ctx.fillStyle = '#1b3a5b';
  ctx.fill();
}

/* dice(1-10) が上（ポインタ位置）に来る角度へ回す */
function spinWheelTo(dice) {
  if (!wheel) return;
  const N = 10;
  const idx = dice - 1;
  // セグメント中央が真上(-90度=ポインタ)に来る回転量
  const segCenter = (idx + 0.5) / N * 360; // 度（時計回り、0が真上）
  const turns = 5; // 余分に回す
  const target = turns * 360 + (360 - segCenter);
  wheel.style.transition = 'transform 4s cubic-bezier(0.15,0.85,0.2,1)';
  wheel.style.transform = `rotate(${target}deg)`;
}

/* ====================== 盤面サイズ ====================== */
function computeBoardSize() {
  const all = [LAYOUT_KURIYAMA, ...LAYOUT_IWAMIZAWA, ...LAYOUT_OIWAKE, ...LAYOUT_COMMON];
  let maxX = 0, maxY = 0;
  all.forEach((c) => {
    const p = gridToPx(c);
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  board.style.width  = (maxX + GRID_X + CELL_W) + 'px';
  board.style.height = (maxY + GRID_Y + CELL_H) + 'px';
  if (railsEl) {
    const w = maxX + GRID_X + CELL_W, h = maxY + GRID_Y + CELL_H;
    railsEl.setAttribute('width', w);
    railsEl.setAttribute('height', h);
    railsEl.style.width = w + 'px';
    railsEl.style.height = h + 'px';
  }
}

/* ====================== 線路 ====================== */
function drawRails() {
  if (!railsEl) return;
  railsEl.innerHTML = '';
  const cx = CELL_W / 2, cy = 30;
  const drawLine = (a, b) => {
    const pa = gridToPx(a), pb = gridToPx(b);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pa.x + cx); line.setAttribute('y1', pa.y + cy);
    line.setAttribute('x2', pb.x + cx); line.setAttribute('y2', pb.y + cy);
    line.setAttribute('stroke', '#7a5230');
    line.setAttribute('stroke-width', '6');
    line.setAttribute('stroke-linecap', 'round');
    railsEl.appendChild(line);
  };
  const iwa = buildRouteLayout('iwamizawa');
  for (let i = 0; i < iwa.length - 1; i++) drawLine(iwa[i], iwa[i + 1]);
  const oiw = buildRouteLayout('oiwake');
  for (let i = 0; i < oiw.length - 1; i++) drawLine(oiw[i], oiw[i + 1]);
}

/* ====================== 駅看板セル生成 ====================== */
function makeCellEl(cell, stObj, flags) {
  const p = gridToPx(cell);
  const el = document.createElement('div');
  el.className = 'cell'
    + (flags.start ? ' start' : '')
    + (flags.goal ? ' goal' : '');
  el.style.left = p.x + 'px';
  el.style.top  = p.y + 'px';

  const kanji = st(stObj, 'kanji');
  const kana  = st(stObj, 'kana');
  const romaji = st(stObj, 'romaji');
  if (kanji.length >= 5 || romaji.length >= 12) el.classList.add('longName');

  if (flags.start || flags.goal) {
    const tag = document.createElement('div');
    tag.className = 'stTag';
    tag.textContent = flags.start ? 'スタート' : 'ゴール';
    el.appendChild(tag);
  }

  const sign = document.createElement('div');
  sign.className = 'stSign';
  sign.innerHTML =
    `<div class="stKanji">${kanji}</div>` +
    `<div class="stKana">${kana}</div>` +
    `<div class="stBand"><div class="stRomaji">${romaji}</div></div>`;
  el.appendChild(sign);

  const pawns = document.createElement('div');
  pawns.className = 'pawns';
  el.appendChild(pawns);

  return el;
}

function buildBoard(state) {
  Array.from(board.querySelectorAll('.cell')).forEach((el) => el.remove());
  stationEls = {};
  computeBoardSize();
  drawRails();

  const routes = state.routes;
  const goals  = state.goals || {};
  const cs     = state.commonStart || {};

  const place = (cell, stObj, flags) => {
    const key = cell.col + ',' + cell.row;
    if (stationEls[key]) return;
    const el = makeCellEl(cell, stObj, flags);
    board.appendChild(el);
    stationEls[key] = el;
  };

  // 栗山（pos=0：スタート）
  place(LAYOUT_KURIYAMA, routes.iwamizawa[0], { start: true });

  // 岩見沢ルート
  const iwaL = buildRouteLayout('iwamizawa');
  for (let i = 1; i < routes.iwamizawa.length; i++) {
    place(iwaL[i], routes.iwamizawa[i], { goal: i === goals.iwamizawa, common: i >= cs.iwamizawa });
  }
  // 追分ルート
  const oiwL = buildRouteLayout('oiwake');
  for (let i = 1; i < routes.oiwake.length; i++) {
    place(oiwL[i], routes.oiwake[i], { goal: i === goals.oiwake, common: i >= cs.oiwake });
  }
}

/* ====================== 電車コマ生成 ====================== */
function makeTrain(player, idx, facingLeft) {
  const wrap = document.createElement('div');
  wrap.className = 'pawnWrap';

  const train = document.createElement('div');
  train.className = 'train' + (facingLeft ? ' flip' : '');
  train.style.setProperty('--bandColor', BAND_COLORS[idx % BAND_COLORS.length]);
  train.innerHTML =
    '<div class="trainBody">' +
      '<div class="trainRoof"></div>' +
      '<div class="trainWindows">' +
        '<span class="cab"></span><span></span><span class="door"></span>' +
        '<span></span><span class="door"></span><span></span><span class="cab"></span>' +
      '</div>' +
      '<div class="trainBand"></div>' +
    '</div>' +
    '<div class="trainSkirt"></div>' +
    '<div class="trainWheels"><i></i><i></i></div>';
  wrap.appendChild(train);

  const name = document.createElement('div');
  name.className = 'pawnName';
  name.textContent = player.name + (player.rank ? `(${player.rank}位)` : '');
  wrap.appendChild(name);

  return wrap;
}

/* ====================== コマ配置 ====================== */
function placePawns(state) {
  Object.values(stationEls).forEach((el) => {
    const p = el.querySelector('.pawns');
    if (p) p.innerHTML = '';
  });

  state.players.forEach((pl, idx) => {
    const layout = buildRouteLayout(pl.routeKey);
    const cell = layout[pl.pos] || LAYOUT_KURIYAMA;
    // 進行方向：1つ前の駅より左へ向かっていれば左向き
    let facingLeft = true;
    if (pl.pos > 0) {
      const prev = layout[pl.pos - 1] || cell;
      facingLeft = cell.col <= prev.col;
    }
    const key = cell.col + ',' + cell.row;
    const el = stationEls[key];
    if (!el) return;
    el.querySelector('.pawns').appendChild(makeTrain(pl, idx, facingLeft));
  });
}

/* ====================== 全員追従 ====================== */
function scrollToLastMover(state) {
  if (!state.moves || state.moves.length === 0) return;
  const last = state.moves[state.moves.length - 1];
  if (!last || last.seq === lastMoveSeq) return;
  lastMoveSeq = last.seq;

  // 動いたプレイヤーのルーレットを回す演出（全員の画面で）
  if (typeof last.dice === 'number') {
    isSpinning = true;
    spinWheelTo(last.dice);
    setTimeout(() => { isSpinning = false; }, 4100);
  }

  const pl = state.players[last.index];
  if (!pl) return;
  const layout = buildRouteLayout(pl.routeKey);
  const cell = layout[pl.pos] || LAYOUT_KURIYAMA;
  const p = gridToPx(cell);
  const scroller = document.querySelector('.boardScroll');
  if (scroller) {
    scroller.scrollTo({
      left: Math.max(0, p.x + CELL_W / 2 - scroller.clientWidth / 2),
      top:  Math.max(0, p.y + CELL_H / 2 - scroller.clientHeight / 2),
      behavior: 'smooth',
    });
  }
}

/* ====================== パネル更新 ====================== */
function updatePanel(state) {
  const status = document.getElementById('status');
  const playersEl = document.getElementById('players');
  const rollBtn = document.getElementById('rollBtn');
  const startBtn = document.getElementById('startBtn');

  if (status) {
    if (state.finished) status.textContent = 'ゲーム終了！';
    else if (state.started) {
      const cur = state.players[state.currentTurn];
      status.textContent = cur ? `${cur.name} の番です` : '';
    } else status.textContent = '参加者を待っています';
  }

  if (playersEl) {
    playersEl.innerHTML = state.players.map((p, i) => {
      const color = BAND_COLORS[i % BAND_COLORS.length];
      const mark = p.isCPU ? '🤖' : '●';
      const turn = (state.started && !state.finished && i === state.currentTurn) ? ' ◀' : '';
      const rank = p.rank ? `（${p.rank}位）` : '';
      return `<div style="color:${color}">${mark} ${p.name}${rank}${turn}</div>`;
    }).join('');
  }

  // 自分の番だけロール可能に
  if (rollBtn) {
    const cur = state.players[state.currentTurn];
    const myTurn = state.started && !state.finished && cur && cur.id === myId && !isSpinning;
    rollBtn.disabled = !myTurn;
  }
  if (startBtn) startBtn.disabled = state.started;

  // 結果表示
  const result = document.getElementById('result');
  if (result) {
    if (state.finished) {
      const ranked = [...state.players].filter(p => p.rank > 0).sort((a, b) => a.rank - b.rank);
      result.innerHTML = '<h2>結果発表</h2>' +
        ranked.map(p => `${p.rank}位　${p.name}`).join('<br>');
      result.classList.add('show');
    } else {
      result.classList.remove('show');
    }
  }
}

/* ====================== レンダリング ====================== */
function render(state) {
  if (!lastState) buildBoard(state);
  lastState = state;
  placePawns(state);
  scrollToLastMover(state);
  updatePanel(state);
}

/* ====================== Socket ====================== */
socket.on('connect', () => { myId = socket.id; });
socket.on('state', (state) => { render(state); });
socket.on('joined', (id) => { myId = id; });
socket.on('rejected', (msg) => { alert(msg || '参加できませんでした'); });
socket.on('resetReady', () => {
  lastState = null; lastMoveSeq = -1; isSpinning = false;
  if (wheel) { wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)'; }
  const result = document.getElementById('result');
  if (result) result.classList.remove('show');
});

/* ====================== UI ====================== */
function setSelectedRoute(key) {
  const o = document.getElementById('routeOiwakeBtn');
  const i = document.getElementById('routeIwamizawaBtn');
  if (o) o.classList.toggle('selected', key === 'oiwake');
  if (i) i.classList.toggle('selected', key === 'iwamizawa');
}

function bindUI() {
  const nameBtn = document.getElementById('nameBtn');
  const nameInput = document.getElementById('nameInput');
  const startBtn = document.getElementById('startBtn');
  const rollBtn = document.getElementById('rollBtn');
  const resetBtn = document.getElementById('resetBtn');
  const oiwakeBtn = document.getElementById('routeOiwakeBtn');
  const iwamizawaBtn = document.getElementById('routeIwamizawaBtn');

  if (nameBtn) nameBtn.addEventListener('click', () => {
    const n = (nameInput && nameInput.value || '').trim();
    if (n) socket.emit('setName', n);
  });
  if (oiwakeBtn) oiwakeBtn.addEventListener('click', () => {
    socket.emit('setRoute', 'oiwake'); setSelectedRoute('oiwake');
  });
  if (iwamizawaBtn) iwamizawaBtn.addEventListener('click', () => {
    socket.emit('setRoute', 'iwamizawa'); setSelectedRoute('iwamizawa');
  });
  if (startBtn) startBtn.addEventListener('click', () => socket.emit('start'));
  if (rollBtn)  rollBtn.addEventListener('click',  () => socket.emit('roll'));
  if (resetBtn) resetBtn.addEventListener('click', () => socket.emit('reset'));

  setSelectedRoute('oiwake'); // 既定
  drawWheel();
}

document.addEventListener('DOMContentLoaded', bindUI);
