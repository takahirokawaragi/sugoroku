const socket = io();

// ===== 画面の部品 =====
const nameInput = document.getElementById("nameInput");
const nameBtn   = document.getElementById("nameBtn");
const statusEl  = document.getElementById("status");
const playersEl = document.getElementById("players");
const boardEl   = document.getElementById("board");
const startBtn  = document.getElementById("startBtn");
const rollBtn   = document.getElementById("rollBtn");
const resultEl  = document.getElementById("result");
const wheel     = document.getElementById("wheel");
const ctx       = wheel.getContext("2d");

// ===== 自分のID・状態の記憶 =====
let myId = null;
let lastShownRoll = -1;   // 前回ルーレットを止めた「動いた人」の記録（二重演出ふせぎ）
let lastRollSeq = -1;     // 動いた回数の記録
let spinning = false;
let currentWheelDeg = 0;  // 今のルーレットの回転角度

// コマの色
const PAWN_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];

// ===== ルーレットの絵を描く（1〜10） =====
const WHEEL_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#ff9ff3",
  "#54a0ff", "#ee5253", "#10ac84", "#f368e0", "#576574"
];

function drawWheel() {
  const N = 10;
  const cx = 130, cy = 130, R = 125, rInner = 45;
  ctx.clearRect(0, 0, 260, 260);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
    // 扇形
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i];
    ctx.fill();
    // 数字
    const am = (a0 + a1) / 2;
    const tx = cx + Math.cos(am) * (R * 0.7);
    const ty = cy + Math.sin(am) * (R * 0.7);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(am + Math.PI / 2);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), 0, 0);
    ctx.restore();
  }
  // 中央の丸
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ddd";
  ctx.stroke();
}
drawWheel();

// ===== 音（軽い電子音） =====
let audioCtx = null;
function beep(freq, dur) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "square";
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

// ===== ルーレットを「数字 number(1〜10)」で止める =====
function spinTo(number, onDone) {
  spinning = true;
  const N = 10;
  const idx = number - 1;
  // その数字の扇形の中央が、上の矢印（真上）に来るようにする
  const segCenter = (idx + 0.5) / N * 360; // その数字の中央角度
  const turns = 5; // 5回転してから止める
  const target = turns * 360 + (360 - segCenter);
  // 今の角度から、必ず前向きに回す
  const base = currentWheelDeg - (currentWheelDeg % 360);
  currentWheelDeg = base + target;
  wheel.style.transform = "rotate(" + currentWheelDeg + "deg)";
  beep(880, 0.05);
  setTimeout(() => {
    spinning = false;
    beep(1320, 0.12);
    if (onDone) onDone();
  }, 4100);
}

// ===== 盤面を描く =====
function renderBoard(players, goal) {
  boardEl.innerHTML = "";
  for (let i = 0; i <= goal; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (i === 0) cell.classList.add("start");
    if (i === goal) cell.classList.add("goal");

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = (i === 0) ? "START" : (i === goal ? "GOAL" : i);
    cell.appendChild(num);

    const pawns = document.createElement("div");
    pawns.className = "pawns";
    players.forEach((p, idx) => {
      if (p.pos === i) {
        const wrap = document.createElement("div");
        wrap.className = "pawnWrap";
        const pawn = document.createElement("div");
        pawn.className = "pawn";
        pawn.style.background = PAWN_COLORS[idx % PAWN_COLORS.length];
        const nm = document.createElement("div");
        nm.className = "pawnName";
        nm.textContent = p.name;
        wrap.appendChild(pawn);
        wrap.appendChild(nm);
        pawns.appendChild(wrap);
      }
    });
    cell.appendChild(pawns);
    boardEl.appendChild(cell);
  }
}

// ===== プレイヤー一覧を描く =====
function renderPlayers(players, currentTurn) {
  playersEl.innerHTML = players.map((p, i) => {
    const here = (i === currentTurn) ? "▶ " : "";
    const rankTxt = (p.rank > 0) ? "（" + p.rank + "位）" : "";
    return here + p.name + "（" + p.pos + "）" + rankTxt;
  }).join("　/　");
}

// ===== サーバーからの状態 =====
socket.on("joined", (id) => { myId = id; });

socket.on("rejected", (msg) => {
  statusEl.textContent = msg;
  startBtn.disabled = true;
  rollBtn.disabled = true;
});

socket.on("state", (s) => {
  const { players, currentTurn, started, finished, goal, lastDice, lastRolledIndex } = s;

  // 盤面とプレイヤー一覧は「毎回サーバーの通り」に描く（ズレない）
  renderBoard(players, goal);
  renderPlayers(players, currentTurn);

  // 開始前
  if (!started) {
    statusEl.textContent = "名前を決めて「ゲーム開始」を押してください";
    startBtn.disabled = false;
    rollBtn.disabled = true;
    nameInput.disabled = false;
    nameBtn.disabled = false;
    return;
  }

  startBtn.disabled = true;
  nameInput.disabled = true;
  nameBtn.disabled = true;

  // 全員ゴール
  if (finished) {
    statusEl.textContent = "ゲーム終了！";
    rollBtn.disabled = true;
    const ranking = players
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.rank + "位：" + p.name)
      .join("\n");
    resultEl.textContent = "【けっか】\n" + ranking;
    return;
  }

  // 今が誰の番か
  const turnPlayer = players[currentTurn];
  const myTurn = turnPlayer && turnPlayer.id === myId;
  statusEl.textContent = "いまの番：" + (turnPlayer ? turnPlayer.name : "");
  rollBtn.disabled = !myTurn || spinning;

  // だれかが動いたら、ルーレット演出をする（サーバーの言う通りに）
  if (lastDice != null && lastRolledIndex != null) {
    // 二重演出ふせぎ：今回の「動いた目」がまだ見せていないものなら演出する
    const seq = (s.players[lastRolledIndex] ? s.players[lastRolledIndex].pos : 0) * 1000 + lastDice;
    if (!spinning && seq !== lastRollSeq) {
      lastRollSeq = seq;
      const moverName = players[lastRolledIndex] ? players[lastRolledIndex].name : "";
      rollBtn.disabled = true;
      spinTo(lastDice, () => {
        statusEl.textContent = moverName + " が " + lastDice + " を出しました";
      });
    }
  }
});

// ===== ボタン =====
nameBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (name) socket.emit("setName", name);
});

startBtn.addEventListener("click", () => {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  socket.emit("start");
});

rollBtn.addEventListener("click", () => {
  rollBtn.disabled = true;
  socket.emit("roll");
});
