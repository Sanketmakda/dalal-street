'use strict';
// Post-deployment smoke test. Usage: node tests/live_smoke.js https://your-app.onrender.com
// Uses only HTTP (no browser): page served, HEAD ok, health, room create/join/command, privacy of guest state, unknown-room 404.
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('usage: node tests/live_smoke.js <base-url>'); process.exit(2); }
let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails++; };
const call = async (method, path, body, ms = 60000) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const text = await method === 'HEAD' ? '' : await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};
(async () => {
  const h = await call('GET', '/health'); ok('GET /health', h.status === 200 && h.json?.ok === true, JSON.stringify(h.json));
  ok('HEAD /health', (await call('HEAD', '/health')).status === 200);
  const g = await call('GET', '/'); ok('GET / serves the game', g.status === 200 && /Dalal Street/i.test(g.text) && g.text.length > 100000, g.text.length + ' bytes');
  ok('HEAD /', (await call('HEAD', '/')).status === 200);
  ok('index.html contains the round-2 fixes', /controlState/.test(g.text) && /How to read Private Intel/i.test(g.text));
  const room = await call('POST', '/api/rooms', { name: 'SmokeHost' }); ok('create room', room.status === 201 && /^[A-Z0-9]{6}$/.test(room.json?.code || ''), room.json?.code);
  if (room.json?.code) {
    const c = room.json.code, ht = room.json.token;
    const guest = await call('POST', `/api/rooms/${c}/join`, { name: 'SmokeGuest' }); ok('guest joins', guest.status === 201 && guest.json.playerId === 1);
    const gt = guest.json?.token;
    ok('guest cannot start rounds', (await call('POST', `/api/rooms/${c}/command?token=${gt}`, { type: 'START_ROUND' })).status === 403);
    ok('guest cannot publish state', (await call('POST', `/api/rooms/${c}/state?token=${gt}`, { state: { x: 1 } })).status === 403);
    const secret = 'SECRET-CARD-' + Date.now();
    const pub = await call('POST', `/api/rooms/${c}/state?token=${ht}`, { state: { started: true, players: [{ id: 0, privateCards: [{ cardId: secret }] }, { id: 1, privateCards: [] }], currentIntel: [{ player: 0, cards: [{ cardId: secret }] }], cardPool: [secret], seed: 123 } });
    ok('host publishes state', pub.status === 200);
    const poll = await call('GET', `/api/rooms/${c}/poll?token=${gt}&since=0`);
    ok("guest payload does not contain the host's unrevealed card", poll.status === 200 && !poll.text.includes(secret));
    ok('bad token rejected', (await call('GET', `/api/rooms/${c}/poll?token=nope`)).status === 401);
  }
  ok('unknown room is 404', (await call('POST', '/api/rooms/ZZZZZZ/join', { name: 'x' })).status === 404);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
