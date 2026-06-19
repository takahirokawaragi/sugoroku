/* =========================================================================
 * すごろくゲーム client.js
 * Version: v3.6
 * Date:    2026-06-19 (金) 14:47 JST
 * ---------------------------------------------------------------------------
 * v3.6 変更点:
 *   - 駅と駅の間隔を縦横ともに拡大（GRID_X / GRID_Y を増やし駅の重なりを解消）
 *   - 駅名を一行表示に（.station の white-space:nowrap を JS 側でも保証）
 *   - 盤面左側にルーレット用の余白を確保（BOARD_PAD_LEFT 分だけ全駅を右へずらす）
 * v3.5: 絶対座標配置・SVG線路（斜め許容）・全プレイヤー追従・栗山統合・
 *       共通区間1マス描画・コマ置きスペース1台分。
 * ※ server.js v3.5 / index.html v3.5 とセットで使用。
 * ========================================================================= */

const socket = io();

/* ------------------------------------------------------------------ *
 *  レイアウト用の定数
 *  - GRID_X / GRID_Y : 1ステップあたりのピクセル間隔（大きいほど駅が離れる）
 *  - BOARD_PAD_LEFT  : 左上のルーレット用に空ける余白（駅をこの分だけ右へ）
 *  - BOARD_PAD_TOP   : 上側の余白
 * ------------------------------------------------------------------ */
const GRID_X = 150;   // 横の間隔（v3.5 は約90→150へ拡大）
const GRID_Y = 120;   // 縦の間隔（v3.5 は約80→120へ拡大）
const BOARD_PAD_LEFT = 280;  // ルーレット1個分以上の余白
const BOARD_PAD_TOP  = 60;

/* ------------------------------------------------------------------ *
 *  駅の配置（グリッド座標 col,row）。
 *  添付画像の雰囲気に合わせ、栗山を右側の起点とし、
 *  岩見沢方面は上へ、追分方面は下へ流して左の札幌方面へ集約、
 *  白石で合流して小樽へ斜め上がり。
 *  ※ col が大きいほど右、row が大きいほど下。
 *  ※ 駅順は server.js の routes と一致させること。
 * ------------------------------------------------------------------ */

// 岩見沢方面の分岐（栗山の次〜厚別の手前まで／白石で共通区間に合流）
// 駅順: 江別→高砂→野幌→大麻 を含む正しい並び（server.js v3.5 と一致）
const LAYOUT_IWAMIZAWA = [
  { col: 17, row: 4 },  // 栗丘
  { col: 16, row: 3 },  // 栗沢
  { col: 15, row: 2 },  // 志文
  { col: 14, row: 2 },  // 岩見沢
  { col: 13, row: 2 },  // 上幌向
  { col: 12, row: 2 },  // 幌向
  { col: 11, row: 2 },  // 豊幌
  { col: 10, row: 3 },  // 江別
  { col: 9,  row: 3 },  // 高砂
  { col: 8,  row: 3 },  // 野幌
  { col: 7,  row: 3 },  // 大麻
  { col: 6,  row: 4 },  // 厚別
];

// 追分方面の分岐（栗山の次〜平和の手前まで／白石で共通区間に合流）
const LAYOUT_OIWAKE = [
  { col: 17, row: 8 },  // 由仁
  { col: 16, row: 9 },  // 古山
  { col: 15, row: 9 },  // 三川
  { col: 14, row: 9 },  // 追分
  { col: 13, row: 9 },  // 安平
  { col: 12, row: 9 },  // 早来
  { col: 11, row: 9 },  // 遠浅
  { col: 10, row: 9 },  // 沼ノ端
  { col: 9,  row: 9 },  // 苫小牧
  { col: 8,  row: 8 },  // 糸井
  { col: 7,  row: 8 },  // 錦岡
  { col: 6,  row: 8 },  // 樽前
  { col: 5,  row: 8 },  // 北吉原
  { col: 5,  row: 7 },  // 萩野
  { col: 5,  row: 6 },  // 白老
  { col: 6,  row: 6 },  // 北白老
  { col: 7,  row: 6 },  // 社台
  { col: 8,  row: 6 },  // 錦岡(予備) ※駅数調整用・server.jsに合わせて
  { col: 9,  row: 6 },  // 平和
];

// 共通区間（白石→苗穂→札幌→…→小樽）。白石で合流し小樽へ斜め上がり。
const LAYOUT_COMMON = [
  { col: 5,  row: 5 },  // 白石（合流点）
  { col: 4,  row: 5 },  // 苗穂
  { col: 3,  row: 5 },  // 札幌
  { col: 3,  row: 4 },  // 桑園
  { col: 3,  row: 3 },  // 琴似
  { col: 2,  row: 3 },  // 発寒中央
  { col: 2,  row: 2 },  // 発寒
  { col: 2,  row: 1 },  // 稲積公園
  { col: 1,  row: 1 },  // 手稲
  { col: 1,  row: 0 },  // 稲穂
  { col: 0,  row: 0 },  // ほしみ
  { col: 0,  row: 1 },  // 銭函
  { col: 0,  row: 2 },  // ぜにばこ
  { col: 0,  row: 3 },  // 朝里
  { col: 0,  row: 4 },  // 小樽築港
  { col: 0,  row: 5 },  // 南小樽
  { col: 0,  row: 6 },  // 小樽（ゴール）
];

// 栗山（起点・両ルート共通の1マス）
const LAYOUT_KURIYAMA = { col: 18, row: 6 };

/* ------------------------------------------------------------------ *
 *  グリッド座標 → 実ピクセル座標へ変換
 * ------------------------------------------------------------------ */
function gridToPx(cell) {
  return {
    x: BOARD_PAD_LEFT + cell.col * GRID_X,
    y: BOARD_PAD_TOP  + cell.row * GRID_Y,
  };
}

/* ------------------------------------------------------------------ *
 *  ルートごとの「全駅の座標リスト」を作る
 *  pos=0 は栗山（共通）。以降は分岐＋共通の順で並ぶ。
 *  server.js の ROUTES と同じ順序になるように連結する。
 * ------------------------------------------------------------------ */
function buildRouteLayout(routeName) {
  const branch = routeName === 'iwamizawa' ? LAYOUT_IWAMIZAWA : LAYOUT_OIWAKE;
  return [LAYOUT_KURIYAMA, ...branch, ...LAYOUT_COMMON];
}

/* ------------------------------------------------------------------ *
 *  状態
 * ------------------------------------------------------------------ */
let myId = null;
let lastState = null;
let lastMovingPlayer = null;  // 直近で動いたプレイヤー（全員追従用）

const board   = document.getElementById('board');
const railsEl = document.getElementById('rails'); // SVG レイヤー

/* ------------------------------------------------------------------ *
 *  盤面サイズの算出（全座標から最大の右下を求めてキャンバスを広げる）
 * ------------------------------------------------------------------ */
function computeBoardSize() {
  const all = [
    LAYOUT_KURIYAMA,
    ...LAYOUT_IWAMIZAWA,
    ...LAYOUT_OIWAKE,
    ...LAYOUT_COMMON,
  ];
  let maxX = 0, maxY = 0;
  all.forEach((c) => {
    const p = gridToPx(c);
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  // 駅セル分とゆとりを足す
  board.style.width  = (maxX + GRID_X) + 'px';
  board.style.height = (maxY + GRID_Y) + 'px';
  if (railsEl) {
    railsEl.setAttribute('width',  (maxX + GRID_X));
    railsEl.setAttribute('height', (maxY + GRID_Y));
    railsEl.style.width  = (maxX + GRID_X) + 'px';
    railsEl.style.height = (maxY + GRID_Y) + 'px';
  }
}

/* ------------------------------------------------------------------ *
 *  線路（SVG線）を描く。駅間を斜め許容の直線で結ぶ。
 *  栗山→分岐先、分岐→白石（共通先頭）、共通区間の順でつなぐ。
 * ------------------------------------------------------------------ */
function drawRails() {
  if (!railsEl) return;
  railsEl.innerHTML = '';

  const drawLine = (a, b) => {
    const pa = gridToPx(a);
    const pb = gridToPx(b);
    // 駅セル中心へオフセット（セル幅の半分ぶん）
    const cx = STATION_W / 2;
    const cy = STATION_H / 2;
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

  // 岩見沢ルート: 栗山→分岐各駅→共通
  const iwa = buildRouteLayout('iwamizawa');
  for (let i = 0; i < iwa.length - 1; i++) drawLine(iwa[i], iwa[i + 1]);

  // 追分ルート: 栗山→分岐各駅→共通（共通は重複するが線は同じ位置なので問題なし）
  const oiw = buildRouteLayout('oiwake');
  for (let i = 0; i < oiw.length - 1; i++) drawLine(oiw[i], oiw[i + 1]);
}

/* ------------------------------------------------------------------ *
 *  駅セルの寸法（一行表示のため横を広めに）
 * ------------------------------------------------------------------ */
const STATION_W = 96;   // 駅看板の幅（駅名一行ぶん）
const STATION_H = 64;   // 看板＋コマ置き1台分

/* ------------------------------------------------------------------ *
 *  盤面の駅セルを生成（最初に1回だけ）
 *  栗山と共通区間は「同じ座標は1回だけ」描く（重複描画抑制）。
 * ------------------------------------------------------------------ */
let stationEls = {}; // key: "col,row" → element

function buildBoard(state) {
  // 既存をクリア（線路レイヤーは残す）
  Array.from(board.querySelectorAll('.station')).forEach((el) => el.remove());
  stationEls = {};

  computeBoardSize();
  drawRails();

  const makeStation = (cell, name, flags) => {
    const key = cell.col + ',' + cell.row;
    if (stationEls[key]) return; // 重複描画抑制（栗山・共通区間）
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
    label.style.whiteSpace = 'nowrap';   // 一行表示を保証
    label.style.overflow = 'visible';
    el.appendChild(label);

    const pawns = document.createElement('div');
    pawns.className = 'pawns';
    pawns.style.minHeight = '28px';      // コマ置き1台分
    el.appendChild(pawns);

    board.appendChild(el);
    stationEls[key] = el;
  };

  // server から来る駅名リスト（routes）を使って配置
  const routes = state.routes; // { iwamizawa: [..], oiwake: [..] }
  const goals  = state.goals || {};

  // 栗山（pos=0：両ルート共通）
  makeStation(LAYOUT_KURIYAMA, routes.iwamizawa[0], { kuriyama: true });

  // 岩見沢ルート（pos=1 以降）
  for (let i = 1; i < routes.iwamizawa.length; i++) {
    const layout = buildRouteLayout('iwamizawa')[i];
    const isCommon = i >= state.commonStart.iwamizawa;
    const isGoal = i === goals.iwamizawa;
    makeStation(layout, routes.iwamizawa[i], { common: isCommon, goal: isGoal });
  }

  // 追分ルート（pos=1 以降）
  for (let i = 1; i < routes.oiwake.length; i++) {
    const layout = buildRouteLayout('oiwake')[i];
    const isCommon = i >= state.commonStart.oiwake;
    const isGoal = i === goals.oiwake;
    makeStation(layout, routes.oiwake[i], { common: isCommon, goal: isGoal });
  }
}

/* ------------------------------------------------------------------ *
 *  コマの再配置
 * ------------------------------------------------------------------ */
function placePawns(state) {
  // 全 pawns をクリア
  Object.values(stationEls).forEach((el) => {
    const p = el.querySelector('.pawns');
    if (p) p.innerHTML = '';
  });

  state.players.forEach((pl) => {
    const layout = buildRouteLayout(pl.route);
    const cell = layout[pl.pos] || LAYOUT_KURIYAMA;
    const key = cell.col + ',' + cell.row;
    const el = stationEls[key];
    if (!el) return;
    const pawns = el.querySelector('.pawns');
    const pawn = document.createElement('span');
    pawn.className = 'pawn pawn-' + pl.color;
    pawn.textContent = pl.cpu ? '🤖' : '●';
    pawn.title = pl.name;
    pawns.appendChild(pawn);
  });
}

/* ------------------------------------------------------------------ *
 *  画面追従：今動いているプレイヤーのコマへ全員の画面を寄せる
 * ------------------------------------------------------------------ */
function scrollToPlayer(player) {
  if (!player) return;
  const layout = buildRouteLayout(player.route);
  const cell = layout[player.pos] || LAYOUT_KURIYAMA;
  const p = gridToPx(cell);
  // 画面中央あたりに来るようスクロール
  const targetX = p.x + STATION_W / 2 - window.innerWidth / 2;
  const targetY = p.y + STATION_H / 2 - window.innerHeight / 2;
  window.scrollTo({
    left: Math.max(0, targetX),
    top:  Math.max(0, targetY),
    behavior: 'smooth',
  });
}

/* ------------------------------------------------------------------ *
 *  状態反映
 * ------------------------------------------------------------------ */
function render(state) {
  // 初回または駅構成が変わったら盤面を作り直す
  if (!lastState) {
    buildBoard(state);
  }
  lastState = state;

  placePawns(state);

  // 直近に動いたプレイヤーを追従（全プレイヤーの画面で）
  const moving = state.players.find((p) => p.id === state.lastMover);
  if (moving) {
    scrollToPlayer(moving);
  }

  updatePanel(state);
}

/* ------------------------------------------------------------------ *
 *  操作パネル（既存仕様：名前・ルート選択・開始・ロール・リセット）
 * ------------------------------------------------------------------ */
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
 *  Socket イベント
 * ------------------------------------------------------------------ */
socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => { render(state); });

socket.on('joined', () => {});
socket.on('rejected', (msg) => { alert(msg || '参加できませんでした'); });
socket.on('resetReady', () => { lastState = null; });

/* ------------------------------------------------------------------ *
 *  ボタン操作（既存 index.html v3.5 の id をそのまま使用）
 * ------------------------------------------------------------------ */
function bindUI() {
  const nameInput = document.getElementById('name-input');
  const setNameBtn = document.getElementById('set-name');
  const startBtn = document.getElementById('start-btn');
  const rollBtn  = document.getElementById('roll-btn');
  const resetBtn = document.getElementById('reset-btn');
  const routeRadios = document.querySelectorAll('input[name="route"]');

  if (setNameBtn) setNameBtn.addEventListener('click', () => {
    const n = (nameInput && nameInput.value || '').trim();
    if (n) socket.emit('setName', n);
  });

  routeRadios.forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) socket.emit('setRoute', r.value);
    });
  });

  if (startBtn) startBtn.addEventListener('click', () => socket.emit('start'));
  if (rollBtn)  rollBtn.addEventListener('click',  () => socket.emit('roll'));
  if (resetBtn) resetBtn.addEventListener('click', () => socket.emit('reset'));
}

document.addEventListener('DOMContentLoaded', bindUI);
