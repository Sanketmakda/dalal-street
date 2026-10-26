const fs = require('fs');
const vm = require('vm');
const pathMod = require('path');
const htmlPath = process.argv[2] || pathMod.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
let script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const oldReturn = `return {ok:true,fingerprint:(digest>>>0).toString(16).padStart(8,'0'),historyLength:S.history.length,ipoLaunched:S.ipoLaunched,bonusRoundPlayed};`;
const newReturn = `const vals=S.players.map(portfolioValue);return {ok:true,fingerprint:(digest>>>0).toString(16).padStart(8,'0'),historyLength:S.history.length,ipoLaunched:S.ipoLaunched,bonusRoundPlayed,bonusMetrics:{spread:Math.max(...vals)-Math.min(...vals),panicRounds:S.history.filter(h=>h.regime==='PANIC').length,bigMoves:S.history.filter(h=>Math.abs(parseFloat(String(h.topMove||'').match(/[+-]([0-9.]+)%/)?.[1]||0))>=2).length}};`;
if (!script.includes(oldReturn)) throw new Error('Could not instrument bonus trigger metrics');
script = script.replace(oldReturn,newReturn);
class ClassList {
  constructor(node){this.node=node;this.s=new Set();}
  add(...xs){xs.forEach(x=>this.s.add(x));}
  remove(...xs){xs.forEach(x=>this.s.delete(x));}
  contains(x){return this.s.has(x);}
  toggle(x, force){if(force===true){this.s.add(x);return true;} if(force===false){this.s.delete(x);return false;} if(this.s.has(x)){this.s.delete(x);return false;}this.s.add(x);return true;}
}
class El {
  constructor(doc,tag='div',attrs={},owner=null){this.doc=doc;this.tagName=tag.toUpperCase();this.attrs={...attrs};this.owner=owner;this.children=[];this._innerHTML='';this._textContent='';this.value=attrs.value||'';this.type=attrs.type||'';this.max=attrs.max||'';this.min=attrs.min||'';this.checked=Object.hasOwn(attrs,'checked');this.disabled=Object.hasOwn(attrs,'disabled');this.style={};this.dataset={};for(const [k,v] of Object.entries(attrs)){if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}this.classList=new ClassList(this);(attrs.class||'').split(/\s+/).filter(Boolean).forEach(c=>this.classList.add(c));this.onclick=null;this.oninput=null;this.onchange=null;this.onkeydown=null;this.listeners={};this.scrollTop=0;this.scrollHeight=0;this.id=attrs.id||'';}
  set innerHTML(v){this._innerHTML=String(v??'');this._textContent=this._innerHTML.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");this.doc.replaceChildrenOf(this,this._innerHTML);}
  get innerHTML(){return this._innerHTML;}
  set textContent(v){this._textContent=String(v??'');this._innerHTML='';this.doc.replaceChildrenOf(this,'');}
  get textContent(){return this._textContent;}
  set innerText(v){this.textContent=v;} get innerText(){return this.textContent;}
  insertAdjacentHTML(_where, html){this.innerHTML=this._innerHTML+html;}
  click(){if(this.disabled)return;this.onclick?.({target:this,preventDefault(){}});}
  focus(){}
  addEventListener(k,fn){(this.listeners[k]||(this.listeners[k]=[])).push(fn);}
  after(node){if(!this.owner)return;const a=this.owner.children;const i=a.indexOf(this);node.owner=this.owner;a.splice(i+1,0,node);}
  select(){}
  getAttribute(k){return this.attrs[k]??null;}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}
}
class Doc {
  constructor(){this.nodes=[];this.byId=new Map();this.baseNodes=[];this.body=new El(this,'body');this.nodes.push(this.body);this.parseInto(this.body,html.split(/<script>/i)[0],true);const sellMax=this.byId.get('sellMax');if(sellMax)sellMax._textContent='SELL MAX ALLOWED';this.body.classList=new ClassList(this);}
  parseInto(owner, source, base=false){
    const stack=[owner]; const re=/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g; let m;
    while((m=re.exec(source))){const raw=m[0],tag=m[1]; if(raw.startsWith('</')){for(let i=stack.length-1;i>0;i--){if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}} continue;}
      const attrs={};const ar=/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;let a;while((a=ar.exec(m[2]))){attrs[a[1]]=a[2]??a[3]??a[4]??'';}
      const el=new El(this,tag,attrs,owner);stack[stack.length-1].children.push(el);this.nodes.push(el);if(base)this.baseNodes.push(el);if(el.id&&!this.byId.has(el.id))this.byId.set(el.id,el);
      if(!/^(input|img|br|hr|meta|link|area|source|wbr)$/i.test(tag)&&!/\/$/.test(m[2].trim()))stack.push(el);
    }
  }
  replaceChildrenOf(owner, source){
    const descendants=new Set();const visit=n=>{for(const c of n.children||[]){descendants.add(c);visit(c);}};visit(owner);
    this.nodes=this.nodes.filter(n=>!descendants.has(n));for(const [id,n] of this.byId)if(descendants.has(n))this.byId.delete(id);owner.children=[];
    this.parseInto(owner,source,false);
  }
  getElementById(id){return this.byId.get(id)||null;}
  createElement(tag){const el=new El(this,tag);this.nodes.push(el);return el;}
  execCommand(){return true;}
  querySelectorAll(sel){
    const all=this.nodes.filter(n=>n!==this.body);
    if(sel.startsWith('.'))return all.filter(n=>n.classList.contains(sel.slice(1)));
    const m=sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(m){const attr=m[1],val=m[2];return all.filter(n=>Object.hasOwn(n.attrs,attr)&&(val===undefined||n.attrs[attr]===val));}
    return [];
  }
  querySelector(sel){if(sel==='#lobby .hero'){const lobby=this.getElementById('lobby');const all=[];const walk=n=>{for(const c of n.children||[]){all.push(c);walk(c);}};if(lobby)walk(lobby);return all.find(n=>n.classList.contains('hero'))||null;}return this.querySelectorAll(sel)[0]||null;}
}
const document = new Doc();
const sessionStore=new Map();const sessionStorage={getItem:k=>sessionStore.get(k)||null,setItem:(k,v)=>sessionStore.set(k,String(v)),removeItem:k=>sessionStore.delete(k)};
const sandbox={document,console,Math,Date,JSON,Number,String,Array,Object,Map,Set,RegExp,Error,TypeError,Promise,Intl,URL,URLSearchParams,encodeURIComponent,location:{href:'http://localhost:3000/'},sessionStorage,fetch:async()=>({ok:true,json:async()=>({ok:true})}),
  setInterval:()=>({unref(){}}),clearInterval:()=>{},setTimeout:()=>({unref(){}}),clearTimeout:()=>{},performance:{now:()=>0},navigator:{userAgent:'Node QA shim'},
};
sandbox.window=sandbox; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
let startupError=null;
try{vm.runInContext(script, sandbox, {timeout:30000,filename:'dalal_street_final_qa_v34.html'});}catch(e){startupError=e.stack||String(e);}
const checks=[];
function check(name,expr){try{const ok=vm.runInContext(expr,sandbox,{timeout:5000});checks.push({name,ok:!!ok});}catch(e){checks.push({name,ok:false,error:String(e.message||e)});}}
if(!startupError){
 check('remote BUY is applied to the authenticated player seat',`S=freshState();resizePlayers(2);S.started=true;S.round=2;S.subRound=1;S.phase='DECISION';S.players[1].remoteHuman=true;onlineHandleHostCommand({type:'ADD_ACTION',playerId:1,action:'BUY',stock:0,qty:200});S.players[1].actions.length===1&&S.players[1].actions[0].type==='BUY'&&S.players[0].actions.length===0`);
 check('remote lock only locks that player and transitions when everyone locks',`S.players[0].locked=true;onlineHandleHostCommand({type:'LOCK',playerId:1});S.players[1].locked&&S.phase==='REVIEW'`);
 check('remote IPO bid reserves cash and records shares',`S=freshState();resizePlayers(2);S.round=3;S.subRound=1;S.phase='COMPLETE';S.ipoPlan='two';S.rng=mulberry32(445);launchIPO(1);const testIpo=S.ipoActiveIndex;S.players[1].remoteHuman=true;onlineHandleHostCommand({type:'IPO_BID',playerId:1,stock:testIpo,qty:200});S.players[1].ipoBids[testIpo]===200&&S.players[1].ipoFrozen===200*S.stocks[testIpo].price`);
 check('non-host UI disables host-only round controls',`onlineRoom='TEST';onlineHost=false;localPlayerId=1;renderAll();document.getElementById('startRound').disabled&&document.getElementById('nextRound').disabled&&document.getElementById('endGame').disabled`);
}
const results={startupError,domNodes:document.nodes.length,ids:document.byId.size,onlinePanel:!!document.getElementById('onlineCreate'),roomCodeField:!!document.getElementById('onlineCode'),checks,failedChecks:checks.filter(x=>!x.ok)}; console.log(JSON.stringify(results,null,2)); if(startupError||results.failedChecks.length)process.exitCode=1;
