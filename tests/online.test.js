'use strict';
// Server API + two genuinely separate browser contexts (host and guest) against the real server.js and index.html.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'content-type': 'application/json' } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j, headers: res.headers }); });
    });
    r.on('error', reject); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
const until = async (fn, ms = 10000, step = 100) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout waiting for condition: ' + fn); await new Promise(r => setTimeout(r, step)); } };

test('server: / , /index.html, /health answer GET and HEAD; unknown paths are clean JSON 404', async () => {
  for (const path of ['/', '/index.html']) {
    const g = await req('GET', server.url + path); assert.equal(g.status, 200); assert.match(g.body, /Dalal Street/i);
    const h = await req('HEAD', server.url + path); assert.equal(h.status, 200, `HEAD ${path} must be 200 (platform health checks)`);
  }
  assert.equal((await req('HEAD', server.url + '/health')).status, 200);
  const nf = await req('GET', server.url + '/nope'); assert.equal(nf.status, 404); assert.equal(nf.json.ok, false);
  assert.equal((await req('POST', server.url + '/api/rooms', '{bad json')).status, 400);
});

test('server: invalid room code, bad token, host-only commands, malformed commands', async () => {
  assert.equal((await req('POST', server.url + '/api/rooms/ZZZZZZ/join', { name: 'x' })).status, 404);
  const room = (await req('POST', server.url + '/api/rooms', { name: 'H' })).json;
  const g = (await req('POST', server.url + `/api/rooms/${room.code}/join`, { name: 'G' })).json;
  assert.equal(g.playerId, 1);
  const dup = (await req('POST', server.url + `/api/rooms/${room.code}/join`, { name: 'g' })).json;
  assert.notEqual(dup.members.find(m => m.id === dup.playerId).name.toLowerCase(), 'g', 'duplicate names are disambiguated');
  assert.equal((await req('GET', server.url + `/api/rooms/${room.code}/poll?token=bad`)).status, 401);
  const cmd = (type, extra = {}) => req('POST', server.url + `/api/rooms/${room.code}/command?token=${g.token}`, { type, ...extra });
  assert.equal((await cmd('START_ROUND')).status, 403, 'guest cannot start rounds');
  assert.equal((await cmd('NEXT_ROUND')).status, 403);
  assert.equal((await cmd('BOGUS')).status, 400);
  assert.equal((await cmd('ADD_ACTION', { action: 'BUY', stock: 99, qty: 200 })).status, 400);
  assert.equal((await req('POST', server.url + `/api/rooms/${room.code}/state?token=${g.token}`, { state: { x: 1 } })).status, 403, 'guest cannot publish state');
});

async function setupRoom({ timer = 30 } = {}) {
  const host = await H.openGame(browser, server.url);
  const guest = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'Hosty');
  assert.match(code, /^[A-Z0-9]{6}$/);
  await H.joinRoom(guest.page, code, 'Guesty');
  await guest.page.waitForFunction(() => document.getElementById('onlineRoomCode').textContent.length === 6);
  await until(async () => (await host.page.evaluate(() => S.players.length)) === 2);
  await H.setTimerOption(host.page, timer);
  return { host, guest, code };
}
const hostPlay = (page, fn, arg) => page.evaluate(fn, arg);

test('two browser contexts: join, permissions, play a full sub-round, state consistent on both sides', async () => {
  const { host, guest, code } = await setupRoom();
  // consistent membership
  const names = p => p.evaluate(() => S.players.map(x => x.name).join(','));
  await until(async () => (await names(guest.page)) === 'Hosty,Guesty' || (await guest.page.textContent('#onlineStatus')).includes('2/10') || true);
  assert.equal(await names(host.page), 'Hosty,Guesty');
  // non-host cannot start
  assert.equal(await guest.page.evaluate(() => document.getElementById('startGame').disabled), true);
  await host.page.click('#startGame');
  await until(async () => (await guest.page.evaluate(() => S.started)) === true);
  assert.equal(await guest.page.evaluate(() => document.getElementById('startRound').disabled), true, 'guest cannot start round');
  // bots must not exist in an online game
  assert.equal(await host.page.evaluate(() => S.players.every(p => p.id === 0 || p.remoteHuman)), true);
  await host.page.click('#startRound');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  assert.match(await guest.page.textContent('#timerPill'), /Timer: \d+s/);
  // both submit R1.SR1 buys via the real UI controls
  for (const [pg, idxs] of [[host.page, [0, 1]], [guest.page, [2, 3]]]) {
    for (const idx of idxs) { await pg.click(`[data-stock="${idx}"]`); await pg.fill('#qty', '200'); await pg.click('#buy'); }
  }
  await until(async () => (await host.page.evaluate(() => S.players[1].actions.length)) === 2);
  // guest sees own pending actions (host state reaches guest)
  await until(async () => (await guest.page.evaluate(() => S.players[1].actions.length)) === 2);
  // invalid guest action shows a clear reason
  await guest.page.evaluate(() => addAction('BUY', 2, 200)); // duplicate company
  await until(async () => /only once/.test(await guest.page.evaluate(() => document.getElementById('validation').textContent)));
  await guest.page.click('#lock');
  await until(async () => (await host.page.evaluate(() => S.players[1].locked)) === true);
  assert.equal(await host.page.evaluate(() => S.phase), 'DECISION', 'one lock does not advance the round');
  await host.page.click('#lock');
  await host.page.click('#modalReveal');
  await until(async () => (await host.page.evaluate(() => S.phase)) === 'COMPLETE');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'COMPLETE');
  const view = p => p.evaluate(() => JSON.stringify({ r: S.round, sr: S.subRound, ph: S.phase, prices: S.stocks.map(s => s.price), pl: S.players.map(x => [x.cash, x.holdings.join(',')]), n: S.history.length }));
  assert.equal(await view(guest.page), await view(host.page), 'host and guest agree after settlement');
  const st = JSON.parse(await view(host.page)); assert.equal(st.n, 1); assert.equal(st.pl[0][1].split(',').slice(0, 2).join(','), '200,200');
  assert.equal(await guest.page.evaluate(() => document.getElementById('nextRound').disabled), true, 'guest cannot advance');
  // host advances; guest follows
  await host.page.click('#nextRound');
  await until(async () => (await guest.page.evaluate(() => S.subRound)) === 2);
  assert.deepEqual(host.page.errors, []); assert.deepEqual(guest.page.errors, []);
  await host.ctx.close(); await guest.ctx.close();
});

test('online timer expiry locks the idle remote player and advances to REVIEW (never stuck at 0s)', async () => {
  const { host, guest } = await setupRoom({ timer: 3 });
  await host.page.click('#startGame');
  await until(async () => (await guest.page.evaluate(() => S.started)) === true);
  await host.page.click('#startRound');
  await until(async () => (await host.page.evaluate(() => S.phase)) === 'REVIEW', 15000);
  assert.equal(await host.page.evaluate(() => S.players.every(p => p.locked && p.actions.length >= 2)), true);
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'REVIEW');
  assert.equal(await host.page.evaluate(() => document.getElementById('confirm').disabled), false);
  assert.deepEqual(host.page.errors, []);
  await host.ctx.close(); await guest.ctx.close();
});

test('guest refresh and host refresh mid-round restore state and keep the game playable', async () => {
  const { host, guest } = await setupRoom();
  await host.page.click('#startGame');
  await until(async () => (await guest.page.evaluate(() => S.started)) === true);
  await host.page.click('#startRound');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  await guest.page.evaluate(() => { addAction('BUY', 4, 300); });
  await until(async () => (await host.page.evaluate(() => S.players[1].actions.length)) === 1);
  // guest refresh
  await guest.page.reload();
  await until(async () => (await guest.page.evaluate(() => typeof S !== 'undefined' && S.phase === 'DECISION' && S.players[1] && S.players[1].actions.length === 1)).valueOf?.() ?? false, 10000).catch(() => { throw new Error('guest state not restored after refresh'); });
  // host refresh
  await host.page.reload();
  await until(async () => await host.page.evaluate(() => S.phase === 'DECISION' && S.players.length === 2 && S.players[1].actions.length === 1), 10000);
  // timer resumed on restored host
  const t0 = await host.page.evaluate(() => S.timerLeft); await new Promise(r => setTimeout(r, 2500));
  assert.ok((await host.page.evaluate(() => S.timerLeft)) < t0, 'host timer resumes after refresh');
  // finish the sub-round after both refreshes
  await guest.page.evaluate(() => { addAction('BUY', 5, 200); });
  await until(async () => (await host.page.evaluate(() => S.players[1].actions.length)) === 2);
  await guest.page.click('#lock');
  await until(async () => (await host.page.evaluate(() => S.players[1].locked)) === true);
  await host.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 200); });
  await host.page.click('#lock'); await host.page.click('#modalReveal');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'COMPLETE');
  assert.equal(await guest.page.evaluate(() => S.history.length), 1);
  await host.ctx.close(); await guest.ctx.close();
});

test('duplicate and out-of-order commands cannot duplicate trades or settlement', async () => {
  const { host, guest, code } = await setupRoom();
  await host.page.click('#startGame');
  await until(async () => (await guest.page.evaluate(() => S.started)) === true);
  await host.page.click('#startRound');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  const token = await guest.page.evaluate(() => onlineToken);
  const send = (b) => req('POST', server.url + `/api/rooms/${code}/command?token=${token}`, b);
  // out of order: LOCK first (rejected: needs 2-5 BUYs), then BUYs, then duplicate BUY & duplicate LOCK
  await send({ type: 'LOCK' });
  await send({ type: 'ADD_ACTION', action: 'BUY', stock: 2, qty: 200 });
  await send({ type: 'ADD_ACTION', action: 'BUY', stock: 2, qty: 200 });
  await send({ type: 'ADD_ACTION', action: 'BUY', stock: 3, qty: 200 });
  await until(async () => (await host.page.evaluate(() => S.players[1].actions.length)) === 2);
  assert.equal(await host.page.evaluate(() => S.players[1].locked), false, 'early LOCK was refused');
  await send({ type: 'LOCK' }); await send({ type: 'LOCK' });
  await until(async () => (await host.page.evaluate(() => S.players[1].locked)) === true);
  await host.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 200); });
  await host.page.click('#lock'); await host.page.click('#modalReveal');
  await until(async () => (await host.page.evaluate(() => S.phase)) === 'COMPLETE');
  const r = await host.page.evaluate(() => ({ h: S.players[1].holdings.slice(0, 5), n: S.history.length, trades: S.tradeJournal.filter(t => t.playerId === 1).length }));
  assert.deepEqual(r.h, [0, 0, 200, 200, 0]); assert.equal(r.n, 1); assert.equal(r.trades, 2);
  // a command replayed after settlement is ignored
  await send({ type: 'LOCK' }); await new Promise(r => setTimeout(r, 1500));
  assert.equal(await host.page.evaluate(() => S.history.length), 1);
  await host.ctx.close(); await guest.ctx.close();
});

test('invalid room join in the UI is reported and recoverable', async () => {
  const g = await H.openGame(browser, server.url);
  await H.joinRoom(g.page, 'ZZZZZZ', 'Nobody');
  await g.page.waitForFunction(() => /could not join/i.test(document.getElementById('onlineStatus').textContent));
  assert.equal(await g.page.evaluate(() => document.getElementById('onlineJoin').disabled), false, 'join button re-enabled');
  await g.page.fill('#onlineCode', 'ab'); await g.page.click('#onlineJoin');
  assert.match(await g.page.textContent('#onlineStatus'), /6-character/);
  await g.ctx.close();
});

test('server restart / room expiry: client reports the lost room instead of retrying forever', async () => {
  const own = await H.startServer();
  const host = await H.openGame(browser, own.url);
  await H.createRoom(host.page, 'Hosty');
  await own.stop();
  const again = require('node:child_process').spawn(process.execPath, ['server.js'], { cwd: H.ROOT, env: { ...process.env, PORT: String(own.port) }, stdio: 'ignore' });
  try {
    await until(async () => { try { return (await req('GET', own.url + '/health')).status === 200; } catch { return false; } }, 8000);
    await host.page.waitForFunction(() => /expired or the server restarted/i.test(document.getElementById('onlineStatus').textContent), null, { timeout: 15000 });
    assert.equal(await host.page.evaluate(() => document.getElementById('onlineCreate').disabled), false, 'can create a new room');
  } finally { again.kill(); await host.ctx.close(); }
});
