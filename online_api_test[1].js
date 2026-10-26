'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const port=Number(process.env.TEST_PORT||3198);const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
async function wait(){for(let i=0;i<40;i++){try{const r=await fetch(base+'/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Server failed to start: '+logs);}
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let data={};try{data=await r.json();}catch{}return {status:r.status,data};}
(async()=>{let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS',name);};try{await wait();
 let x=await req('/health');check('health endpoint',()=>assert.equal(x.data.ok,true));
 x=await req('/api/rooms','POST',{name:'Host'});const host=x.data;check('room creation returns host session and six-character code',()=>{assert.equal(x.status,201);assert.match(host.code,/^[A-Z0-9]{6}$/);assert.equal(host.playerId,0);assert.equal(host.host,true);});
 let f=await req(`/api/rooms/${host.code}/join`,'POST',{name:'Host'});check('duplicate names get a unique safe display name',()=>{assert.equal(f.status,201);assert.equal(f.data.members[1].name,'Host 2');});
 const friend=f.data;
 x=await req(`/api/rooms/${host.code}/state?token=${host.token}`,'POST',{state:{started:false,players:[{id:0,privateCards:[{secret:'host'}]},{id:1,privateCards:[{secret:'friend'}]}]}});check('host can publish authoritative state',()=>assert.equal(x.status,200));
 x=await req(`/api/rooms/${host.code}/poll?token=${friend.token}&since=0`);check('friend receives current snapshot with only their private cards',()=>{assert.equal(x.data.state.players[0].privateCards.length,0);assert.equal(x.data.state.players[1].privateCards[0].secret,'friend');});
 x=await req(`/api/rooms/${host.code}/state?token=${friend.token}`,'POST',{state:{started:true}});check('non-host cannot publish state',()=>assert.equal(x.status,403));
 x=await req(`/api/rooms/${host.code}/command?token=${friend.token}`,'POST',{type:'ADD_ACTION',action:'BUY',stock:0,qty:200,playerId:0});check('player action is queued and server pins authenticated player id',()=>{assert.equal(x.status,202);});
 x=await req(`/api/rooms/${host.code}/poll?token=${host.token}&since=1`);const action=x.data.commands.find(c=>c.type==='ADD_ACTION');check('host receives queued action attributed to authenticated friend',()=>assert.equal(action.playerId,1));
 x=await req(`/api/rooms/${host.code}/command?token=${friend.token}`,'POST',{type:'START_ROUND'});check('non-host cannot issue host-only commands',()=>assert.equal(x.status,403));
 await req(`/api/rooms/${host.code}/state?token=${host.token}`,'POST',{state:{started:true,players:[]}});x=await req(`/api/rooms/${host.code}/join`,'POST',{name:'Late'});check('late join rejected after game starts',()=>assert.equal(x.status,409));
 x=await req(`/api/rooms/${host.code}/poll?token=bad&since=0`);check('invalid room token rejected',()=>assert.equal(x.status,401));
 let cap=await req('/api/rooms','POST',{name:'CapHost'});for(let i=2;i<=10;i++){const j=await req(`/api/rooms/${cap.data.code}/join`,'POST',{name:'Cap'+i});assert.equal(j.status,201);}const full=await req(`/api/rooms/${cap.data.code}/join`,'POST',{name:'Extra'});check('room enforces maximum of 10 players',()=>assert.equal(full.status,409));
 console.log(JSON.stringify({ok:true,passed},null,2));
 }catch(e){console.error('FAIL',e.stack||e);process.exitCode=1;}finally{child.kill();}}
)();
