/* =========================================================================
 * すごろくゲーム client.js
 * Version: v3.6
 * Date:    2026-06-19 (金) 14:55 JST
 * ---------------------------------------------------------------------------
 * v3.6 変更点:
 *   - 駅名オブジェクト {kanji,kana,romaji} から kanji を表示（[object Object]解消）
 *   - server.js v3.5 の実フィールドに合わせ修正：routeKey / isCPU を使用
 *   - コマ色を players の並び順（index）から決定
 *   - 全プレイヤー追従を moves 配列の末尾（直近の手）から判定
 *   - 駅間隔を拡大（重なり解消）／駅名一行表示／ルーレット用の左余白
 *   - LAYOUT の駅数を server.js v3.5 に一致（岩見沢14・追分21・共通17）
 * ※ server.js v3.5 / index.html v3.5 とセットで使用。
 * ========================================================================= */

const socket = io();

/* ------------------------------------------------------------------ *
 *  レイアウト定数
 * ------------------------------------------------------------------ */
const GRID_X = 150;          // 横の間隔
const GRID_Y = 120;          // 縦の間隔
const BOARD_PAD_LEFT = 280;  // 左上ルーレット用の余白
const BOARD_PAD_TOP  = 60;
const STATION_W = 96;        // 駅看板の幅（一行表示）
const STATION_H = 64;        // 看板＋コマ置き1台分

/* コマの色（players の並び順に対応） */
const PAWN_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];

/* ------------------------------------------------------------------ *
 *  駅の配置（グリッド座標）。駅数は server.js v3.5 と一致させること。
 *  栗山(pos=0)は両ルート共通。以降 分岐→共通 の順で連結。
 * ------------------------------------------------------------------ */

// 栗山（pos=0：起点・共通の1マス）
const LAYOUT_KURIYAMA = { col: 21, row: 6 };

// 岩見沢分岐 pos=1〜13（栗丘〜厚別の13駅）
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

// 追分分岐 pos=1〜20（由仁〜平和の20駅）
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

// 共通区間 pos：白石〜小樽の17駅（白石で合流）
const LAYOUT_COMMON = [
  { col: 6,  row: 5 }, // 白石（合流点）
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

/* ------------------------------------------------------------------ *
 *  座標変換・経路組み立て
 * ------------------------------------------------------------------ */
function gridToPx(cell) {
  return {
    x: BOARD_PAD_LEFT + cell.col * GRID_X,
    y: BOARD_PAD_TOP  + cell.row * GRID_Y,
  };
}

// ルートごとの全駅座標（pos 0=栗山, 以降 分岐→共通）
function buildRouteLayout(routeKey) {
  const branch = routeKey === 'iwamizawa' ? LAYOUT_IWAMIZAWA : LAYOUT_OIWAKE;
  return [LAYOUT_KURIYAMA, ...branch, ...LAYOUT_COMMON];
}

// 駅名オブジェクトから表示用文字列を取り出す（保険つき）
function stationName(st) {
  if (st == null) return '';
  if (typeof st === 'string') return st;
  return st.kanji || st.name || st.kana || st.romaji || '';
}

/* ------------------------------------------------------------------ *
 *  状態
 * ------------------------------------------------------------------ */
let myId = null;
let lastState = null;
let stationEls = {};       // key "col,row" → element
let lastMoveSeq = -1;      // 直近に追従した手番（重複追従防止）

const board   = document.getElementById('board');
const railsEl = document.getElementById('rails');

/* ------------------------------------------------------------------ *
 *  盤面サイズ算出
 * ------------------------------------------------------------------ */
function computeBoardSize() {
  const all = [LAYOUT_KURIYAMA, ...LAYOUT_IWAMIZAWA, ...LAYOUT_OIWAKE, ...LAYOUT_COMMON];
  let maxX = 0, maxY = 0;
  all.forEach((c) => {
    const p = gridToPx(c);
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  board.style.position = 'relative';
  board.style.width  = (maxX + GRID_X + STATION_W) + 'px';
  board.style.height = (maxY + GRID_Y + STATION_H) + 'px';
  if (railsEl) {
    const w = maxX + GRID_X + STATION_W;
    const h = maxY + GRID_Y + STATION_H;
    railsEl.setAttribute('width', w);
    railsEl.setAttribute('height', h);
    railsEl.style.width  = w + 'px';
    railsEl.style.height = h + 'px';
  }
}

/* ------------------------------------------------------------------ *
 *  線路を描く（斜め許容の直線）
 * ------------------------------------------------------------------ */
function drawRails() {
  if (!railsEl) return;
  railsEl.innerHTML = '';
  const cx = STATION_W / 2;
  const cy = STATION_H / 2;

  const drawLine = (a, b) => {
    const pa = gridToPx(a);
    const pb = gridToPx(b);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pa.x + cx);
    line.setAttribute('y1', pa.y + cy);
    line.setAttribute('x2', pb.x + cx);
    line.setAttribute('y2', pb.y + cy);
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

/* ------------------------------------------------------------------ *
 *  盤面の駅セルを生成（重複座標は1回だけ＝栗山・共通区間の統合）
 * ------------------------------------------------------------------ */
function buildBoard(state) {
  Array.from(board.querySelectorAll('.station')).forEach((el) => el.remove());
  stationEls = {};

  computeBoardSize();
  drawRails();

  const makeStation = (cell, name, flags) => {
    const key = cell.col + ',' + cell.row;
    if (stationEls[key]) return; // 重複描画抑制
    const p = gridToPx(cell);
    const el = document.createElement('div');
    el.className = 'station'
      + (flags.kuriyama ? ' kuriyama' : '')
      + (flags.common ? ' common' : '')
      + (flags.goal ? ' goal' : '');
    el.style.position = 'absolute';
    el.style.left = p.x + 'px';
    el.style.top  = p.y + 'px';
    el.style.width = STATION_W + 'px';

    const label = document.createElement('div');
    label.className = 'station-name';
    label.textContent = name;
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'visible';
    el.appendChild(label);

    const pawns = document.createElement('div');
    pawns.className = 'pawns';
    pawns.style.minHeight = '28px';
    el.appendChild(pawns);

    board.appendChild(el);
    stationEls[key] = el;
  };

  const routes = state.routes;            // { iwamizawa:[{kanji..}], oiwake:[...] }
  const goals  = state.goals || {};
  const cs     = state.commonStart || {};

  // 栗山（pos=0）
  makeStation(LAYOUT_KURIYAMA, stationName(routes.iwamizawa[0]), { kuriyama: true });

  // 岩見沢ルート pos=1 以降
  const iwaLayout = buildRouteLayout('iwamizawa');
  for (let i = 1; i < routes.iwamizawa.length; i++) {
    makeStation(iwaLayout[i], stationName(routes.iwamizawa[i]), {
      common: i >= cs.iwamizawa,
      goal:   i === goals.iwamizawa,
    });
  }

  // 追分ルート pos=1 以降
  const oiwLayout = buildRouteLayout('oiwake');
  for (let i = 1; i < routes.oiwake.length; i++) {
    makeStation(oiwLayout[i], stationName(routes.oiwake[i]), {
      common: i >= cs.oiwake,
      goal:   i === goals.oiwake,
    });
  }
}

/* ------------------------------------------------------------------ *
 *  コマ配置（routeKey / isCPU / index 色を使用）
 * ------------------------------------------------------------------ */
function placePawns(state) {
  Object.values(stationEls).forEach((el) => {
    const p = el.querySelector('.pawns');
    if (p) p.innerHTML = '';
  });

  state.players.forEach((pl, idx) => {
    const layout = buildRouteLayout(pl.routeKey);
    const cell = layout[pl.pos] || LAYOUT_KURIYAMA;
    const key = cell.col + ',' + cell.row;
    const el = stationEls[key];
    if (!el) return;
    const pawns = el.querySelector('.pawns');
    const pawn = document.createElement('span');
    pawn.className = 'pawn';
    pawn.style.color = PAWN_COLORS[idx % PAWN_COLORS.length];
    pawn.style.fontSize = '20px';
    pawn.style.lineHeight = '20px';
    pawn.textContent = pl.isCPU ? '🤖' : '●';
    pawn.title = pl.name + (pl.rank ? `（${pl.rank}位）` : '');
    pawns.appendChild(pawn);
  });
}

/* ------------------------------------------------------------------ *
 *  画面追従：直近に動いたプレイヤーへ全員の画面を寄せる
 *  （moves 配列の末尾の index を使う）
 * ------------------------------------------------------------------ */
function scrollToPlayerByMove(state) {
  if (!state.moves || state.moves.length === 0) return;
  const last = state.moves[state.moves.length - 1];
  if (!last || last.seq === lastMoveSeq) return; // 同じ手は再追従しない
  lastMoveSeq = last.seq;

  const pl = state.players[last.index];
  if (!pl) return;
  const layout = buildRouteLayout(pl.routeKey);
  const cell = layout[pl.pos] || LAYOUT_KURIYAMA;
  const p = gridToPx(cell);
  window.scrollTo({
    left: Math.max(0, p.x + STATION_W / 2 - window.innerWidth / 2),
    top:  Math.max(0, p.y + STATION_H / 2 - window.innerHeight / 2),
    behavior: 'smooth',
  });
}

/* ------------------------------------------------------------------ *
 *  状態反映
 * ------------------------------------------------------------------ */
function render(state) {
  if (!lastState) buildBoard(state);
  lastState = state;

  placePawns(state);
  scrollToPlayerByMove(state);
  updatePanel(state);
}

function updatePanel(state) {
  const turnEl = document.getElementById('turn-info');
  if (turnEl) {
    if (state.finished) {
      turnEl.textContent = 'ゲーム終了！';
    } else if (state.started) {
      const cur = state.players[state.currentTurn];
      turnEl.textContent = cur ? `${cur.name} の番です` : '';
    } else {
      turnEl.textContent = '参加者を待っています';
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Socket イベント（server.js v3.5 のイベント名に合わせる）
 * ------------------------------------------------------------------ */
socket.on('connect', () => { myId = socket.id; });
socket.on('state', (state) => { render(state); });
socket.on('joined', () => {});
socket.on('rejected', (msg) => { alert(msg || '参加できませんでした'); });
socket.on('resetReady', () => { lastState = null; lastMoveSeq = -1; });

/* ------------------------------------------------------------------ *
 *  UI 操作（setName / setRoute / start / roll / reset）
 * ------------------------------------------------------------------ */
function bindUI() {
  const nameInput  = document.getElementById('name-input');
  const setNameBtn = document.getElementById('set-name');
  const startBtn   = document.getElementById('start-btn');
  const rollBtn    = document.getElementById('roll-btn');
  const resetBtn   = document.getElementById('reset-btn');
  const routeRadios = document.querySelectorAll('input[name="route"]');

  if (setNameBtn) setNameBtn.addEventListener('click', () => {
    const n = (nameInput && nameInput.value || '').trim();
    if (n) socket.emit('setName', n);
  });
  routeRadios.forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) socket.emit('setRoute', r.value); });
  });
  if (startBtn) startBtn.addEventListener('click', () => socket.emit('start'));
  if (rollBtn)  rollBtn.addEventListener('click',  () => socket.emit('roll'));
  if (resetBtn) resetBtn.addEventListener('click', () => socket.emit('reset'));
}

document.addEventListener('DOMContentLoaded', bindUI);
