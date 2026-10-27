'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const MAX_PLAYERS = 10;
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const json = (res, status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(body)); };
const token = () => crypto.randomBytes(24).toString('base64url');
const code = () => { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=alphabet[crypto.randomInt(alphabet.length)]; return s; };
function readBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1_500_000){reject(new Error('Request too large'));req.destroy();}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});}
function cleanRoom(room){ if(Date.now()-room.touchedAt>ROOM_TTL_MS) rooms.delete(room.code); }
function memberFor(room, t){ return room.members.find(m=>m.token===t); }
function safeMembers(room){ return room.members.map(({id,name,host,ready,lastSeen})=>({id,name,host:!!host,ready:!!ready,online:!lastSeen||Date.now()-lastSeen<15000})); }
// Per-member view of the authoritative host state. The HOST receives everything (its browser runs the engine).
// A GUEST receives only: its own private cards, its own pending orders/bids, and public data. Hidden information is
// removed here, in the protocol — never merely hidden by CSS. Identity comes from the room token, never from the request.
function personalizedState(room, member){
  if(!room.state) return null;
  const state=JSON.parse(JSON.stringify(room.state));
  if(member.host) return state;
  const me=member.id, hideDecisions=['DECISION','REVIEW'].includes(state.phase), hideBids=state.phase==='IPO_BID';
  for(const k of ['cardPool','cardDiscard','seed','rngN','rng','ledgerBaseline']) delete state[k];   // undealt cards + RNG state would let a guest infer/predict other hands
  if('currentIntel' in state) state.currentIntel=Array.isArray(state.currentIntel)?state.currentIntel.filter(x=>x&&x.player===me):[];   // fail closed on any unexpected shape
  if(Array.isArray(state.history)) state.history.forEach(h=>{ if(h) delete h.seed; });
  if(Array.isArray(state.players)) for(const p of state.players){
    if(p.id===me) continue;
    p.privateCards=[]; p.revealedCards=[];
    if(hideDecisions&&Array.isArray(p.actions)) p.actions=[];                                       // simultaneous hidden orders
    if(hideBids&&Array.isArray(p.ipoBids)) p.ipoBids=p.ipoBids.map(()=>0);                          // sealed IPO bids
  }
  if(hideBids&&Array.isArray(state.eventJournal)) state.eventJournal=state.eventJournal.filter(e=>!(e&&e.type==='IPO_BID'&&e.playerId!==me));
  return state;
}
const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, `http://${req.headers.host||'localhost'}`);
    if((req.method==='GET'||req.method==='HEAD') && url.pathname==='/health'){ if(req.method==='HEAD'){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end();} return json(res,200,{ok:true,service:'Dalal Street friend-test server',rooms:rooms.size}); }
    if((req.method==='GET'||req.method==='HEAD') && (url.pathname==='/' || url.pathname==='/index.html')) {res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});if(req.method==='HEAD')return res.end();return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);}
    if(req.method==='GET' && url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
    if(req.method==='POST' && url.pathname==='/api/rooms'){
      const b=await readBody(req); const name=String(b.name||'Host').trim().slice(0,24)||'Host'; let c; do{c=code()}while(rooms.has(c)); const hostToken=token(); const room={code:c,hostToken,members:[{id:0,name,token:hostToken,host:true,ready:true,lastSeen:Date.now()}],state:null,version:0,commands:[],seq:0,chat:[],touchedAt:Date.now(),started:false};rooms.set(c,room);return json(res,201,{ok:true,code:c,token:hostToken,playerId:0,host:true,members:safeMembers(room)});
    }
    const joinMatch=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/join$/);
    if(req.method==='POST' && joinMatch){const c=joinMatch[1].toUpperCase(),room=rooms.get(c);if(!room)return json(res,404,{ok:false,error:'Room not found or expired.'});cleanRoom(room);if(!rooms.has(c))return json(res,404,{ok:false,error:'Room expired.'});const b=await readBody(req);if(room.started||room.state?.started)return json(res,409,{ok:false,error:'This game has already started. Late joining is disabled.'});if(room.members.length>=MAX_PLAYERS)return json(res,409,{ok:false,error:'Room is full (10 players maximum).'});let name=String(b.name||'Player').trim().slice(0,24)||'Player';if(room.members.some(m=>m.name.toLowerCase()===name.toLowerCase())){const base=name;let suffix=2;while(room.members.some(m=>m.name.toLowerCase()===`${base} ${suffix}`.toLowerCase()))suffix++;name=`${base} ${suffix}`.slice(0,24);}const id=Math.max(...room.members.map(m=>m.id))+1,t=token();room.members.push({id,name,token:t,host:false,ready:true,lastSeen:Date.now()});room.touchedAt=Date.now();room.commands.push({id:crypto.randomUUID(),seq:++room.seq,type:'MEMBERS_CHANGED',playerId:id,name});return json(res,201,{ok:true,code:c,token:t,playerId:id,host:false,members:safeMembers(room)});}
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/(poll|state|command|chat)$/);
    if(match){const c=match[1].toUpperCase(),action=match[2],room=rooms.get(c);if(!room)return json(res,404,{ok:false,error:'Room not found or expired.'});const t=url.searchParams.get('token')||req.headers['x-room-token'];const member=memberFor(room,t);if(!member)return json(res,401,{ok:false,error:'Invalid room session. Rejoin the room.'});room.touchedAt=Date.now();member.lastSeen=Date.now();
      if(req.method==='GET'&&action==='poll'){const since=Number(url.searchParams.get('since')||0);let commands=[];if(member.host){const ack=Number(url.searchParams.get('ack')||0);if(ack>0)room.commands=room.commands.filter(c=>c.seq>ack);commands=room.commands.slice(0,100);}const state=room.version>since?personalizedState(room,member):null;return json(res,200,{ok:true,code:c,playerId:member.id,host:member.host,hostOnline:room.members.some(m=>m.host&&Date.now()-(m.lastSeen||0)<15000),members:safeMembers(room),version:room.version,state,commands,chat:room.chat.slice(-60)});}
      if(req.method==='POST'&&action==='state'){if(!member.host)return json(res,403,{ok:false,error:'Only the host can publish authoritative game state.'});const b=await readBody(req);if(!b.state||typeof b.state!=='object')return json(res,400,{ok:false,error:'Missing state snapshot.'});if(JSON.stringify(b.state).length>1_300_000)return json(res,413,{ok:false,error:'State snapshot too large.'});room.state=b.state;room.version++;room.started=!!b.state.started;room.touchedAt=Date.now();return json(res,200,{ok:true,version:room.version});}
      if(req.method==='POST'&&action==='command'){const b=await readBody(req);const type=String(b.type||'');const playerAction=['ADD_ACTION','REMOVE_ACTION','LOCK','IPO_BID','QUIT','CHAT','VITO','VITO_DECLINE'].includes(type);const hostAction=['START_GAME','START_ROUND','CONFIRM_REVEAL','NEXT_ROUND','END_GAME'].includes(type);if(!playerAction&&!hostAction)return json(res,400,{ok:false,error:'Unsupported command.'});if(hostAction&&!member.host)return json(res,403,{ok:false,error:'Only the room host can perform this action.'});if(type==='CHAT'){const message=String(b.message||'').trim().slice(0,240);if(!message)return json(res,400,{ok:false,error:'Empty message.'});room.chat.push({playerId:member.id,name:member.name,message,at:Date.now()});room.chat=room.chat.slice(-100);return json(res,200,{ok:true});}if(type==='ADD_ACTION'&&(!Number.isInteger(b.stock)||b.stock<0||b.stock>9||!['BUY','SELL','SKIP'].includes(b.action)||!Number.isInteger(b.qty)||b.qty<0||b.qty>10000))return json(res,400,{ok:false,error:'Malformed trade action.'});if(type==='IPO_BID'&&(!Number.isInteger(b.stock)||b.stock<0||b.stock>9||!Number.isInteger(b.qty)||b.qty<0||b.qty>500))return json(res,400,{ok:false,error:'Malformed IPO bid.'});room.commands.push({...b,id:crypto.randomUUID(),seq:++room.seq,type,playerId:member.id});if(room.commands.length>500)room.commands=room.commands.slice(-500);return json(res,202,{ok:true,queued:true});}
    }
    json(res,404,{ok:false,error:'Not found.'});
  } catch(e){ if(!res.headersSent) json(res,400,{ok:false,error:e.message||'Bad request'}); }
});
setInterval(()=>{for(const room of rooms.values())cleanRoom(room);},60_000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Dalal Street friend-test server listening on ${PORT}`));
