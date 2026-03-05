import { useState, useReducer, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// FIREBASE — REST API (kein npm, kein SDK nötig!)
//
// WIE ES FUNKTIONIERT:
//   Firebase Realtime Database hat eine HTTP-Schnittstelle.
//   Jeder Pfad ist eine URL: DB/rooms/XK7F2Q/lastAction.json
//   Schreiben = PUT-Request, Lesen = GET-Request.
//   Für Echtzeit-Updates: Server-Sent Events (SSE) —
//   Firebase schickt automatisch eine Nachricht wenn sich
//   ein Wert ändert. Kein Polling nötig.
//
// SICHERHEIT:
//   Der API-Key ist im Frontend sichtbar — das ist bei Firebase
//   normal und kein Sicherheitsproblem. Die Sicherheit wird durch
//   Firebase-Regeln gesteuert (Testmodus = alles erlaubt für 30
//   Tage). Danach Regeln in Firebase Console anpassen.
// ═══════════════════════════════════════════════════════════════
const FB_DB = "https://figuren-ins-ziel-game-default-rtdb.europe-west1.firebasedatabase.app";

// Daten komplett überschreiben (PUT)
const fbWrite = async (path, data) => {
  try {
    await fetch(`${FB_DB}/${path}.json`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data),
    });
  } catch(e) { console.warn('fbWrite error', e); }
};

// Daten einmalig lesen (GET)
const fbRead = async (path) => {
  try {
    const r = await fetch(`${FB_DB}/${path}.json`);
    return r.json();
  } catch(e) { return null; }
};

// Echtzeit-Listener via Server-Sent Events (SSE)
// Jedes Mal wenn sich der Wert ändert, ruft Firebase cb() auf.
// Gibt eine "unsubscribe" Funktion zurück → aufrufen zum Abmelden.
const fbListen = (path, cb) => {
  const es = new EventSource(`${FB_DB}/${path}.json`);
  es.addEventListener('put', e => {
    try { cb(JSON.parse(e.data)?.data ?? null); } catch {}
  });
  es.onerror = () => {}; // SSE reconnectet automatisch bei Fehler
  return () => es.close();
};

// ═══════════════════════════════════════════════════════════════
// RAUM-HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════════════

// 6-stelliger Raum-Code aus lesbaren Zeichen (kein O/0, kein I/1)
const genRoomCode = () =>
  Array.from({length:6}, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]
  ).join('');

// Eindeutige ID für diesen Browser — bleibt während der Session gleich
const getMyId = () => {
  let id = sessionStorage.getItem('ludoPlayerId');
  if (!id) {
    id = Math.random().toString(36).slice(2,10);
    sessionStorage.setItem('ludoPlayerId', id);
  }
  return id;
};

// Farbreihenfolge für Online-Spieler: 1. beigetreten = Rot, 2. = Blau, usw.
const ONLINE_COLORS = ['red','blue','green','yellow'];

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const CS = 44, PAD = 10, BSIZ = 11 * CS + PAD * 2;
const gx = c => PAD + c * CS + CS / 2;
const gy = r => PAD + r * CS + CS / 2;

const HEX  = { red:'#DC2626', blue:'#2563EB', green:'#16A34A', yellow:'#CA8A04' };
const CBGR = { red:'#FEE2E2', blue:'#DBEAFE', green:'#DCFCE7', yellow:'#FEF3C7' };
const DE   = { red:'Rot', blue:'Blau', green:'Grün', yellow:'Gelb' };

const COLOR_START = { red:0, blue:10, green:20, yellow:30 };
const COLOR_ENTRY = { red:39, blue:9,  green:19, yellow:29 };

const PATH = [
  [4,10],[4,9],[4,8],[4,7],[4,6],[3,6],[2,6],[1,6],[0,6],[0,5],
  [0,4],[1,4],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[4,0],[5,0],
  [6,0],[6,1],[6,2],[6,3],[6,4],[7,4],[8,4],[9,4],[10,4],[10,5],
  [10,6],[9,6],[8,6],[7,6],[6,6],[6,7],[6,8],[6,9],[6,10],[5,10],
];
const FINISH = {
  red:[[5,9],[5,8],[5,7],[5,6]], blue:[[1,5],[2,5],[3,5],[4,5]],
  green:[[5,1],[5,2],[5,3],[5,4]], yellow:[[9,5],[8,5],[7,5],[6,5]],
};
const HOME = {
  red:[[1,8],[2,8],[1,9],[2,9]], blue:[[1,1],[2,1],[1,2],[2,2]],
  green:[[8,1],[9,1],[8,2],[9,2]], yellow:[[8,8],[9,8],[8,9],[9,9]],
};
const CORNERS = { red:[0,7], blue:[0,0], green:[7,0], yellow:[7,7] };
const DOTS = {
  1:[[1,1]], 2:[[0,0],[2,2]], 3:[[0,0],[1,1],[2,2]],
  4:[[0,0],[2,0],[0,2],[2,2]], 5:[[0,0],[2,0],[1,1],[0,2],[2,2]],
  6:[[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]],
};

// ═══════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════
let _ac = null;
const ac = () => {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === 'suspended') _ac.resume();
  return _ac;
};
const SFX = {
  tick()    { try { const a=ac(),t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=600+Math.random()*200;g.gain.setValueAtTime(0.06,t);g.gain.exponentialRampToValueAtTime(0.001,t+.04);o.connect(g);g.connect(a.destination);o.start();o.stop(t+.04); }catch(e){} },
  roll()    { try { const a=ac(),t=a.currentTime,buf=a.createBuffer(1,a.sampleRate*.15,a.sampleRate),d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.5);const s=a.createBufferSource();s.buffer=buf;const g=a.createGain();g.gain.setValueAtTime(0.3,t);g.gain.exponentialRampToValueAtTime(0.001,t+.15);s.connect(g);g.connect(a.destination);s.start(); }catch(e){} },
  step()    { try { const a=ac(),t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.setValueAtTime(350,t);o.frequency.exponentialRampToValueAtTime(700,t+.06);g.gain.setValueAtTime(0.1,t);g.gain.exponentialRampToValueAtTime(0.001,t+.08);o.connect(g);g.connect(a.destination);o.start();o.stop(t+.08); }catch(e){} },
  capture() { try { const a=ac(),t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='sawtooth';o.frequency.setValueAtTime(280,t);o.frequency.exponentialRampToValueAtTime(70,t+.28);g.gain.setValueAtTime(0.18,t);g.gain.exponentialRampToValueAtTime(0.001,t+.28);o.connect(g);g.connect(a.destination);o.start();o.stop(t+.28); }catch(e){} },
  land()    { try { const a=ac(),t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.setValueAtTime(900,t);o.frequency.exponentialRampToValueAtTime(400,t+.12);g.gain.setValueAtTime(0.12,t);g.gain.exponentialRampToValueAtTime(0.001,t+.12);o.connect(g);g.connect(a.destination);o.start();o.stop(t+.12); }catch(e){} },
  win()     { try { const a=ac();[523,659,784,1047].forEach((f,i)=>{const t=a.currentTime+i*.13,o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.18,t+.04);g.gain.exponentialRampToValueAtTime(0.001,t+.38);o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+.38);}); }catch(e){} },
  noMove()  { try { const a=ac(),t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='square';o.frequency.value=160;g.gain.setValueAtTime(0.08,t);g.gain.exponentialRampToValueAtTime(0.001,t+.18);o.connect(g);g.connect(a.destination);o.start();o.stop(t+.18); }catch(e){} },
};

// ═══════════════════════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════════════════════
const rollDie    = () => Math.floor(Math.random() * 6) + 1;
const mkPiece    = (color, i) => ({id:`${color}-${i}`,color,status:'home',boardPos:null,finishPos:null,homeIdx:i});
const mkPlayer   = (cfg, id)  => ({id,color:cfg.color,name:cfg.name,isAI:cfg.isAI,diff:cfg.diff||'medium',pieces:[0,1,2,3].map(i=>mkPiece(cfg.color,i)),captures:0});
const deepClone  = ps => ps.map(p=>({...p,pieces:p.pieces.map(pc=>({...pc}))}));
const flat       = players => players.flatMap(p=>p.pieces);

const isOwnBlocked    = (pos,color,ps) => flat(ps).some(p=>p.status==='active'&&p.boardPos===pos&&p.color===color);
const enemyAt         = (pos,color,ps) => flat(ps).find(p=>p.status==='active'&&p.boardPos===pos&&p.color!==color)??null;
const isFinishBlocked = (color,fp,ps)  => flat(ps).some(p=>p.color===color&&(p.status==='entering'||p.status==='finished')&&p.finishPos===fp);
const finishPathFree  = (color,from,to,ps) => { for(let i=from+1;i<=to;i++) if(isFinishBlocked(color,i,ps)) return false; return true; };

function calcMove(piece, dice, players) {
  if(piece.status==='finished') return null;
  if(piece.status==='home'){
    if(dice!==6) return null;
    if(isOwnBlocked(COLOR_START[piece.color],piece.color,players)) return null;
    return{boardPos:COLOR_START[piece.color],finishPos:null,status:'active'};
  }
  if(piece.status==='entering'){
    const nf=piece.finishPos+dice;
    if(nf>3||isFinishBlocked(piece.color,nf,players)||!finishPathFree(piece.color,piece.finishPos,nf,players)) return null;
    return{boardPos:null,finishPos:nf,status:nf===3?'finished':'entering'};
  }
  const cur=piece.boardPos,entry=COLOR_ENTRY[piece.color];
  const dist=entry>=cur?entry-cur:40-cur+entry;
  if(dice<=dist){
    const np=(cur+dice)%40;
    if(isOwnBlocked(np,piece.color,players)) return null;
    return{boardPos:np,finishPos:null,status:'active'};
  }
  const into=dice-dist-1;
  if(into>3||isFinishBlocked(piece.color,into,players)||!finishPathFree(piece.color,-1,into,players)) return null;
  return{boardPos:null,finishPos:into,status:into===3?'finished':'entering'};
}

function getSelectable(player,dice,players){
  if(dice===6){const hp=player.pieces.filter(p=>p.status==='home');if(hp.length>0){const can=hp.filter(p=>calcMove(p,dice,players)!==null);if(can.length>0)return can;}}
  return player.pieces.filter(p=>calcMove(p,dice,players)!==null);
}

function doMove(players,player,piece,dice){
  const m=calcMove(piece,dice,players); if(!m) return{players,msg:'?',cap:null};
  const cap=m.boardPos!==null?enemyAt(m.boardPos,player.color,players):null;
  const updated=players.map(p=>{
    if(p.id===player.id) return{...p,captures:p.captures+(cap?1:0),pieces:p.pieces.map(pc=>pc.id===piece.id?{...pc,...m}:pc)};
    if(cap&&p.color===cap.color) return{...p,pieces:p.pieces.map(pc=>pc.id===cap.id?{...pc,boardPos:null,finishPos:null,status:'home'}:pc)};
    return p;
  });
  let msg;
  if(piece.status==='home')   msg=`🚀 ${player.name} bringt Figur raus`;
  else if(m.status==='finished') msg=`🏆 ${player.name}: Figur ins Ziel!`;
  else if(cap)                msg=`💥 ${player.name} schlägt ${DE[cap.color]}! Zurück ins Haus.`;
  else if(m.status==='entering') msg=`${player.name} betritt Zielkorridor (${dice})`;
  else                        msg=`${player.name} zieht ${dice} ${dice===1?'Feld':'Felder'}`;
  return{players:updated,msg,cap};
}

const findWinner = players => players.find(p=>p.pieces.every(pc=>pc.status==='finished'))??null;

function aiDecide(player,dice,players,candidates,diff){
  if(candidates.length<=1) return candidates[0];
  if(diff==='easy') return candidates[Math.floor(Math.random()*candidates.length)];
  const ap=flat(players);
  const scored=candidates.map(piece=>{
    const m=calcMove(piece,dice,players); if(!m) return{piece,s:-9999};
    let s=0;
    if(m.status==='finished') s+=1000;
    else if(m.status==='entering') s+=350+(m.finishPos??0)*80;
    if(m.boardPos!==null){
      if(enemyAt(m.boardPos,player.color,players)) s+=500;
      if(diff==='hard'){const danger=ap.some(en=>{if(en.color===player.color||en.status!=='active')return false;for(let d=1;d<=6;d++)if(calcMove(en,d,players)?.boardPos===m.boardPos)return true;return false;});if(danger)s-=200;}
    }
    if(piece.status==='home') s+=260;
    if(piece.status==='active'&&piece.boardPos!==null){const e=COLOR_ENTRY[player.color],d=e>=piece.boardPos?e-piece.boardPos:40-piece.boardPos+e;s+=(40-d)*4;}
    return{piece,s};
  });
  scored.sort((a,b)=>b.s-a.s);
  return scored[0].piece;
}

function computePath(lm){
  const{prevStatus,prevBoardPos,prevFinishPos,dice,color}=lm, path=[];
  if(prevStatus==='home'){const[c,r]=PATH[COLOR_START[color]];path.push({x:gx(c),y:gy(r)});return path;}
  if(prevStatus==='entering'){for(let f=prevFinishPos+1;f<=Math.min(prevFinishPos+dice,3);f++){const[c,r]=FINISH[color][f];path.push({x:gx(c),y:gy(r)});}return path;}
  const cur=prevBoardPos,entry=COLOR_ENTRY[color];
  const dist=entry>=cur?entry-cur:40-cur+entry;
  const onMain=Math.min(dice,dist);
  for(let i=1;i<=onMain;i++){const[c,r]=PATH[(cur+i)%40];path.push({x:gx(c),y:gy(r)});}
  if(dice>dist){const into=dice-dist-1;for(let f=0;f<=Math.min(into,3);f++){const[c,r]=FINISH[color][f];path.push({x:gx(c),y:gy(r)});}}
  return path;
}

// ═══════════════════════════════════════════════════════════════
// REDUCER
// ═══════════════════════════════════════════════════════════════
const DEFAULT_CFG=[
  {color:'red',   name:'Spieler 1',isAI:false,diff:'medium',active:true},
  {color:'blue',  name:'Spieler 2',isAI:false,diff:'medium',active:true},
  {color:'green', name:'KI Grün',  isAI:true, diff:'medium',active:false},
  {color:'yellow',name:'KI Gelb',  isAI:true, diff:'medium',active:false},
];

function initGame(configs){
  return{players:configs.filter(c=>c.active).map((c,i)=>mkPlayer(c,i)),
    cur:0,dice:null,sixes:0,phase:'rolling',sel:[],winner:null,
    history:[],log:[],turnId:0,lastMove:null};
}

function applyPick(state,piece){
  const{g}=state,player=g.players[g.cur];
  const prevState={pieceId:piece.id,color:piece.color,prevStatus:piece.status,
    prevBoardPos:piece.boardPos,prevFinishPos:piece.finishPos,dice:g.dice};
  const{players:np,msg,cap}=doMove(g.players,player,piece,g.dice);
  const winner=findWinner(np);
  const again=!winner&&g.dice===6;
  return{...state,g:{...g,players:np,
    dice:again?null:g.dice,sixes:again?g.sixes:0,
    cur:again?g.cur:(g.cur+1)%g.players.length,
    phase:winner?'over':'rolling',winner:winner??null,sel:[],
    log:[...g.log,msg].slice(-60),turnId:g.turnId+1,
    // capColor ermöglicht die Capture-Animation in der richtigen Farbe
    lastMove:{...prevState,cap:cap?.id??null,capColor:cap?.color??null},
  }};
}

function gameReducer(state,act){
  switch(act.type){
    case 'START': return{screen:'game',cfg:act.cfg,g:initGame(act.cfg)};
    case 'MENU':  return{screen:'setup',cfg:state.cfg??DEFAULT_CFG};
    case 'UNDO':{
      const{g}=state; if(!g?.history.length) return state;
      const prev=g.history[g.history.length-1];
      return{...state,g:{...g,players:prev.players,cur:prev.cur,
        dice:null,sixes:prev.sixes,phase:'rolling',sel:[],winner:null,
        history:g.history.slice(0,-1),log:[...g.log,'↩️ Rückgängig'].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
    }
    case 'ROLL':
    case 'ROLL_WITH_DICE':{
      const{g}=state; if(!g||g.phase!=='rolling') return state;
      const player=g.players[g.cur];
      // ROLL_WITH_DICE bekommt den Wert von außen (für Online-Sync),
      // ROLL würfelt selbst (lokal & KI)
      const d=act.type==='ROLL_WITH_DICE'?act.dice:rollDie();
      const newSixes=d===6?g.sixes+1:0;
      const snap={players:deepClone(g.players),cur:g.cur,sixes:g.sixes};
      const hist=[...g.history,snap].slice(-10);
      if(newSixes>=3) return{...state,g:{...g,dice:d,sixes:0,cur:(g.cur+1)%g.players.length,
        phase:'rolling',sel:[],history:hist,
        log:[...g.log,`⚠️ ${player.name}: 3× Sechs – Zug verfällt!`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
      const valid=getSelectable(player,d,g.players);
      if(valid.length===0) return{...state,g:{...g,dice:d,sixes:newSixes,
        cur:(g.cur+1)%g.players.length,phase:'rolling',sel:[],history:hist,
        log:[...g.log,`${player.name} würfelt ${d} – kein Zug möglich`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
      if(valid.length===1&&!player.isAI)
        return applyPick({...state,g:{...g,dice:d,sixes:newSixes,history:hist,
          log:[...g.log,`${player.name} würfelt ${d}`].slice(-60),turnId:g.turnId+1}},valid[0]);
      return{...state,g:{...g,dice:d,sixes:newSixes,history:hist,
        phase:player.isAI?'ai':'picking',sel:valid.map(p=>p.id),
        log:[...g.log,`${player.name} würfelt ${d}${player.isAI?'':' – Figur wählen!'}`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
    }
    case 'ROLL_REMOTE':{
      // Eingehender Würfelwurf von einem anderen Online-Spieler.
      // WICHTIG: Kein auto-applyPick auch bei valid.length===1 —
      // der Remote-Spieler schickt immer ein explizites PICK via Firebase.
      // So bleibt der State bei allen Instanzen synchron.
      const{g}=state; if(!g||g.phase!=='rolling') return state;
      const player=g.players[g.cur],d=act.dice,newSixes=d===6?g.sixes+1:0;
      const snap={players:deepClone(g.players),cur:g.cur,sixes:g.sixes};
      const hist=[...g.history,snap].slice(-10);
      if(newSixes>=3) return{...state,g:{...g,dice:d,sixes:0,cur:(g.cur+1)%g.players.length,
        phase:'rolling',sel:[],history:hist,
        log:[...g.log,`⚠️ ${player.name}: 3× Sechs – Zug verfällt!`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
      const valid=getSelectable(player,d,g.players);
      if(valid.length===0) return{...state,g:{...g,dice:d,sixes:newSixes,
        cur:(g.cur+1)%g.players.length,phase:'rolling',sel:[],history:hist,
        log:[...g.log,`${player.name} würfelt ${d} – kein Zug möglich`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
      // Immer picking — Remote-Spieler sendet PICK separat
      return{...state,g:{...g,dice:d,sixes:newSixes,history:hist,
        phase:'picking',sel:valid.map(p=>p.id),
        log:[...g.log,`${player.name} würfelt ${d}…`].slice(-60),
        turnId:g.turnId+1,lastMove:null}};
    }
    case 'PICK':{
      const{g}=state; if(!g||(g.phase!=='picking'&&g.phase!=='ai')) return state;
      if(!g.sel.includes(act.id)) return state;
      const player=g.players[g.cur],piece=player.pieces.find(p=>p.id===act.id);
      if(!piece) return state;
      return applyPick(state,piece);
    }
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════════════
// PIECE COORDS
// ═══════════════════════════════════════════════════════════════
function pieceXY(piece,all){
  if(piece.status==='home'){const[c,r]=HOME[piece.color][piece.homeIdx];return{x:gx(c),y:gy(r)};}
  if(piece.status==='active'&&piece.boardPos!=null){
    const[c,r]=PATH[piece.boardPos];
    const same=all.filter(p=>p.status==='active'&&p.boardPos===piece.boardPos);
    const idx=same.findIndex(p=>p.id===piece.id),off=same.length>1?(idx-(same.length-1)/2)*9:0;
    return{x:gx(c)+off,y:gy(r)+off};
  }
  if((piece.status==='entering'||piece.status==='finished')&&piece.finishPos!=null){const[c,r]=FINISH[piece.color][piece.finishPos];return{x:gx(c),y:gy(r)};}
  return{x:0,y:0};
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION HOOK
// ═══════════════════════════════════════════════════════════════
function useAnimation(gRef, soundOn){
  const [diceDisplay,setDiceDisplay] = useState(null);
  const [diceSpinning,setDiceSpinning] = useState(false);
  const [showPicker,setShowPicker] = useState(false);
  const [blocked,setBlocked] = useState(false);
  const [animPiece,setAnimPiece] = useState(null);
  const [hidePieceId,setHidePieceId] = useState(null);
  // Capture effect state: {x, y, color, key} — key forces re-mount on each new capture
  const [captureEffect,setCaptureEffect] = useState(null);
  const timers=useRef([]);

  const clearTimers=()=>{timers.current.forEach(clearTimeout);timers.current=[];};
  const after=(ms,fn)=>{const t=setTimeout(fn,ms);timers.current.push(t);return t;};

  const animateAlongPath=useCallback((lm,path,onDone)=>{
    if(!path.length){onDone();return;}
    setHidePieceId(lm.pieceId);
    setAnimPiece({id:lm.pieceId,color:lm.color,...path[0]});
    if(soundOn) SFX.step();

    let step=0;
    const advance=()=>{
      step++;
      if(step>=path.length){
        // Figur ist angekommen
        if(soundOn) SFX.land();

        if(lm.cap && lm.capColor){
          // ── Capture-Animation auslösen ──────────────────────
          if(soundOn) SFX.capture();
          const landPos=path[path.length-1];
          setCaptureEffect({
            x:landPos.x, y:landPos.y,
            color:HEX[lm.capColor],
            key:Date.now(),   // neuer key → Component re-mounted → Animation startet neu
          });
          // Kurze Pause damit Animation sichtbar ist, dann aufräumen
          after(700,()=>{
            setCaptureEffect(null);
            setAnimPiece(null);
            setHidePieceId(null);
            onDone();
          });
        } else {
          after(200,()=>{
            setAnimPiece(null);
            setHidePieceId(null);
            onDone();
          });
        }
        return;
      }
      if(soundOn) SFX.step();
      setAnimPiece(prev=>({...prev,...path[step]}));
      after(210,advance);
    };
    after(210,advance);
  },[soundOn]);

  const handleTurnResult=useCallback((g,prevLastMove)=>{
    const lm=g.lastMove;
    const isNewMove=lm&&lm!==prevLastMove;
    if(isNewMove){
      const path=computePath(lm);
      animateAlongPath(lm,path,()=>{
        if(g.phase==='over'&&soundOn) SFX.win();
        setBlocked(false);
      });
    } else if(g.phase==='picking'){
      after(500,()=>{setShowPicker(true);setBlocked(false);});
    } else if(g.phase==='ai'){
      // KI hat mehrere Optionen — einfach unblockieren,
      // der AI-Pick-Timeout im Haupt-Effect übernimmt
      setBlocked(false);
    } else {
      if(soundOn) SFX.noMove();
      after(600,()=>setBlocked(false));
    }
  },[animateAlongPath,soundOn]);

  const runDiceAnimation=useCallback((durationMs,onDone)=>{
    const intervals=[55,60,65,75,85,95,110,130,150,175,200,230,270];
    let frame=0;
    setDiceSpinning(true);
    if(soundOn) SFX.roll();
    const tick=()=>{
      if(soundOn&&frame%3===0) SFX.tick();
      setDiceDisplay(Math.floor(Math.random()*6)+1);
      frame++;
      if(frame<intervals.length){after(intervals[frame],tick);}
      else{setDiceSpinning(false);onDone();}
    };
    after(intervals[0],tick);
  },[soundOn]);

  return{
    diceDisplay,diceSpinning,showPicker,blocked,animPiece,hidePieceId,captureEffect,
    setDiceDisplay,setDiceSpinning,setShowPicker,setBlocked,
    setAnimPiece,setHidePieceId,setCaptureEffect,
    runDiceAnimation,animateAlongPath,handleTurnResult,clearTimers,after,
  };
}

// ═══════════════════════════════════════════════════════════════
// CAPTURE EFFECT SVG COMPONENT
// ═══════════════════════════════════════════════════════════════
// CAPTURE EFFECT — CSS @keyframes (kein SMIL)
//
// WARUM CSS statt SVG-SMIL-Animate:
//   SMIL begin="0s" referenziert die Dokument-Zeitlinie, nicht den
//   Einfügezeitpunkt. Wenn das Element nach Spielbeginn eingesetzt
//   wird, liegt "0s" bereits weit in der Vergangenheit → Animation
//   wird sofort "fertig" ohne sichtbaren Effekt.
//   CSS-Animationen starten immer relativ zum Einfügezeitpunkt. ✓
// ═══════════════════════════════════════════════════════════════
function CaptureEffect({ x, y, color }) {
  // Eindeutiges Präfix pro Instanz – verhindert @keyframe-Kollisionen
  // wenn mehrere Treffer kurz hintereinander passieren.
  const uid = useRef(`ce_${Math.random().toString(36).slice(2,8)}`).current;

  // Partikel: 8 Stück gleichmäßig radial, leicht variiert
  const particles = useMemo(() =>
    Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * Math.PI * 2;
      const dist  = 30 + Math.random() * 12;
      return {
        tx:   Math.cos(angle) * dist,
        ty:   Math.sin(angle) * dist,
        size: 2.8 + Math.random() * 2.2,
        delay: i * 12,   // ms — leichter Versatz für organischeres Aussehen
      };
    }), []);

  // Splitter: 4 rautenförmige Elemente diagonal
  const splinters = useMemo(() =>
    Array.from({ length: 4 }, (_, i) => {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 8;
      const dist  = 22 + Math.random() * 8;
      return {
        tx:    Math.cos(angle) * dist,
        ty:    Math.sin(angle) * dist,
        delay: 40 + i * 18,
      };
    }), []);

  // Alle @keyframes in einem <style>-Block — sauber, keine Konflikte
  const css = `
    /* Weißer Kern-Blitz */
    @keyframes ${uid}_flash {
      0%   { transform: scale(0.4); opacity: 0.9; }
      35%  { transform: scale(1.6); opacity: 0.55; }
      100% { transform: scale(2.4); opacity: 0; }
    }
    /* Haupt-Ring expandiert */
    @keyframes ${uid}_ring1 {
      0%   { transform: scale(0.3); opacity: 0.9; stroke-width: 5px; }
      100% { transform: scale(3.2); opacity: 0;   stroke-width: 1px; }
    }
    /* Zweiter feinerer Ring – leicht versetzt */
    @keyframes ${uid}_ring2 {
      0%   { transform: scale(0.2); opacity: 0.6; }
      100% { transform: scale(2.8); opacity: 0; }
    }
    /* Partikel-Bewegung (individuell per Index) */
    ${particles.map((p, i) => `
      @keyframes ${uid}_p${i} {
        0%   { transform: translate(0px, 0px)         scale(1);   opacity: 1; }
        75%  { transform: translate(${p.tx*.9}px, ${p.ty*.9}px)  scale(0.5); opacity: 0.7; }
        100% { transform: translate(${p.tx}px,   ${p.ty}px)      scale(0);   opacity: 0; }
      }
    `).join('')}
    /* Splitter-Bewegung */
    ${splinters.map((s, i) => `
      @keyframes ${uid}_s${i} {
        0%   { transform: translate(0px, 0px)         rotate(0deg)   scale(1);   opacity: 0.9; }
        100% { transform: translate(${s.tx}px, ${s.ty}px) rotate(160deg) scale(0);   opacity: 0; }
      }
    `).join('')}
  `;

  const TO = 'transform-box:fill-box; transform-origin:center;';

  return (
    <g transform={`translate(${x},${y})`} style={{ pointerEvents: 'none' }}>
      <style>{css}</style>

      {/* 1. Weißer Kern-Blitz */}
      <circle r={13} fill="white" style={{
        transformBox: 'fill-box', transformOrigin: 'center',
        animation: `${uid}_flash 0.22s ease-out forwards`,
      }}/>

      {/* 2. Farbiger Haupt-Ring */}
      <circle r={15} fill="none" stroke={color} strokeWidth={4} style={{
        transformBox: 'fill-box', transformOrigin: 'center',
        animation: `${uid}_ring1 0.52s cubic-bezier(0.15,0,0.75,1) forwards`,
      }}/>

      {/* 3. Zweiter feinerer Ring (20ms Versatz) */}
      <circle r={13} fill="none" stroke={color} strokeWidth={2} style={{
        transformBox: 'fill-box', transformOrigin: 'center',
        animation: `${uid}_ring2 0.6s 0.02s cubic-bezier(0.1,0,0.9,1) forwards`,
        opacity: 0,
      }}/>

      {/* 4. Partikel radial */}
      {particles.map((p, i) => (
        <circle key={i} r={p.size} fill={color} style={{
          transformBox: 'fill-box', transformOrigin: 'center',
          animation: `${uid}_p${i} 0.52s ${p.delay}ms ease-out forwards`,
        }}/>
      ))}

      {/* 5. Splitter diagonal */}
      {splinters.map((s, i) => (
        <rect key={i}
          x={-4} y={-4} width={8} height={8} rx={1}
          fill={color}
          style={{
            transformBox: 'fill-box', transformOrigin: 'center',
            animation: `${uid}_s${i} 0.56s ${s.delay}ms ease-out forwards`,
          }}
        />
      ))}
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLAYER HOOK — useMultiplayer
//
// WAS DIESER HOOK MACHT:
//
//  1. RAUM ERSTELLEN (createRoom):
//     - Generiert 6-stelligen Code z.B. "XK7F2Q"
//     - Schreibt in Firebase: rooms/XK7F2Q/players/{myId} = {name, color:'red'}
//     - Speichert code + color lokal
//
//  2. RAUM BEITRETEN (joinRoom):
//     - Liest rooms/XK7F2Q/players aus Firebase
//     - Weist nächste freie Farbe zu
//     - Schreibt eigenen Spieler hinein
//
//  3. AKTION SENDEN (sendAction):
//     - Schreibt {type, payload, from, ts} nach rooms/XK7F2Q/lastAction
//     - Firebase informiert alle anderen sofort via SSE
//
//  4. AKTIONEN EMPFANGEN (useEffect mit fbListen):
//     - Hört auf rooms/XK7F2Q/lastAction
//     - Ignoriert eigene Aktionen (from === myId)
//     - Ruft onAction(action) auf → das ist unser dispatch()
//
//  5. RECONNECT:
//     - Beim Öffnen wird rooms/XK7F2Q/gameState gelesen
//     - Falls Spiel bereits lief → State wiederherstellen
// ═══════════════════════════════════════════════════════════════
function useMultiplayer({ onAction, onPlayersChange }) {
  const myId = useRef(getMyId()).current;
  const [roomCode, setRoomCode] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [players, setPlayers] = useState({});   // {id: {name, color}}
  const [status, setStatus] = useState('idle'); // idle|creating|joining|lobby|playing|error
  const [error, setError] = useState(null);
  const unsubRef = useRef(null);

  // Raum-Spieler beobachten
  const watchPlayers = useCallback((code) => {
    if (unsubRef.current) unsubRef.current();
    const unsub = fbListen(`rooms/${code}/players`, data => {
      if (!data) return;
      setPlayers(data);
      onPlayersChange?.(data);
    });
    unsubRef.current = unsub;
  }, [onPlayersChange]);

  // Aktionen vom Server empfangen
  const watchActions = useCallback((code) => {
    fbListen(`rooms/${code}/lastAction`, action => {
      if (!action || action.from === myId) return; // eigene ignorieren
      onAction?.(action);
    });
  }, [myId, onAction]);

  // Raum erstellen
  const createRoom = useCallback(async (playerName, maxPlayers) => {
    setStatus('creating');
    setError(null);
    const code = genRoomCode();
    const color = ONLINE_COLORS[0]; // Ersteller bekommt immer Rot
    try {
      await fbWrite(`rooms/${code}`, {
        createdAt: Date.now(),
        maxPlayers,
        host: myId,
        players: { [myId]: { name: playerName, color, online: true } },
        gameStarted: false,
      });
      setRoomCode(code);
      setMyColor(color);
      setStatus('lobby');
      watchPlayers(code);
      watchActions(code);
    } catch(e) {
      setError('Raum konnte nicht erstellt werden.');
      setStatus('error');
    }
  }, [myId, watchPlayers, watchActions]);

  // Raum beitreten
  const joinRoom = useCallback(async (code, playerName) => {
    setStatus('joining');
    setError(null);
    const upper = code.toUpperCase().trim();
    try {
      const room = await fbRead(`rooms/${upper}`);
      if (!room) { setError('Raum nicht gefunden.'); setStatus('error'); return null; }
      if (room.gameStarted) { setError('Spiel läuft bereits.'); setStatus('error'); return null; }
      const taken = Object.values(room.players || {}).map(p => p.color);
      const color = ONLINE_COLORS.find(c => !taken.includes(c));
      if (!color) { setError('Raum ist voll.'); setStatus('error'); return null; }
      await fbWrite(`rooms/${upper}/players/${myId}`, { name: playerName, color, online: true });
      setRoomCode(upper);
      setMyColor(color);
      setStatus('lobby');
      setPlayers({...room.players, [myId]: { name:playerName, color, online:true }});
      watchPlayers(upper);
      watchActions(upper);
      // maxPlayers aus Firebase zurückgeben damit Lobby es setzen kann
      return { maxPlayers: room.maxPlayers ?? 2 };
    } catch(e) {
      setError('Verbindung fehlgeschlagen.');
      setStatus('error');
      return null;
    }
  }, [myId, watchPlayers, watchActions]);

  // Spiel starten (nur Host) — configs wird mitgespeichert
  const startGame = useCallback(async (configs) => {
    if (!roomCode) return;
    // Configs in Firebase speichern → alle lesen dieselbe Konfiguration
    await fbWrite(`rooms/${roomCode}/configs`, configs);
    await fbWrite(`rooms/${roomCode}/gameStarted`, true);
    setStatus('playing');
  }, [roomCode]);

  // Aktion an alle senden (z.B. ROLL oder PICK)
  const sendAction = useCallback(async (type, payload={}) => {
    if (!roomCode) return;
    await fbWrite(`rooms/${roomCode}/lastAction`, {
      type, payload, from: myId, ts: Date.now(),
    });
  }, [roomCode, myId]);

  // Spiel-State speichern (für Reconnect)
  const saveState = useCallback(async (gameState) => {
    if (!roomCode) return;
    await fbWrite(`rooms/${roomCode}/gameState`, gameState);
  }, [roomCode]);

  // Auf Spielstart warten (für nicht-Host)
  // Configs werden frisch aus Firebase gelesen — kein Closure-Problem
  const watchStart = useCallback((onStart) => {
    if (!roomCode) return;
    const unsub = fbListen(`rooms/${roomCode}/gameStarted`, async val => {
      if (val === true) {
        setStatus('playing');
        // Frische Configs aus Firebase lesen
        const configs = await fbRead(`rooms/${roomCode}/configs`);
        onStart?.(configs ?? []);
      }
    });
    return unsub;
  }, [roomCode]);

  // Beim Verlassen aufräumen
  useEffect(() => () => { unsubRef.current?.(); }, []);

  return {
    myId, roomCode, myColor, players, status, error,
    createRoom, joinRoom, startGame, sendAction, saveState, watchStart,
    isHost: (room) => room?.host === myId,
  };
}

// ═══════════════════════════════════════════════════════════════
// LOBBY SCREEN
//
// ABLAUF:
//   1. Spieler wählt: "Raum erstellen" oder "Beitreten"
//   2. Name eingeben
//   3. Bei Erstellen: Code wird angezeigt → teilen
//   4. Warten bis alle da sind
//   5. Host startet das Spiel
// ═══════════════════════════════════════════════════════════════
function OnlineLobby({ onGameStart, onBack }) {
  const [view, setView] = useState('home');     // home|create|join|waiting
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [roomPlayers, setRoomPlayers] = useState({});
  const [isHost, setIsHost] = useState(false);
  const [copied, setCopied] = useState(false);
  const unsubStartRef = useRef(null);

  const mp = useMultiplayer({
    onAction: () => {}, // im Lobby noch keine Spielzüge
    onPlayersChange: setRoomPlayers,
  });

  // Warten auf Spielstart (nicht-Host)
  // configs kommt jetzt direkt aus Firebase (frische Daten, kein Closure-Problem)
  useEffect(() => {
    if (mp.status === 'lobby' && !isHost) {
      unsubStartRef.current = mp.watchStart((configs) => {
        onGameStart({ configs, roomCode: mp.roomCode,
          myColor: mp.myColor, sendAction: mp.sendAction,
          saveState: mp.saveState, myId: mp.myId });
      });
    }
    return () => unsubStartRef.current?.();
  }, [mp.status, isHost]);

  const buildConfigs = (players, max) => {
    const online = Object.values(players);
    // max = vom Host gewählt. Online-Spieler werden erkannt.
    // Leere Plätze bis max werden mit KI aufgefüllt — NUR wenn max > online.length.
    // Wichtig: Wir nehmen exakt 'max' Farben, nicht mehr.
    return ONLINE_COLORS.slice(0, max).map((color) => {
      const p = online.find(pl => pl.color === color);
      return {
        color, active: true,
        name: p ? p.name : `KI ${color}`,
        isAI: !p,
        diff: 'medium',
      };
    });
  };

  // Beim Start: maxPlayers = Anzahl tatsächlich beigetretener Spieler
  // (nicht der vom Host eingestellte Wert, falls weniger kamen)
  const effectiveMaxPlayers = (players) => {
    const count = Object.keys(players).length;
    return Math.max(2, Math.min(count, maxPlayers));
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsHost(true);
    await mp.createRoom(name.trim(), maxPlayers);
    setView('waiting');
  };

  const handleJoin = async () => {
    if (!name.trim() || !joinCode.trim()) return;
    // joinRoom gibt jetzt maxPlayers aus Firebase zurück
    const result = await mp.joinRoom(joinCode, name.trim());
    if (result) {
      setMaxPlayers(result.maxPlayers); // Firebase-Wert übernehmen
      setView('waiting');
    }
  };

  const handleStart = async () => {
    const effMax = effectiveMaxPlayers(roomPlayers);
    const cfgs = buildConfigs(roomPlayers, effMax);
    await mp.startGame(cfgs);
    onGameStart({ configs: cfgs, roomCode: mp.roomCode,
      myColor: mp.myColor, sendAction: mp.sendAction,
      saveState: mp.saveState, myId: mp.myId });
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(mp.roomCode ?? '').catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inp = {
    background:'#1a1208', border:'1px solid rgba(240,230,204,.2)',
    borderRadius:10, padding:'10px 14px', color:'#f0e6cc',
    fontSize:15, fontFamily:'inherit', width:'100%',
  };
  const btn = (bg='#f0e6cc', col='#0f0d08') => ({
    width:'100%', padding:'12px 0', borderRadius:12, border:'none',
    background:bg, color:col, fontSize:15, fontWeight:'bold',
    cursor:'pointer', fontFamily:'inherit', marginTop:8,
  });

  return (
    <div style={{width:'100%',maxWidth:380,display:'flex',flexDirection:'column',
      alignItems:'center',gap:16,paddingTop:24,paddingBottom:28}}>

      {/* Header */}
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:38,marginBottom:4}}>🌐</div>
        <h2 style={{margin:'0 0 4px',fontSize:20}}>Online Multiplayer</h2>
        <p style={{color:'#6a5030',fontSize:12,margin:0,fontFamily:'system-ui'}}>
          Spiele mit Freunden über das Internet
        </p>
      </div>

      {/* HOME */}
      {view==='home' && (
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:10}}>
          <input placeholder="Dein Name" value={name}
            onChange={e=>setName(e.target.value)} style={inp}/>
          {!name.trim()&&<p style={{color:'#f87171',fontSize:12,margin:0,fontFamily:'system-ui',textAlign:'center'}}>
            Bitte zuerst deinen Namen eingeben
          </p>}
          <button onClick={()=>{if(name.trim())setView('create');}}
            disabled={!name.trim()}
            style={btn(name.trim()?'#f0e6cc':'#221810', name.trim()?'#0f0d08':'#4a3020')}>
            🏠 Raum erstellen
          </button>
          <button onClick={()=>setView('join')}
            style={btn('transparent','#f0e6cc')}>
            🔑 Raum beitreten
          </button>
          <button onClick={onBack}
            style={btn('transparent','#6a5030')}>← Zurück</button>
        </div>
      )}

      {/* CREATE */}
      {view==='create' && (
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{color:'#f0e6cc',fontFamily:'system-ui',fontSize:13}}>
            Wie viele Spieler?
          </div>
          <div style={{display:'flex',gap:8}}>
            {[2,3,4].map(n=>(
              <button key={n} onClick={()=>setMaxPlayers(n)}
                style={{flex:1,padding:'10px 0',borderRadius:10,border:'none',
                  fontWeight:'bold',fontSize:15,cursor:'pointer',fontFamily:'inherit',
                  background:maxPlayers===n?'#f0e6cc':'#1a1208',
                  color:maxPlayers===n?'#0f0d08':'#6a5030'}}>
                {n}
              </button>
            ))}
          </div>
          <button onClick={handleCreate}
            disabled={mp.status==='creating'}
            style={btn()}>
            {mp.status==='creating'?'Erstelle…':'🎮 Raum erstellen'}
          </button>
          <button onClick={()=>setView('home')} style={btn('transparent','#6a5030')}>
            ← Zurück
          </button>
          {mp.error&&<div style={{color:'#f87171',fontSize:13,fontFamily:'system-ui',textAlign:'center'}}>{mp.error}</div>}
        </div>
      )}

      {/* JOIN */}
      {view==='join' && (
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:10}}>
          {/* Name falls noch nicht eingegeben */}
          <input placeholder="Dein Name"
            value={name} onChange={e=>setName(e.target.value)} style={inp}/>
          <input placeholder="6-stelliger Code z.B. XK7F2Q"
            value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}
            style={{...inp,letterSpacing:4,fontSize:18,textAlign:'center'}}
            maxLength={6}/>
          <button onClick={handleJoin}
            disabled={mp.status==='joining'||joinCode.length<6||!name.trim()}
            style={btn(
              (joinCode.length===6&&name.trim())?'#f0e6cc':'#221810',
              (joinCode.length===6&&name.trim())?'#0f0d08':'#4a3020'
            )}>
            {mp.status==='joining'?'Verbinde…':'🔑 Beitreten'}
          </button>
          <button onClick={()=>setView('home')} style={btn('transparent','#6a5030')}>
            ← Zurück
          </button>
          {mp.error&&<div style={{color:'#f87171',fontSize:13,fontFamily:'system-ui',textAlign:'center'}}>{mp.error}</div>}
        </div>
      )}

      {/* WAITING ROOM */}
      {view==='waiting' && (
        <div style={{width:'100%',display:'flex',flexDirection:'column',gap:12,alignItems:'center'}}>

          {/* Code-Anzeige */}
          <div style={{background:'#1a1208',borderRadius:14,padding:'14px 20px',
            textAlign:'center',border:'1px solid rgba(240,230,204,.12)',width:'100%'}}>
            <div style={{fontSize:11,color:'#6a5030',fontFamily:'system-ui',marginBottom:6}}>
              Raum-Code — teile ihn mit deinen Freunden
            </div>
            <div style={{fontSize:32,fontWeight:'bold',letterSpacing:6,color:'#f0e6cc',marginBottom:10}}>
              {mp.roomCode}
            </div>
            <button onClick={copyCode}
              style={{padding:'7px 18px',borderRadius:8,border:'1px solid rgba(240,230,204,.2)',
                background:'transparent',color:copied?'#16A34A':'#a08050',
                cursor:'pointer',fontSize:13,fontFamily:'system-ui'}}>
              {copied?'✓ Kopiert!':'📋 Kopieren'}
            </button>
          </div>

          {/* Spieler-Liste */}
          <div style={{width:'100%',background:'#1a1208',borderRadius:14,
            padding:'12px 16px',border:'1px solid rgba(240,230,204,.08)'}}>
            <div style={{fontSize:12,color:'#6a5030',fontFamily:'system-ui',marginBottom:8}}>
              Spieler im Raum ({Object.keys(roomPlayers).length}/{maxPlayers}):
            </div>
            {Object.values(roomPlayers).map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,
                padding:'6px 0',borderBottom:'1px solid rgba(240,230,204,.05)'}}>
                <div style={{width:12,height:12,borderRadius:'50%',background:HEX[p.color],flexShrink:0}}/>
                <span style={{fontSize:14,fontWeight:'bold'}}>{p.name}</span>
                <span style={{marginLeft:'auto',fontSize:11,color:'#6a5030',fontFamily:'system-ui'}}>
                  {p.color===mp.myColor?'(Du)':''}
                </span>
              </div>
            ))}
            {/* Leere Plätze */}
            {Array.from({length: Math.max(0, maxPlayers-Object.keys(roomPlayers).length)}).map((_,i)=>(
              <div key={`empty-${i}`} style={{display:'flex',alignItems:'center',gap:10,
                padding:'6px 0',borderBottom:'1px solid rgba(240,230,204,.05)',opacity:.3}}>
                <div style={{width:12,height:12,borderRadius:'50%',
                  background:'#3a2a1a',border:'1px dashed #6a5030'}}/>
                <span style={{fontSize:13,fontFamily:'system-ui',color:'#6a5030'}}>Wartet auf Spieler…</span>
              </div>
            ))}
          </div>

          {/* Start-Button (nur Host) */}
          {isHost && (
            <button
              onClick={handleStart}
              disabled={Object.keys(roomPlayers).length < 2}
              style={{...btn(
                Object.keys(roomPlayers).length>=2?'#f0e6cc':'#221810',
                Object.keys(roomPlayers).length>=2?'#0f0d08':'#4a3020'
              ), opacity: Object.keys(roomPlayers).length<2?0.5:1}}>
              {Object.keys(roomPlayers).length<2
                ? '⏳ Warte auf Mitspieler…'
                : `🎮 Spiel starten · ${Object.keys(roomPlayers).length} Spieler`}
            </button>
          )}
          {!isHost && (
            <div style={{color:'#6a5030',fontSize:13,fontFamily:'system-ui',
              animation:'pulse 2s infinite',textAlign:'center'}}>
              ⏳ Warte bis der Host das Spiel startet…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════
export default function App(){
  const [state,dispatch]=useReducer(gameReducer,{screen:'setup',cfg:DEFAULT_CFG});
  const [setupCfg,setSetupCfg]=useState(DEFAULT_CFG);
  const [soundOn,setSoundOn]=useState(true);
  const [showSettings,setShowSettings]=useState(false);
  const gRef=useRef(null);

  // ── Online-Modus State ───────────────────────────────────────
  // screen: 'setup' | 'online-lobby' | 'game'
  const [screen, setScreen] = useState('setup');
  // onlineCtx: {sendAction, myColor, myId} — nur im Online-Modus gesetzt
  const onlineCtxRef = useRef(null);

  useEffect(()=>{gRef.current=state.g;},[state.g]);

  const anim=useAnimation(gRef,soundOn);
  const prevLastMoveRef=useRef(null);
  const prevTurnIdRef=useRef(-1);
  const handledTurnRef=useRef(-1);
  const aiTimerRef=useRef(null);

  // ── Online: Spiel starten nach Lobby ────────────────────────
  const handleOnlineStart = useCallback(({ configs, roomCode, sendAction, myColor, myId, saveState }) => {
    // DIREKT einen Firebase-Listener aufsetzen für eingehende Spielzüge.
    // handleRemoteAction ist in App definiert und ruft dispatch() auf.
    // Dies ersetzt den toten onAction-Kanal in useMultiplayer/OnlineLobby.
    const unsub = fbListen(`rooms/${roomCode}/lastAction`, action => {
      if (!action || action.from === myId) return; // eigene ignorieren
      if (action.type === 'ROLL_RESULT') {
        dispatch({ type:'ROLL_REMOTE', dice: action.payload.dice });
      } else if (action.type === 'PICK') {
        dispatch({ type:'PICK', id: action.payload.id });
      }
    });
    onlineCtxRef.current = { sendAction, myColor, myId, saveState, roomCode, unsubActions: unsub };
    dispatch({ type:'START', cfg: configs });
    setScreen('game');
  }, []);

  // ── Online: Eingehende Aktion von anderen Spielern ───────────
  // Wenn Spieler B würfelt, schickt er {type:'ROLL', payload:{dice:4}} an Firebase.
  // Firebase liefert es an Spieler A → wir rufen hier dispatch() auf.
  // WICHTIG: Der Würfelwert kommt vom sendenden Spieler — wir würfeln
  // NICHT selbst. So sehen alle dasselbe Ergebnis.
  const handleRemoteAction = useCallback((action) => {
    if (action.type === 'ROLL_RESULT') {
      // Anderer Spieler hat gewürfelt und schickt das Ergebnis
      dispatch({ type:'ROLL_REMOTE', dice: action.payload.dice });
    } else if (action.type === 'PICK') {
      dispatch({ type:'PICK', id: action.payload.id });
    }
  }, []);

  // ── Human: Würfeln (lokal + online senden) ──────────────────
  const handleRoll=useCallback(()=>{
    if(anim.blocked) return;
    const g=gRef.current;
    if(!g||g.phase!=='rolling') return;
    const curPlayer = g.players[g.cur];
    if(onlineCtxRef.current && curPlayer.color !== onlineCtxRef.current.myColor) return;
    if(curPlayer.isAI) return;
    anim.setBlocked(true);
    anim.setShowPicker(false);
    anim.clearTimers();
    prevLastMoveRef.current=g.lastMove;
    anim.runDiceAnimation(1300,()=>{
      // Würfelwert ZUERST bestimmen, dann dispatchen und senden
      const dice = Math.floor(Math.random()*6)+1;
      dispatch({type:'ROLL_WITH_DICE', dice});
      onlineCtxRef.current?.sendAction('ROLL_RESULT', { dice });
    });
  },[anim]);

  // ── Human: Figur wählen (lokal + online senden) ─────────────
  const handlePick=useCallback((id)=>{
    if(anim.blocked) return;
    anim.setBlocked(true);
    anim.setShowPicker(false);
    prevLastMoveRef.current=gRef.current?.lastMove??null;
    dispatch({type:'PICK',id});
    // Online: immer senden, auch bei Einzeloption
    onlineCtxRef.current?.sendAction('PICK', { id });
  },[anim]);

  // ── Undo ────────────────────────────────────────────────────
  const handleUndo=useCallback(()=>{
    if(aiTimerRef.current) clearTimeout(aiTimerRef.current);
    anim.clearTimers();
    anim.setAnimPiece(null);
    anim.setHidePieceId(null);
    anim.setCaptureEffect(null);
    anim.setDiceDisplay(null);
    anim.setDiceSpinning?.(false);
    anim.setBlocked(false);
    anim.setShowPicker(false);
    handledTurnRef.current=-1;
    prevLastMoveRef.current=null;
    dispatch({type:'UNDO'});
  },[anim]);

  // ── Zentraler Effect: reagiert auf jeden Spielzug ───────────
  // ARCHITEKTUR:
  //   Schritt 1: Gibt es eine neue Figurbewegung zu zeigen? → immer animieren
  //   Schritt 2: In dem "fertig"-Callback den nächsten Zug aufbauen
  // So wird handleTurnResult/animateAlongPath für JEDEN Zug aufgerufen,
  // egal ob KI→KI, KI→Mensch oder Mensch→KI.
  useEffect(()=>{
    const g=state.g; if(!g) return;
    if(g.turnId===prevTurnIdRef.current) return;
    prevTurnIdRef.current=g.turnId;

    anim.setDiceDisplay(g.dice??null);
    if(g.phase==='over') return;

    // "Was kommt als nächstes?" — wird als Callback nach der Animation aufgerufen
    const setupNextTurn=()=>{
      const gc=gRef.current; if(!gc||gc.phase==='over') return;
      const nextP=gc.players[gc.cur];
      const onlineCtx=onlineCtxRef.current;
      // Ist der aktuelle Spieler ein Online-Gegner?
      // = Online-Modus aktiv UND nicht meine Farbe UND kein KI
      const isRemotePlayer = onlineCtx && !nextP?.isAI && nextP?.color !== onlineCtx.myColor;

      if(gc.phase==='rolling' && nextP?.isAI){
        // KI würfelt (nur lokal, nicht im reinen Online-Modus)
        if(handledTurnRef.current===gc.turnId) return;
        handledTurnRef.current=gc.turnId;
        anim.setBlocked(true);
        aiTimerRef.current=setTimeout(()=>{
          prevLastMoveRef.current=gRef.current?.lastMove??null;
          anim.runDiceAnimation(900,()=>dispatch({type:'ROLL'}));
        }, 500);

      } else if(gc.phase==='rolling' && isRemotePlayer){
        // Online-Gegner ist dran — einfach warten, Firebase liefert ROLL_RESULT
        anim.setBlocked(false);

      } else if(gc.phase==='ai'){
        // KI wählt Figur
        if(handledTurnRef.current===gc.turnId) return;
        handledTurnRef.current=gc.turnId;
        aiTimerRef.current=setTimeout(()=>{
          const g2=gRef.current; if(!g2||g2.phase!=='ai') return;
          const pl=g2.players[g2.cur];
          const cands=pl.pieces.filter(pc=>g2.sel.includes(pc.id));
          const chosen=aiDecide(pl,g2.dice,g2.players,cands,pl.diff);
          prevLastMoveRef.current=g2.lastMove;
          dispatch({type:'PICK',id:chosen.id});
        }, 500);

      } else if(gc.phase==='picking' && isRemotePlayer){
        // Online-Gegner wählt Figur — warten auf PICK via Firebase
        anim.setBlocked(false);

      } else if(gc.phase==='picking'){
        // Lokaler Mensch wählt Figur
        anim.after(400,()=>{anim.setShowPicker(true); anim.setBlocked(false);});

      } else {
        // Lokaler Mensch würfelt
        anim.setBlocked(false);
      }
    };

    // ── Schritt 1: Figurbewegung animieren wenn vorhanden ───────
    const lm=g.lastMove;
    const isNewMove=lm && lm!==prevLastMoveRef.current;

    if(isNewMove){
      prevLastMoveRef.current=lm;
      const path=computePath(lm);
      // animateAlongPath setzt blocked intern nicht — wir übergeben setupNextTurn
      // als "fertig"-Callback. Capture-Sound/Animation läuft intern.
      anim.animateAlongPath(lm, path, ()=>{
        if(g.phase==='over'){ if(soundOn) SFX.win(); return; }
        setupNextTurn();
      });

    } else if(g.phase==='rolling' && !g.players[g.cur]?.isAI){
      // Mensch dran, kein Zug möglich (kein lastMove)
      if(soundOn) SFX.noMove();
      anim.after(600,()=>anim.setBlocked(false));

    } else if(g.phase==='picking'){
      // Mensch hat mehrere Optionen, kein vorheriger Zug
      anim.after(400,()=>{anim.setShowPicker(true); anim.setBlocked(false);});

    } else {
      // KI-Zug ohne Bewegungs-Animation (z.B. kein Zug möglich)
      setupNextTurn();
    }

  },[state.g?.turnId]);

  return(
    <div style={{minHeight:'100vh',background:'#0f0d08',fontFamily:"Georgia,'Times New Roman',serif",
      color:'#f0e6cc',display:'flex',flexDirection:'column',alignItems:'center',
      padding:'6px 4px',gap:8,overflowX:'hidden'}}>
      <style>{`
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes pop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
        @keyframes confetti{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
        @keyframes slideUp{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes diceShake{0%,100%{transform:translate(0,0)rotate(0)}25%{transform:translate(-3px,-2px)rotate(-6deg)}75%{transform:translate(3px,2px)rotate(5deg)}}
        @keyframes glow{0%,100%{box-shadow:0 0 10px rgba(200,176,128,.4)}50%{box-shadow:0 0 22px rgba(200,176,128,.7)}}
        button:focus,input:focus,select:focus{outline:none}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#3a2a1a;border-radius:2px}
      `}</style>
      {showSettings&&<SettingsPanel soundOn={soundOn} setSoundOn={setSoundOn} onClose={()=>setShowSettings(false)}/>}

      {screen==='online-lobby' && (
        <OnlineLobby
          onGameStart={handleOnlineStart}
          onBack={()=>setScreen('setup')}
        />
      )}

      {screen==='setup' && (
        <Setup cfg={setupCfg} setCfg={setSetupCfg}
          onStart={c=>{dispatch({type:'START',cfg:c}); setScreen('game');}}
          onOnline={()=>setScreen('online-lobby')}
          onSettings={()=>setShowSettings(true)}/>
      )}

      {screen==='game' && (
        <GameView state={state} dispatch={dispatch} anim={anim}
          onRoll={handleRoll} onPick={handlePick} onUndo={handleUndo}
          onSettings={()=>setShowSettings(true)}
          onMenu={()=>{onlineCtxRef.current=null; setScreen('setup'); dispatch({type:'MENU'});}}
          myColor={onlineCtxRef.current?.myColor ?? null}/>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
function SettingsPanel({soundOn,setSoundOn,onClose}){
  const Toggle=({val,onChange})=>(
    <div onClick={()=>onChange(!val)} style={{width:42,height:23,borderRadius:12,cursor:'pointer',
      background:val?'#16A34A':'#3a2a1a',position:'relative',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:2,left:val?21:2,width:19,height:19,borderRadius:'50%',
        background:'white',transition:'left .2s'}}/>
    </div>
  );
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:300,backdropFilter:'blur(6px)'}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#1a1208',borderRadius:20,
        padding:'22px 24px',width:'90%',maxWidth:340,
        border:'1px solid rgba(240,230,204,.12)',boxShadow:'0 20px 60px rgba(0,0,0,.6)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:'bold'}}>⚙️ Einstellungen</h3>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:'#6a5030',fontSize:20,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid rgba(240,230,204,.07)'}}>
          <span style={{fontSize:20,width:26}}>🔊</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:'bold',color:'#f0e6cc'}}>Sound</div>
            <div style={{fontSize:11,color:'#6a5030',fontFamily:'system-ui'}}>Würfel-, Schritt- und Treffergeräusche</div>
          </div>
          <Toggle val={soundOn} onChange={setSoundOn}/>
        </div>
        <div style={{marginTop:14,padding:'10px 12px',borderRadius:10,
          background:'rgba(240,230,204,.04)',border:'1px solid rgba(240,230,204,.07)'}}>
          <p style={{margin:0,fontSize:11,color:'#6a5030',fontFamily:'system-ui',lineHeight:1.6}}>
            📱 <strong style={{color:'#8a7050'}}>Vibration & Schütteln</strong> sind nur in einer nativen App / installierten PWA verfügbar.<br/><br/>
            🌐 <strong style={{color:'#8a7050'}}>Online-Multiplayer</strong> kommt im nächsten Sprint!
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════
function Setup({cfg,setCfg,onStart,onOnline,onSettings}){
  const active=cfg.filter(c=>c.active).length;
  const toggle=i=>setCfg(p=>p.map((c,j)=>j===i?{...c,active:!c.active}:c));
  const upd=(i,patch)=>setCfg(p=>p.map((c,j)=>j===i?{...c,...patch}:c));
  return(
    <div style={{width:'100%',maxWidth:420,display:'flex',flexDirection:'column',alignItems:'center',gap:18,paddingTop:22,paddingBottom:28}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',width:'100%'}}>
        <div style={{width:36}}/>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:42,marginBottom:5}}>🎲</div>
          <h1 style={{fontSize:23,fontWeight:'bold',margin:'0 0 3px',lineHeight:1.2}}>Mensch ärgere dich nicht</h1>
          <p style={{color:'#6a5030',margin:0,fontSize:12,fontFamily:'system-ui'}}>Das klassische Brettspiel</p>
        </div>
        <button onClick={onSettings} style={{width:36,height:36,background:'transparent',border:'1px solid #3a2a1a',color:'#6a5030',borderRadius:8,cursor:'pointer',fontSize:14}}>⚙️</button>
      </div>
      <div style={{width:'100%',display:'flex',flexDirection:'column',gap:7}}>
        {cfg.map((c,i)=>(
          <div key={c.color} onClick={()=>toggle(i)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 11px',borderRadius:11,
            border:`2px solid ${c.active?HEX[c.color]+'55':'#ffffff10'}`,
            background:c.active?HEX[c.color]+'10':'transparent',opacity:c.active?1:0.4,cursor:'pointer',transition:'all .18s'}}>
            <div style={{width:22,height:22,borderRadius:'50%',background:HEX[c.color],border:'2px solid rgba(255,255,255,.3)',flexShrink:0}}/>
            <input value={c.name} disabled={!c.active} onClick={e=>e.stopPropagation()} onChange={e=>upd(i,{name:e.target.value})}
              style={{flex:1,background:'transparent',border:'none',borderBottom:'1px solid rgba(240,230,204,.15)',color:'#f0e6cc',fontWeight:'bold',fontSize:14,fontFamily:'inherit',padding:'2px 0'}}/>
            <button disabled={!c.active} onClick={e=>{e.stopPropagation();upd(i,{isAI:!c.isAI});}}
              style={{padding:'3px 9px',borderRadius:7,border:'none',cursor:'pointer',fontSize:12,fontFamily:'system-ui',background:c.isAI?'#1d4ed870':'#15803d70',color:c.isAI?'#93c5fd':'#86efac'}}>
              {c.isAI?'🤖 KI':'👤 Mensch'}
            </button>
            {c.isAI&&c.active&&(
              <select value={c.diff} onClick={e=>e.stopPropagation()} onChange={e=>upd(i,{diff:e.target.value})}
                style={{background:'#1c1410',color:'#f0e6cc',border:'1px solid rgba(240,230,204,.18)',borderRadius:6,padding:'3px 4px',fontSize:11,fontFamily:'system-ui'}}>
                <option value="easy">Leicht</option>
                <option value="medium">Mittel</option>
                <option value="hard">Schwer</option>
              </select>
            )}
          </div>
        ))}
      </div>
      {active<2&&<p style={{color:'#f87171',fontSize:13,margin:0,fontFamily:'system-ui'}}>Mindestens 2 Spieler aktivieren</p>}
      <button disabled={active<2} onClick={()=>onStart(cfg)} style={{width:'100%',padding:'13px 0',borderRadius:14,
        background:active>=2?'#f0e6cc':'#221810',color:active>=2?'#0f0d08':'#4a3020',border:'none',fontSize:15,fontWeight:'bold',
        cursor:active>=2?'pointer':'not-allowed',fontFamily:'inherit',transition:'all .2s',
        boxShadow:active>=2?'0 4px 24px rgba(240,230,204,.12)':'none'}}>
        🎮 Lokal spielen · {active} Spieler
      </button>
      <button onClick={onOnline} style={{width:'100%',padding:'13px 0',borderRadius:14,
        background:'transparent',color:'#a08050',border:'1px solid #a0805040',
        fontSize:15,fontWeight:'bold',cursor:'pointer',fontFamily:'inherit',transition:'all .2s'}}>
        🌐 Online Multiplayer
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GAME VIEW
// ═══════════════════════════════════════════════════════════════
function GameView({state,dispatch,anim,onRoll,onPick,onUndo,onMenu,onSettings,myColor}){
  const{g}=state; if(!g) return null;
  const{players,cur,phase,sel,winner,log}=g;
  const curP=players[cur],isOver=phase==='over';
  const canRoll=phase==='rolling'&&!curP.isAI&&!anim.blocked;
  const ap=flat(players);

  const targets=anim.showPicker?sel.flatMap(id=>{
    const piece=ap.find(p=>p.id===id); if(!piece||!g.dice) return [];
    const m=calcMove(piece,g.dice,players); if(!m) return [];
    if(m.boardPos!=null){const[c,r]=PATH[m.boardPos];return[{x:gx(c),y:gy(r)}];}
    if(m.finishPos!=null){const[c,r]=FINISH[piece.color][m.finishPos];return[{x:gx(c),y:gy(r)}];}
    return[];
  }):[];

  return(
    <div style={{width:'100%',display:'flex',flexDirection:'column',alignItems:'center',gap:8,maxWidth:550}}>
      {isOver&&winner&&<WinnerOverlay winner={winner} players={players} onNew={onMenu}/>}

      <div style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0 2px'}}>
        <span style={{fontSize:12,color:'#4a3020',fontFamily:'system-ui'}}>
          🎲 Figuren ins Ziel{myColor?` · Du: ${DE[myColor]}`:''}
        </span>
        <div style={{display:'flex',gap:5}}>
          <button
            onClick={onUndo}
            disabled={g.history.length===0}
            style={{padding:'5px 9px',background:'transparent',
              color:g.history.length===0?'#2a1a0a':'#a08050',
              border:`1px solid ${g.history.length===0?'#1a0f05':'#a0805040'}`,
              borderRadius:8,cursor:g.history.length===0?'not-allowed':'pointer',
              fontSize:13,fontFamily:'system-ui'}}>↩️</button>
          <button onClick={onMenu}
            style={{padding:'5px 9px',background:'transparent',color:'#a08050',
              border:'1px solid #a0805040',borderRadius:8,cursor:'pointer',fontSize:13,fontFamily:'system-ui'}}>🏠</button>
          <button onClick={onSettings} style={{padding:'5px 9px',background:'transparent',color:'#a08050',
            border:'1px solid #a0805040',borderRadius:8,cursor:'pointer',fontSize:13,fontFamily:'system-ui'}}>⚙️</button>
        </div>
      </div>

      <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'center',width:'100%'}}>
        {players.map(p=>(
          <PanelCard key={p.id} p={p} isActive={p.id===curP.id&&!isOver} dv={p.id===curP.id?anim.diceDisplay:null}/>
        ))}
      </div>

      <BoardSVG ap={ap} sel={anim.showPicker?sel:[]} targets={targets}
        animPiece={anim.animPiece} hidePieceId={anim.hidePieceId}
        captureEffect={anim.captureEffect}
        onPick={id=>anim.showPicker&&onPick(id)}/>

      {!isOver&&(
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,minHeight:82}}>
          {(phase==='rolling'||phase==='picking'||anim.diceSpinning)&&!anim.animPiece&&(
            <DiceWidget display={anim.diceDisplay} spinning={anim.diceSpinning} onClick={onRoll} canClick={canRoll}/>
          )}
          {anim.showPicker&&phase==='picking'&&!anim.blocked&&(
            <PickPanel pieces={sel.map(id=>ap.find(p=>p.id===id)).filter(Boolean)} dice={g.dice} players={players} onPick={onPick}/>
          )}
          {anim.animPiece&&(
            <div style={{color:'#6a5030',fontSize:12,fontFamily:'system-ui',animation:'pulse 1s infinite'}}>♟ Figur zieht…</div>
          )}
          {anim.diceSpinning&&(
            <div style={{color:'#6a5030',fontSize:12,fontFamily:'system-ui',animation:'pulse .6s infinite'}}>
              {curP.isAI?`🤖 ${curP.name} würfelt…`:'🎲 Würfeln…'}
            </div>
          )}
          {phase==='rolling'&&!curP.isAI&&!anim.blocked&&!anim.diceDisplay&&(
            <div style={{color:'#6a5030',fontSize:12,fontFamily:'system-ui'}}>{curP.name} ist am Zug</div>
          )}
        </div>
      )}
      <GameLog log={log}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BRETT SVG
// ═══════════════════════════════════════════════════════════════
function BoardSVG({ap,sel,targets,animPiece,hidePieceId,captureEffect,onPick}){
  const startMark={0:'red',10:'blue',20:'green',30:'yellow'};
  return(
    <svg viewBox={`0 0 ${BSIZ} ${BSIZ}`}
      style={{width:'100%',maxWidth:`${BSIZ}px`,height:'auto',display:'block',borderRadius:16,boxShadow:'0 12px 40px rgba(0,0,0,.8)'}}>

      <rect width={BSIZ} height={BSIZ} fill="#e8d9b5" rx={16}/>
      <rect x={3} y={3} width={BSIZ-6} height={BSIZ-6} fill="none" stroke="#b09060" strokeWidth={1.5} rx={14} opacity={.4}/>

      {Object.entries(CORNERS).map(([color,[c,r]])=>(
        <rect key={color} x={PAD+c*CS+3} y={PAD+r*CS+3} width={4*CS-6} height={4*CS-6}
          fill={CBGR[color]} stroke={HEX[color]} strokeWidth={2} rx={10}/>
      ))}

      <rect x={PAD+4*CS+1} y={PAD+1} width={3*CS-2} height={11*CS-2} fill="rgba(255,255,255,.52)" rx={3}/>
      <rect x={PAD+1} y={PAD+4*CS+1} width={11*CS-2} height={3*CS-2} fill="rgba(255,255,255,.52)" rx={3}/>

      {Object.entries(FINISH).map(([color,cells])=>cells.map(([c,r],i)=>(
        <rect key={`fs-${color}-${i}`} x={PAD+c*CS+2} y={PAD+r*CS+2} width={CS-4} height={CS-4}
          fill={HEX[color]+'30'} stroke={HEX[color]+'60'} strokeWidth={1.5} rx={4}/>
      )))}

      {targets.map((t,i)=>(
        <circle key={`tgt-${i}`} cx={t.x} cy={t.y} r={CS*.43}
          fill="none" stroke="white" strokeWidth={3} opacity={.55} strokeDasharray="6 4">
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${t.x} ${t.y}`} to={`360 ${t.x} ${t.y}`} dur="2.5s" repeatCount="indefinite"/>
        </circle>
      ))}

      {PATH.map(([c,r],i)=>{
        const sc=startMark[i];
        return(
          <g key={`mf-${i}`}>
            <circle cx={gx(c)} cy={gy(r)} r={CS*.43}
              fill={sc?HEX[sc]+'18':'white'} stroke={sc?HEX[sc]:'#c0a06a'} strokeWidth={sc?2.5:1.5}/>
            {sc&&<circle cx={gx(c)} cy={gy(r)} r={CS*.14} fill={HEX[sc]} opacity={.7}/>}
          </g>
        );
      })}

      {Object.entries(HOME).map(([color,cells])=>cells.map(([c,r],i)=>(
        <circle key={`hf-${color}-${i}`} cx={gx(c)} cy={gy(r)} r={CS*.4} fill={HEX[color]+'28'} stroke={HEX[color]} strokeWidth={2}/>
      )))}
      {Object.entries(FINISH).map(([color,cells])=>cells.map(([c,r],i)=>(
        <circle key={`ff-${color}-${i}`} cx={gx(c)} cy={gy(r)} r={CS*.38} fill={HEX[color]+'48'} stroke={HEX[color]} strokeWidth={2}/>
      )))}

      <circle cx={gx(5)} cy={gy(5)} r={CS*.44} fill="white" stroke="#c0a06a" strokeWidth={2}/>
      <text x={gx(5)} y={gy(5)+7} textAnchor="middle" fontSize={18}>⭐</text>

      {/* Figuren (animierte ausgeblendet) */}
      {ap.filter(p=>p.id!==hidePieceId).map(piece=>{
        const{x,y}=pieceXY(piece,ap);
        const s=sel.includes(piece.id);
        return <PieceSVG key={piece.id} piece={piece} x={x} y={y} selectable={s} onClick={()=>s&&onPick(piece.id)}/>;
      })}

      {/* Animierte Figur – Spring-Transition von Feld zu Feld */}
      {animPiece&&(
        <g style={{
          transform:`translate(${animPiece.x}px,${animPiece.y}px)`,
          transition:'transform 195ms cubic-bezier(0.34,1.4,0.64,1)',
        }}>
          <circle r={16} fill="black" opacity={.22} cx={2} cy={3}/>
          <circle r={16} fill={HEX[animPiece.color]} stroke="white" strokeWidth={2.5}/>
          <circle r={9} fill="white" opacity={.28} cx={-3} cy={-3}/>
          <circle r={16} fill="none" stroke="white" strokeWidth={1} opacity={.14}/>
        </g>
      )}

      {/* ── Capture-Effekt — erscheint wenn eine Figur geschlagen wird ── */}
      {captureEffect&&(
        <CaptureEffect
          key={captureEffect.key}
          x={captureEffect.x}
          y={captureEffect.y}
          color={captureEffect.color}
        />
      )}

    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// SPIELFIGUR
// ═══════════════════════════════════════════════════════════════
function PieceSVG({piece,x,y,selectable,onClick}){
  const c=HEX[piece.color],R=15;
  return(
    <g transform={`translate(${x},${y})`} onClick={onClick} style={{cursor:selectable?'pointer':'default'}}>
      <circle r={R+10} fill="transparent"/>
      {selectable&&(
        <>
          <circle r={R+7} fill={c} opacity={0}>
            <animate attributeName="r" values={`${R+3};${R+13};${R+3}`} dur=".8s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values=".25;0;.25" dur=".8s" repeatCount="indefinite"/>
          </circle>
          <circle r={R+3} fill="none" stroke="white" strokeWidth={2.5} opacity={.8} strokeDasharray="5 3">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/>
          </circle>
        </>
      )}
      <circle r={R} fill="black" opacity={.22} cx={2} cy={3}/>
      <circle r={R} fill={c} stroke={selectable?'white':'rgba(255,255,255,.4)'} strokeWidth={selectable?2.5:1.8}/>
      <circle r={R*.55} fill="white" opacity={.27} cx={-3} cy={-3}/>
      <circle r={R} fill="none" stroke="white" strokeWidth={1} opacity={.14}/>
      {piece.status==='finished'&&<text textAnchor="middle" y={5} fontSize={11} fill="white" fontWeight="bold">✓</text>}
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════
// WÜRFEL
// ═══════════════════════════════════════════════════════════════
function DiceWidget({display,spinning,onClick,canClick}){
  const dots=display?DOTS[display]:null;
  const dp=(c,r)=>({position:'absolute',left:`${16+c*33}%`,top:`${16+r*33}%`,
    transform:'translate(-50%,-50%)',width:10,height:10,borderRadius:'50%',background:'#1a1208'});
  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
      <button onClick={canClick?onClick:undefined} style={{
        width:70,height:70,borderRadius:15,
        background:spinning?'#fffcf5':'white',
        border:`2.5px solid ${spinning?'#DC2626':'#c8b080'}`,
        cursor:canClick?'pointer':'default',
        boxShadow:spinning?'0 0 24px rgba(220,38,38,.5),0 4px 18px rgba(0,0,0,.5)':
          canClick?'0 4px 18px rgba(0,0,0,.5)':'0 2px 8px rgba(0,0,0,.4)',
        display:'flex',alignItems:'center',justifyContent:'center',
        transition:'all .2s',
        animation:spinning?'diceShake .1s ease-in-out infinite':canClick?'glow 2s ease-in-out infinite':'none',
        opacity:(!canClick&&!spinning)?0.6:1,
      }}>
        {dots?(
          <div style={{width:46,height:46,position:'relative'}}>
            {dots.map(([c,r],i)=>(
              <div key={i} style={{...dp(c,r),transform:`translate(-50%,-50%) scale(${spinning?0.7+Math.random()*.6:1})`,transition:'transform .05s'}}/>
            ))}
          </div>
        ):(
          <span style={{fontSize:26,color:'#c0a060'}}>?</span>
        )}
      </button>
      {canClick&&!spinning&&(
        <span style={{fontSize:11,color:'#5a4020',fontFamily:'system-ui',animation:'pulse 2s infinite'}}>
          Zum Würfeln klicken
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PICK PANEL
// ═══════════════════════════════════════════════════════════════
function PickPanel({pieces,dice,players,onPick}){
  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:7,animation:'slideUp .3s ease-out'}}>
      <div style={{color:'#f0e6cc',fontSize:13,fontFamily:'system-ui',fontWeight:'bold',animation:'pulse 1.2s ease-in-out infinite'}}>
        ☝️ Figur wählen — Würfel: {dice}
      </div>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',justifyContent:'center'}}>
        {pieces.map(p=>{
          const m=calcMove(p,dice,players);
          let dest='?';
          if(m?.status==='finished')    dest='🏆 Ins Ziel!';
          else if(m?.finishPos!=null)   dest=`Zielkorridor ${m.finishPos+1}`;
          else if(m?.boardPos!=null)    dest=`→ Feld ${m.boardPos}`;
          else if(p.status==='home')    dest='🚀 Raus!';
          const pos=p.status==='home'?'Haus':p.status==='entering'||p.status==='finished'?`Ziel ${(p.finishPos??0)+1}`:`Feld ${p.boardPos}`;
          return(
            <button key={p.id} onClick={()=>onPick(p.id)} style={{
              display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              padding:'8px 14px',borderRadius:11,border:`2px solid ${HEX[p.color]}`,
              background:`${HEX[p.color]}18`,color:'#f0e6cc',cursor:'pointer',
              fontFamily:'system-ui',boxShadow:`0 0 12px ${HEX[p.color]}38`,transition:'all .15s'}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <svg width={16} height={16} viewBox="-16 -16 32 32">
                  <circle r={14} fill={HEX[p.color]} stroke="white" strokeWidth={2.5}/>
                  <circle r={8} fill="white" opacity={.28}/>
                </svg>
                <span style={{fontWeight:'bold',fontSize:13}}>{pos}</span>
              </div>
              <span style={{fontSize:11,color:HEX[p.color],fontWeight:'bold'}}>{dest}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PANEL CARD
// ═══════════════════════════════════════════════════════════════
function PanelCard({p,isActive,dv}){
  const done=p.pieces.filter(pc=>pc.status==='finished').length;
  return(
    <div style={{padding:'7px 10px',borderRadius:11,minWidth:88,
      border:`2px solid ${isActive?HEX[p.color]:'#ffffff0d'}`,
      background:isActive?`${HEX[p.color]}18`:'transparent',
      opacity:isActive?1:0.5,transition:'all .25s',
      boxShadow:isActive?`0 0 16px ${HEX[p.color]}38`:'none'}}>
      <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:5}}>
        <div style={{width:11,height:11,borderRadius:'50%',background:HEX[p.color],flexShrink:0}}/>
        <span style={{fontWeight:'bold',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:68}}>{p.name}</span>
        {p.isAI&&<span style={{fontSize:9}}>🤖</span>}
      </div>
      <div style={{display:'flex',gap:3,marginBottom:3}}>
        {p.pieces.map(pc=>(
          <div key={pc.id} style={{width:12,height:12,borderRadius:'50%',background:HEX[p.color],
            border:'1.5px solid rgba(255,255,255,.2)',
            opacity:pc.status==='finished'?1:pc.status==='home'?0.18:0.72,
            boxShadow:pc.status==='finished'?`0 0 5px ${HEX[p.color]}`:'none',transition:'all .3s'}}/>
        ))}
      </div>
      <div style={{fontSize:10,color:'#5a4020',fontFamily:'system-ui'}}>{done}/4 {done===4?'🏆':''}</div>
      {isActive&&dv&&<div style={{fontSize:14,fontWeight:'bold',color:HEX[p.color],textAlign:'center',marginTop:2}}>🎲 {dv}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SPIELLOG
// ═══════════════════════════════════════════════════════════════
function GameLog({log}){
  const ref=useRef();
  useEffect(()=>{if(ref.current) ref.current.scrollTop=ref.current.scrollHeight;},[log]);
  return(
    <div ref={ref} style={{width:'100%',maxWidth:550,height:62,overflowY:'auto',
      background:'rgba(240,230,204,.03)',borderRadius:10,padding:'5px 12px',
      border:'1px solid rgba(240,230,204,.07)',fontSize:11,color:'#7a6040',fontFamily:'system-ui',
      display:'flex',flexDirection:'column',gap:2}}>
      {log.length===0
        ?<span style={{color:'#3a2a10',textAlign:'center',paddingTop:6}}>Spielverlauf…</span>
        :log.slice(-25).map((e,i)=><div key={i}>{e}</div>)
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GEWINNER OVERLAY
// ═══════════════════════════════════════════════════════════════
function WinnerOverlay({winner,players,onNew}){
  const pieces=useMemo(()=>Array.from({length:45},(_,i)=>({
    id:i,x:Math.random()*100,delay:Math.random()*2.5,
    color:['#DC2626','#2563EB','#16A34A','#CA8A04','#fff','#f59e0b'][Math.floor(Math.random()*6)],
    size:5+Math.random()*8,dur:2.5+Math.random()*2,
  })),[]);
  const ranked=[...players].sort((a,b)=>{
    const fa=a.pieces.filter(p=>p.status==='finished').length;
    const fb=b.pieces.filter(p=>p.status==='finished').length;
    return fb-fa;
  });
  useEffect(()=>{SFX.win();},[]);
  return(
    <>
      <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:149,overflow:'hidden'}}>
        {pieces.map(p=>(
          <div key={p.id} style={{position:'absolute',left:`${p.x}%`,top:'-20px',width:p.size,height:p.size,
            background:p.color,borderRadius:Math.random()>.5?'50%':2,
            animation:`confetti ${p.dur}s ${p.delay}s ease-in both`}}/>
        ))}
      </div>
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.88)',display:'flex',alignItems:'center',
        justifyContent:'center',zIndex:200,backdropFilter:'blur(10px)'}}>
        <div style={{background:'#1a1208',borderRadius:24,padding:'28px 30px',textAlign:'center',
          maxWidth:310,margin:'0 16px',width:'100%',border:`4px solid ${HEX[winner.color]}`,
          boxShadow:`0 0 80px ${HEX[winner.color]}60,0 24px 60px rgba(0,0,0,.7)`,animation:'pop .55s ease-out'}}>
          <div style={{fontSize:50,marginBottom:6}}>🏆</div>
          <h2 style={{fontSize:25,fontWeight:'bold',margin:'0 0 2px'}}>{winner.name}</h2>
          <p style={{color:HEX[winner.color],margin:'0 0 4px',fontSize:15,fontWeight:'bold'}}>{DE[winner.color]} gewinnt!</p>
          <p style={{color:'#5a4030',fontSize:12,margin:'0 0 18px',fontFamily:'system-ui'}}>{winner.captures} Gegner geschlagen</p>
          <div style={{background:'rgba(240,230,204,.05)',borderRadius:12,padding:'10px 12px',marginBottom:18,border:'1px solid rgba(240,230,204,.08)'}}>
            {ranked.map((p,i)=>{
              const done=p.pieces.filter(pc=>pc.status==='finished').length;
              return(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',
                  borderBottom:i<ranked.length-1?'1px solid rgba(240,230,204,.06)':'none'}}>
                  <span style={{width:20,fontSize:13,color:i===0?'#CA8A04':i===1?'#a0a0b0':'#7a6040'}}>
                    {i===0?'🥇':i===1?'🥈':i===2?'🥉':'4.'}
                  </span>
                  <div style={{width:9,height:9,borderRadius:'50%',background:HEX[p.color]}}/>
                  <span style={{flex:1,textAlign:'left',fontSize:13,fontWeight:i===0?'bold':'normal',color:'#f0e6cc'}}>{p.name}</span>
                  <span style={{fontSize:11,fontFamily:'system-ui',color:'#6a5030'}}>{done}/4</span>
                </div>
              );
            })}
          </div>
          <button onClick={onNew} style={{width:'100%',padding:12,background:'#f0e6cc',color:'#1a1208',
            border:'none',borderRadius:12,fontSize:15,fontWeight:'bold',cursor:'pointer',fontFamily:'inherit',
            boxShadow:'0 4px 20px rgba(240,230,204,.15)'}}>
            🔄 Neues Spiel
          </button>
        </div>
      </div>
    </>
  );
}
