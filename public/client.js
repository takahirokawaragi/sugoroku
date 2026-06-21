/* =======================================================================
 * オンライン鉄道すごろく  client.js
 * Version: v4.0
 * Date   : 2026-06-21（日）11:13 JST
 * -----------------------------------------------------------------------
 * 【重要修正 v4.0】
 *   ソケット接続を既定名前空間 io() に変更（/sugoroku 撤去）。
 *   これにより index.html からは client.js?v=4.0 を読むだけで動作する。
 *   席UI=七並べ式(joinSeat)。手番枠/コマは seat 番号に厳密同期。
 *   栗山は1つだけ生成(分裂バグ修正)・始点間隔拡大。位置一覧/順位表示撤去。
 *   効果音 move=train / goal+gameover同時 / rank / reset / start / your_turn
 *   roll.mp3 は回転速度に合わせて連続再生。
 * ※ server.js v4.0 / index.html v4.0 とセット
 * ======================================================================= */

(function(){
'use strict';

const socket = io();   // ★ 既定名前空間（/sugoroku は使わない）

const COLORS = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa'];
const MAX = 5;

const MARGIN  = 1800;
const STEP    = 150;
const START_GAP = 260;

/* ---- サウンド ------------------------------------------------------- */
const SND_DIR = '/sounds/';
function makeAudio(file){ const a = new Audio(SND_DIR + file); a.preload='auto'; return a; }
const sndTrain    = makeAudio('train.mp3');
const sndGoal     = makeAudio('goal.mp3');
const sndGameover = makeAudio('gameover.wav');
const sndRank     = makeAudio('rank.mp3');
const sndReset    = makeAudio('reset.wav');
const sndStart    = makeAudio('start.wav');
const sndYourTurn = makeAudio('your_turn.wav');

function play(a){ if(!a) return; try{ a.currentTime=0; a.play().catch(()=>{}); }catch(e){} }
function stopAll(){
  [sndTrain,sndGoal,sndGameover,sndRank,sndStart,sndYourTurn].forEach(a=>{
    try{ a.pause(); a.currentTime=0; }catch(e){}
  });
  stopRollLoop();
}

/* ---- roll.mp3 連続再生 --------------------------------------------- */
let rollTimer = null, rolling = false, rollIdx = 0;
const sndRollPool = [makeAudio('roll.mp3'),makeAudio('roll.mp3'),makeAudio('roll.mp3'),makeAudio('roll.mp3')];
function playRollOnce(){
  try{ const a=sndRollPool[rollIdx]; rollIdx=(rollIdx+1)%sndRollPool.length;
       a.currentTime=0; a.play().catch(()=>{}); }catch(e){}
}
function startRollLoop(){
  if(rolling) return; rolling=true;
  let interval=45;
  const tick=()=>{ if(!rolling) return; playRollOnce();
    interval += interval*0.06 + 1.5; if(interval>320) interval=320;
    rollTimer=setTimeout(tick, interval); };
  tick();
}
function stopRollLoop(){ rolling=false; if(rollTimer){ clearTimeout(rollTimer); rollTimer=null; } }

/* ---- 状態 ----------------------------------------------------------- */
let state=null, mySeat=-1, myConfirmed=false, pendingJoin=null, layout=null;

/* ---- DOM ------------------------------------------------------------ */
const seatsEl  = document.getElementById('seats');
const boardEl  = document.getElementById('board');
const scrollEl = document.getElementById('boardScroll');
const btnStart = document.getElementById('btnStart');
const btnReset = document.getElementById('btnReset');
const wheel    = document.getElementById('wheel');

/* ---- 席UI 構築 ----------------------------------------------------- */
function buildSeats(){
  seatsEl.innerHTML='';
  for(let seat=0; seat<MAX; seat++){
    const row=document.createElement('div'); row.className='seatRow'; row.dataset.seat=seat;
    const badge=document.createElement('div'); badge.className='seatBadge'; badge.textContent='P'+(seat+1);
    const name=document.createElement('input'); name.className='seatName'; name.type='text';
    name.placeholder='名前'; name.maxLength=8;
    const routeBtns=document.createElement('div'); routeBtns.className='routeBtns';
    const bIwa=document.createElement('button'); bIwa.className='routeBtn iwamizawa'; bIwa.textContent='岩見沢';
    const bOi=document.createElement('button'); bOi.className='routeBtn oiwake'; bOi.textContent='追分';
    const rank=document.createElement('span'); rank.className='seatRank';
    routeBtns.appendChild(bIwa); routeBtns.appendChild(bOi); routeBtns.appendChild(rank);
    row.appendChild(badge); row.appendChild(name); row.appendChild(routeBtns);
    seatsEl.appendChild(row);
    bIwa.addEventListener('click', ()=> tryJoin(seat, name.value, 'iwamizawa'));
    bOi .addEventListener('click', ()=> tryJoin(seat, name.value, 'oiwake'));
  }
}
function tryJoin(seat, name, routeKey){
  if(state && state.started) return;
  if(mySeat>=0 && mySeat!==seat) return;
  const n=(name||'').trim();
  if(!n){ alert('名前を入力してください'); return; }
  pendingJoin={ seat, name:n, routeKey };
  socket.emit('joinSeat', { seat, name:n, routeKey });
}

/* ---- 席UI 反映 ----------------------------------------------------- */
function renderSeats(){
  if(!state) return;
  const rows=seatsEl.querySelectorAll('.seatRow');
  rows.forEach((row, seat)=>{
    const info=state.seats[seat];
    const badge=row.querySelector('.seatBadge');
    const name=row.querySelector('.seatName');
    const bIwa=row.querySelector('.routeBtn.iwamizawa');
    const bOi =row.querySelector('.routeBtn.oiwake');
    const rank=row.querySelector('.seatRank');
    const occupied=info && info.occupied;
    const isMine=occupied && (seat===mySeat);

    badge.classList.toggle('on', !!occupied);
    bIwa.classList.remove('on'); bOi.classList.remove('on');
    if(occupied){
      if(info.routeKey==='iwamizawa') bIwa.classList.add('on');
      if(info.routeKey==='oiwake')    bOi.classList.add('on');
    }
    if(occupied){ name.value=info.name; name.disabled=true; }
    else{ name.disabled=(state.started)||(mySeat>=0); }

    const canOperate=!state.started && mySeat<0 && !occupied;
    bIwa.disabled=!canOperate; bOi.disabled=!canOperate;
    if(isMine){ bIwa.disabled=true; bOi.disabled=true; }

    row.classList.toggle('turn', state.started && state.currentTurn===seat);
    rank.textContent=(occupied && info.rank>0) ? (info.rank+'位') : '';
  });
  btnStart.disabled=!!state.started;
}

/* ---- 盤面構築 ------------------------------------------------------ */
function buildLayout(routes){
  const iwa=routes.iwamizawa, oi=routes.oiwake;
  const commonLen=4;
  const iwaBranchLen=iwa.length-1-commonLen;
  const oiBranchLen =oi.length -1-commonLen;
  const stations=[]; const byKey={};
  const addStation=(key,s,x,y,extra)=>{
    if(byKey[key]) return byKey[key];
    const st=Object.assign({ key, name:s.name, kana:s.kana, x, y,
      band:s.roma||'', isStart:false, isGoal:false }, extra||{});
    stations.push(st); byKey[key]=st; return st;
  };
  const baseX=MARGIN+200, baseY=MARGIN+600;
  addStation('kuriyama', iwa[0], baseX, baseY, { isStart:true });

  for(let i=1;i<=iwaBranchLen;i++){
    const y=baseY-sumGap(1,i);
    addStation('iwa_'+i, iwa[i], baseX, y);
  }
  for(let i=1;i<=oiBranchLen;i++){
    const d=sumGap(1,i);
    addStation('oi_'+i, oi[i], baseX+d*0.72, baseY+d*0.72);
  }
  const commonStartIdx=iwa.length-commonLen;
  const cx=baseX+480, cy=baseY-sumGap(1,iwaBranchLen)-220;
  for(let c=0;c<commonLen;c++){
    const isGoal=(c===commonLen-1);
    addStation('common_'+c, iwa[commonStartIdx+c], cx+c*STEP, cy-c*40, { isGoal });
  }
  let maxX=0,maxY=0;
  stations.forEach(s=>{ maxX=Math.max(maxX,s.x); maxY=Math.max(maxY,s.y); });
  layout={ stations, byKey, width:maxX+MARGIN, height:maxY+MARGIN,
           commonStartIdx, iwaBranchLen, oiBranchLen, commonLen };
  return layout;
}
function sumGap(from,to){ let d=0; for(let k=from;k<=to;k++){ d+=(k===1)?START_GAP:STEP; } return d; }

function stationKeyFor(routeKey,pos){
  const route=state.routes[routeKey];
  const commonLen=layout.commonLen;
  const commonStartIdx=route.length-commonLen;
  if(pos===0) return 'kuriyama';
  if(pos>=commonStartIdx) return 'common_'+(pos-commonStartIdx);
  return (routeKey==='iwamizawa') ? ('iwa_'+pos) : ('oi_'+pos);
}

function renderBoard(){
  if(!state || !state.routes) return;
  if(!layout) buildLayout(state.routes);
  boardEl.style.width=layout.width+'px';
  boardEl.style.height=layout.height+'px';
  boardEl.innerHTML='';
  boardEl.appendChild(drawLines());
  for(const st of layout.stations){
    const wrap=document.createElement('div'); wrap.className='station';
    wrap.style.left=st.x+'px'; wrap.style.top=st.y+'px';
    const sign=document.createElement('div'); sign.className='stSign';
    if(st.isStart){ const b=document.createElement('div'); b.className='stStart'; b.textContent='START'; sign.appendChild(b); }
    if(st.isGoal){ const b=document.createElement('div'); b.className='stGoal'; b.textContent='GOAL'; sign.appendChild(b); }
    const nm=document.createElement('div'); nm.className='stName'; nm.textContent=st.name;
    const kn=document.createElement('div'); kn.className='stKana'; kn.textContent=st.kana;
    const bd=document.createElement('div'); bd.className='stBand'; bd.textContent=st.band;
    sign.appendChild(nm); sign.appendChild(kn); sign.appendChild(bd);
    const pieces=document.createElement('div'); pieces.className='stPieces'; pieces.dataset.key=st.key;
    wrap.appendChild(sign); wrap.appendChild(pieces);
    boardEl.appendChild(wrap);
  }
  placePieces();
}

function drawLines(){
  const svgNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('class','routeLayer');
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  const drawPath=(keys,color)=>{
    let d='';
    keys.forEach((k,i)=>{ const s=layout.byKey[k]; if(!s) return;
      d+=(i===0?'M':'L')+s.x+' '+s.y+' '; });
    const p=document.createElementNS(svgNS,'path');
    p.setAttribute('d', d.trim());
    p.setAttribute('fill','none'); p.setAttribute('stroke',color);
    p.setAttribute('stroke-width','10'); p.setAttribute('stroke-linecap','round');
    p.setAttribute('stroke-linejoin','round'); p.setAttribute('opacity','0.55');
    svg.appendChild(p);
  };
  const iwaKeys=['kuriyama'];
  for(let i=1;i<=layout.iwaBranchLen;i++) iwaKeys.push('iwa_'+i);
  for(let c=0;c<layout.commonLen;c++) iwaKeys.push('common_'+c);
  drawPath(iwaKeys,'#2f80c4');
  const oiKeys=['kuriyama'];
  for(let i=1;i<=layout.oiBranchLen;i++) oiKeys.push('oi_'+i);
  for(let c=0;c<layout.commonLen;c++) oiKeys.push('common_'+c);
  drawPath(oiKeys,'#c46a1f');
  return svg;
}

function placePieces(){
  boardEl.querySelectorAll('.stPieces').forEach(el=> el.innerHTML='');
  if(!state) return;
  state.seats.forEach((info,seat)=>{
    if(!info || !info.occupied) return;
    const key=stationKeyFor(info.routeKey, info.pos);
    const slot=boardEl.querySelector('.stPieces[data-key="'+key+'"]');
    if(!slot) return;
    const train=document.createElement('div'); train.className='train p'+seat;
    const band=document.createElement('div'); band.className='band';
    const label=document.createElement('div'); label.className='label'; label.textContent=info.name;
    const wl=document.createElement('div'); wl.className='wheel l';
    const wr=document.createElement('div'); wr.className='wheel r';
    train.appendChild(band); train.appendChild(label); train.appendChild(wl); train.appendChild(wr);
    slot.appendChild(train);
  });
}

/* ---- 中央追従 ------------------------------------------------------ */
function centerOnCurrent(){
  if(!state || !state.started || state.currentTurn<0) return;
  const info=state.seats[state.currentTurn];
  if(!info || !info.occupied) return;
  const st=layout && layout.byKey[stationKeyFor(info.routeKey, info.pos)];
  if(!st) return;
  scrollEl.scrollTo({ left:st.x-scrollEl.clientWidth/2,
                      top:st.y-scrollEl.clientHeight/2, behavior:'smooth' });
}

/* ---- ルーレット ---------------------------------------------------- */
const ctx=wheel.getContext('2d');
const WHEEL_N=6;
const WHEEL_COLORS=['#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da'];
let wheelAngle=0, spinning=false;

function resizeWheel(){ const d=Math.round(window.innerHeight*0.5);
  wheel.width=d; wheel.height=d; drawWheel(); }
function drawWheel(){
  const d=wheel.width, r=d/2, cx=r, cy=r;
  ctx.clearRect(0,0,d,d);
  const seg=(Math.PI*2)/WHEEL_N;
  for(let i=0;i<WHEEL_N;i++){
    const a0=wheelAngle+i*seg, a1=a0+seg;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r-4,a0,a1); ctx.closePath();
    ctx.fillStyle=WHEEL_COLORS[i]; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(a0+seg/2);
    ctx.fillStyle='#fff'; ctx.font='bold '+Math.round(r*0.28)+'px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(i+1), r*0.62, 0); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(cx,cy,r*0.12,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill(); ctx.strokeStyle='#999'; ctx.lineWidth=2; ctx.stroke();
}
function spinTo(value, cb){
  if(spinning) return; spinning=true; startRollLoop();
  const seg=(Math.PI*2)/WHEEL_N, idx=value-1;
  const baseTarget=(-Math.PI/2)-(idx*seg+seg/2);
  const turns=5+Math.floor(Math.random()*2);
  const finalAngle=baseTarget-turns*Math.PI*2;
  const startAngle=wheelAngle, delta=finalAngle-startAngle, dur=2600, t0=performance.now();
  function frame(now){
    const t=Math.min(1,(now-t0)/dur);
    const ease=1-Math.pow(1-t,3);
    wheelAngle=startAngle+delta*ease; drawWheel();
    if(t<1){ requestAnimationFrame(frame); }
    else{ spinning=false; stopRollLoop(); if(cb) cb(); }
  }
  requestAnimationFrame(frame);
}
wheel.addEventListener('click', ()=>{
  if(!state || !state.started) return;
  if(state.currentTurn!==mySeat) return;
  if(spinning) return;
  const value=1+Math.floor(Math.random()*6);
  spinTo(value, ()=> socket.emit('roll', { value }));
});
socket.on('cpuRoll', ({ seat, value })=>{ if(spinning) return; spinTo(value, ()=>{}); });

/* ---- 操作ボタン ---------------------------------------------------- */
btnStart.addEventListener('click', ()=>{
  if(state && state.started) return;
  btnStart.disabled=true;
  socket.emit('start');
});
btnReset.addEventListener('click', ()=> socket.emit('reset'));

/* ---- Socket 受信 --------------------------------------------------- */
socket.on('state', (st)=>{
  state=st;
  if(pendingJoin){
    const seat=pendingJoin.seat, info=st.seats[seat];
    if(info && info.occupied && info.name===pendingJoin.name && info.routeKey===pendingJoin.routeKey){
      mySeat=seat; myConfirmed=true;
    }
    pendingJoin=null;
  }
  if(mySeat>=0){ const mine=state.seats[mySeat]; if(!mine || !mine.occupied){ mySeat=-1; myConfirmed=false; } }
  if(!layout && state.routes) buildLayout(state.routes);
  renderSeats();
  renderBoard();
  if(state.started && state.currentTurn>=0) centerOnCurrent();
});

socket.on('event', (ev)=>{
  switch(ev.type){
    case 'start':    play(sndStart); break;
    case 'reset':    stopAll(); play(sndReset); break;
    case 'move':     play(sndTrain); break;
    case 'rank':     play(sndRank); break;
    case 'goal':     play(sndGoal); break;
    case 'gameover': play(sndGameover); break;
    case 'your_turn':play(sndYourTurn); break;
  }
});

/* ---- 初期化 -------------------------------------------------------- */
window.addEventListener('resize', ()=> resizeWheel());
buildSeats();
resizeWheel();
console.log('[sugoroku] client.js v4.0 ready  (2026-06-21 11:13 JST)');

})();
