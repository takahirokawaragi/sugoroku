const socket = io();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"];
const SEGMENTS = 10;

const WHEEL_COLORS = [
  "#f4d000","#f5a623","#e8731c","#e8231c","#e6007e",
  "#9b3fb5","#5b3fb5","#1c9ee8","#2e8b3f","#8bc63f",
];

let myId = null;
let goal = 40;
let busy = false;
let currentRotation = 0;
let lastWinnerShown = false;
let displayPos = {};     // 画面上の各コマの位置（演出用）
let lastSeenDiceKey = null; // 同じサイコロを二重に演出しないための目印

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const playersEl = document.getElementById("players");
const resultEl = document.getElementById("result");
const startBtn = document.getElementById("startBtn");
const rollBtn = document.getElementById("rollBtn");
const wheel = document.getElementById("wheel");
const ctx = wheel.getContext("2d");
const nameInput = document.getElementById("nameInput");
const nameBtn = document.getElementById("nameBtn");
const nameArea = document.getElementById("nameArea");

let latestState = null;

// ===== 音 =====
let audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function beep(freq, durationMs, type = "square", volume = 0.2) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq; gain.gain.value = volume;
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + durationMs / 1000);
}
let tickTimer = null;
function startTicking() {
  let interval = 60;
  const tick = () => { beep(900, 30, "square", 0.12); interval += 12; if (interval < 280) tickTimer = setTimeout(tick, interval); };
  tick();
}
function stopTicking() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }
function stopSound() { beep(660,120,"triangle",0.3); setTimeout(()=>beep(880,160,"triangle",0.3),120); }
function stepSound() { beep(1200, 60, "square", 0.2); }
function winSound() { [523,659,784,1047].forEach((n,i)=>setTimeout(()=>beep(n,200,"triangle",0.3), i*180)); }

// ===== ルーレット描画 =====
function drawWheel() {
  const size = wheel.width, r = size/2, seg = (Math.PI*2)/SEGMENTS;
  ctx.clearRect(0,0,size,size);
  ctx.beginPath(); ctx.arc(r,r,r-2,0,Math.PI*2); ctx.fillStyle="#fff"; ctx.fill();
  ctx.lineWidth=2; ctx.strokeStyle="#ccc"; ctx.stroke();
  const outerR=r-6, innerR=r*0.42;
  for (let i=0;i<SEGMENTS;i++){
    const start=i*seg-Math.PI/2, end=(i+1)*seg-Math.PI/2;
    ctx.beginPath(); ctx.arc(r,r,outerR,start,end); ctx.arc(r,r,innerR,end,start,true); ctx.closePath();
    ctx.fillStyle=WHEEL_COLORS[i]; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle="#fff"; ctx.stroke();
    ctx.save(); ctx.translate(r,r); ctx.rotate(start+seg/2);
    ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="#fff";
    ctx.font="bold 26px sans-serif"; ctx.lineWidth=3; ctx.strokeStyle="rgba(0,0,0,0.35)";
    const textR=(outerR+innerR)/2; ctx.rotate(Math.PI/2);
    ctx.strokeText(String(i+1),0,-textR+4); ctx.fillText(String(i+1),0,-textR+4);
    ctx.restore();
  }
  ctx.beginPath(); const deco=8;
  for(let i=0;i<deco;i++){const a=(Math.PI*2/deco)*i;const x=r+Math.cos(a)*innerR*0.5;const y=r+Math.sin(a)*innerR*0.5;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.closePath(); ctx.strokeStyle="#bbb"; ctx.lineWidth=2; ctx.stroke();
}
drawWheel();

function spinTo(dice, onStop) {
  ensureAudio(); startTicking();
  const seg = 360/SEGMENTS;
  currentRotation += 360*5 + (360 - (dice-1)*seg - seg/2);
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  setTimeout(()=>{ stopTicking(); stopSound(); if(onStop) setTimeout(onStop,400); }, 4000);
}

// 1歩ずつ進める
function animateSteps(idx, steps, onDone) {
  let remaining = steps;
  const stepOnce = () => {
    if (remaining <= 0) { if(onDone) onDone(); return; }
    if (displayPos[idx] < goal) displayPos[idx] += 1;
    stepSound();
    renderBoard();
    remaining -= 1;
    if (displayPos[idx] >= goal) { if(onDone) setTimeout(onDone,300); return; }
    setTimeout(stepOnce, 350);
  };
  stepOnce();
}

// ===== 名前・ボタン =====
nameBtn.addEventListener("click", () => { ensureAudio(); const n=nameInput.value.trim(); if(n) socket.emit("setName", n); });
startBtn.addEventListener("click", () => { ensureAudio(); socket.emit("start"); });
rollBtn.addEventListener("click", () => { ensureAudio(); socket.emit("roll"); });

socket.on("joined", (id) => { myId = id; });
socket.on("rejected", (msg) => { statusEl.textContent = msg; startBtn.disabled=true; rollBtn.disabled=true; });

socket.on("state", (state) => {
  latestState = state;
  goal = state.goal;

  // 初めて見るプレイヤーの表示位置を初期化
  state.players.forEach((p,i)=>{ if(displayPos[i]==null) displayPos[i]=p.pos; });

  const diceKey = state.lastRolledIndex + "-" + state.lastDice + "-" + (state.players[state.lastRolledIndex] ? state.players[state.lastRolledIndex].pos : "");

  // 新しいサイコロが出ていて、まだ演出していなければ演出する
  if (state.started && state.lastDice && state.lastRolledIndex != null && !busy && diceKey !== lastSeenDiceKey) {
    const idx = state.lastRolledIndex;
    const targetPos = state.players[idx].pos;
    const steps = targetPos - displayPos[idx];
    lastSeenDiceKey = diceKey;

    if (steps > 0) {
      busy = true; rollBtn.disabled = true;
      renderBoard(); updateStatus(true);
      spinTo(state.lastDice, () => {
        animateSteps(idx, steps, () => {
          displayPos[idx] = targetPos;
          busy = false;
          renderBoard(); updateStatus(false); showResult();
        });
      });
      return;
    }
  }

  // 演出中でなければ普通に表示を合わせる
  if (!busy) {
    state.players.forEach((p,i)=>{ displayPos[i]=p.pos; });
    renderBoard(); updateStatus(false); showResult();
  }
});

// ===== 盤面描画 =====
function renderBoard() {
  const state = latestState;
  if (!state) return;
  boardEl.innerHTML = "";
  const cells = [];
  for (let i=0;i<=goal;i++){
    const cell = document.createElement("div");
    cell.className = "cell";
    if(i===0) cell.classList.add("start");
    if(i===goal) cell.classList.add("goal");
    const num = document.createElement("div");
    num.className="num"; num.textContent = i===0?"START":i===goal?"GOAL":i;
    cell.appendChild(num);
    cells.push(cell); boardEl.appendChild(cell);
  }
  state.players.forEach((p,idx)=>{
    const pos = displayPos[idx] != null ? displayPos[idx] : p.pos;
    const cell = cells[pos]; if(!cell) return;
    let pawnsEl = cell.querySelector(".pawns");
    if(!pawnsEl){ pawnsEl=document.createElement("div"); pawnsEl.className="pawns"; cell.appendChild(pawnsEl); }
    const wrap=document.createElement("div"); wrap.className="pawnWrap";
    const pawn=document.createElement("div"); pawn.className="pawn"; pawn.style.background=COLORS[idx];
    const nm=document.createElement("div"); nm.className="pawnName"; nm.textContent=p.name;
    wrap.appendChild(pawn); wrap.appendChild(nm); pawnsEl.appendChild(wrap);
  });
}

function updateStatus(duringAnim) {
  const state = latestState; if(!state) return;
  playersEl.innerHTML = state.players.map((p,idx)=>`<span style="color:${COLORS[idx]}">●</span>${p.name}（${p.pos}）`).join("　");
  if (state.finished) { statusEl.textContent="🏁 全員ゴール！ゲーム終了"; startBtn.disabled=true; rollBtn.disabled=true; return; }
  if (!state.started) { statusEl.textContent="名前を決めて「ゲーム開始」を押してください"; startBtn.disabled=false; rollBtn.disabled=true; return; }
  startBtn.disabled=true; nameArea.style.display="none";
  const current = state.players[state.currentTurn];
  const myTurn = current && current.id === myId;
  statusEl.textContent = myTurn ? "あなたの番です！ルーレットを回してください" : (current ? current.name+" の番です..." : "");
  rollBtn.disabled = !myTurn || busy || duringAnim;
}

function showResult() {
  const state = latestState; if(!state) return;
  if(!state.finished){ resultEl.textContent=""; return; }
  const ranked=[...state.players].filter(p=>p.rank>0).sort((a,b)=>a.rank-b.rank);
  resultEl.textContent = "【結果】\n"+ranked.map(p=>`${p.rank}位：${p.name}`).join("\n");
  if(!lastWinnerShown){ lastWinnerShown=true; ensureAudio(); winSound(); }
}
