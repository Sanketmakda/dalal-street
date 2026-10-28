'use strict';
// Room lifecycle, concurrency, recovery, rejected-order, seeded bot games (2/6/10 players) and mobile layout.
// Real server.js + real index.html; multiplayer uses separate browser contexts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

const call = (method, path, body) => new Promise((resolve, reject) => {
  const u = new URL(server.url + path);
  const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'content-type': 'application/json' } }, res => {
    let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, text: b, json: j }); });
  });
  r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
});
const until = async (fn, ms = 12000, step = 100) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout waiting for: ' + fn); await new Promise(r => setTimeout(r, step)); } };

async function room(n = 2, { ipoPlan } = {}) {
  const host = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'Hosty');
  const guests = [];
  for (let i = 1; i < n; i++) {
    const g = await H.openGame(browser, server.url);
    await H.joinRoom(g.page, code, 'Guest' + i);
    await g.page.waitForFunction(() => document.getElementById('onlineRoomCode').textContent.length === 6);
    guests.push(g);
  }
  await until(async () => (await host.page.evaluate(() => S.players.length)) === n);
  if (ipoPlan) await host.page.evaluate(v => { const e = document.getElementById('ipoPlan'); e.value = v; e.dispatchEvent(new Event('change')); }, ipoPlan);
  const tokens = await Promise.all(guests.map(g => g.page.evaluate(() => onlineToken)));
  const send = (i, b) => call('POST', `/api/rooms/${code}/command?token=${tokens[i]}`, b);
  const closeAll = async () => { await host.ctx.close().catch(() => {}); for (const g of guests) await g.ctx.close().catch(() => {}); };
  return { host, guests, code, tokens, send, closeAll };
}

test('late join after the game started is refused (API 409 and a visible UI error)', async () => {
  const r = await room(2);
  await r.host.page.click('#startGame');
  await until(async () => (await r.guests[0].page.evaluate(() => S.started)) === true);
  const api = await call('POST', `/api/rooms/${r.code}/join`, { name: 'Late' });
  assert.equal(api.status, 409); assert.match(api.json.error, /already started/i);
  const late = await H.openGame(browser, server.url);
  await H.joinRoom(late.page, r.code, 'Late');
  await late.page.waitForFunction(() => /could not join/i.test(document.getElementById('onlineStatus').textContent));
  assert.equal(await late.page.evaluate(() => document.getElementById('onlineJoin').disabled), false);
  assert.equal(await r.host.page.evaluate(() => S.players.length), 2, 'roster unchanged');
  assert.deepEqual([...late.page.errors.filter(e => !/40[0-9]/.test(e))], []);
  await late.ctx.close(); await r.closeAll();
});

test('room capacity: the 11th player is refused; malformed codes are clean 404s', async () => {
  const created = (await call('POST', '/api/rooms', { name: 'H' })).json;
  for (let i = 1; i < 10; i++) assert.equal((await call('POST', `/api/rooms/${created.code}/join`, { name: 'P' + i })).status, 201);
  const eleventh = await call('POST', `/api/rooms/${created.code}/join`, { name: 'P10' });
  assert.equal(eleventh.status, 409); assert.match(eleventh.json.error, /full/i);
  for (const bad of ['abc!', '%00', 'A'.repeat(64)]) { const x = await call('POST', `/api/rooms/${bad}/join`, { name: 'x' }); assert.ok([404, 400].includes(x.status), bad + ' → ' + x.status); assert.equal(x.json?.ok, false); }
});

test('rejected orders change nothing and never discard the player\'s valid pending orders', async () => {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players: 2, timer: 30, ipoPlan: 'none', events: false });
  await page.click('#startRound'); await page.clock.runFor(50);
  const snap = () => page.evaluate(() => { const p = S.players[0]; return JSON.stringify({ cash: p.cash, h: p.holdings, a: p.actions, avail: S.stocks.map(s => s.total), hist: S.history.length, trades: S.tradeJournal.length }); });
  assert.equal(await page.evaluate(() => addAction('BUY', 0, 200)), true);
  const before = await snap();
  for (const [t, i, q] of [['BUY', 1, 199], ['BUY', 1, 501], ['BUY', 0, 200], ['SELL', 1, 200], ['SKIP', 1, 0], ['BUY', 99, 200], ['BUY', 1, 200.5], ['BUY', 1, -200]]) {
    assert.equal(await page.evaluate(([t, i, q]) => addAction(t, i, q), [t, i, q]), false, `${t} ${i} ${q} must be rejected`);
    assert.equal(await snap(), before, `${t} ${i} ${q} must leave state untouched`);
    assert.ok((await page.textContent('#validation')).length > 3, 'a reason is shown');
  }
  assert.deepEqual(page.errors, []); await ctx.close();
});

for (const players of [2, 6, 10]) {
  test(`UI-driven bot game, ${players} players: R1.SR1 → R1.SR2 → R2.SR1 settle once each, accounting reconciles`, async () => {
    const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
    await H.startBotGame(page, { players, timer: 30, ipoPlan: 'none', events: true });
    for (let k = 0; k < 3; k++) {
      const pre = await page.evaluate(() => ({ r: S.round, sr: S.subRound, h: S.history.length }));
      await page.click('#startRound'); await page.clock.runFor(50);
      assert.equal(await H.phase(page), 'DECISION');
      assert.equal(await page.evaluate(() => S.players.slice(1).every(p => p.locked && !p.remoteHuman)), true, 'every bot decided and locked through the real engine');
      if (k === 0) { for (const idx of [0, 1]) { await page.click(`[data-stock="${idx}"]`); await page.fill('#qty', '200'); await page.click('#buy'); } }
      await page.click('#lock'); assert.equal(await H.phase(page), 'REVIEW');
      await page.click('#modalReveal'); await page.clock.runFor(1000);
      assert.equal(await H.phase(page), 'COMPLETE');
      const post = await page.evaluate(() => ({ h: S.history.length, bad: auditState().filter(x => !x.ok).map(x => x.label), supply: S.stocks.map((s, i) => S.players.reduce((n, p) => n + p.holdings[i], 0) + s.total + (s.treasury || 0)), pv: S.players.every(p => Math.abs(portfolioValue(p) - (p.cash + p.ipoFrozen + S.stocks.reduce((n, s, i) => n + p.holdings[i] * s.price, 0))) < 0.01), neg: S.players.some(p => p.cash < 0) }));
      assert.equal(post.h, pre.h + 1, `exactly one settlement (R${pre.r}.SR${pre.sr})`);
      assert.deepEqual(post.bad, []); assert.ok(post.supply.every(x => x === 10000)); assert.equal(post.pv, true); assert.equal(post.neg, false);
      if (await page.evaluate(() => S.vitoPromptOpen)) await page.click('#vitoNo');   // a bankruptcy event opened the VITO prompt: decline like a player would
      await page.click('#nextRound');
    }
    assert.deepEqual(await page.evaluate(() => [S.round, S.subRound]), [2, 2], 'after settling R2.SR1 and pressing NEXT the game is at R2.SR2');
    assert.deepEqual(page.errors, []); await ctx.close();
  });
}

test('guest quits mid-round: portfolio freezes, cannot act afterwards, round still completes for the host', async () => {
  const r = await room(2);
  r.guests[0].page.on('dialog', d => d.accept());
  await r.host.page.click('#startGame'); await until(async () => (await r.guests[0].page.evaluate(() => S.started)) === true);
  await r.host.page.click('#startRound'); await until(async () => (await r.guests[0].page.evaluate(() => S.phase)) === 'DECISION');
  await r.guests[0].page.click('#quitGame');
  await until(async () => (await r.host.page.evaluate(() => S.players[1].active)) === false);
  assert.equal(await r.host.page.evaluate(() => S.players[1].status), 'Quit · Frozen');
  await r.send(0, { type: 'ADD_ACTION', action: 'BUY', stock: 2, qty: 200 });
  await new Promise(x => setTimeout(x, 1500));
  assert.equal(await r.host.page.evaluate(() => S.players[1].actions.length), 0, 'a quit player cannot add orders');
  await r.host.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 200); });
  await r.host.page.click('#lock'); await r.host.page.click('#modalReveal');
  await until(async () => (await r.host.page.evaluate(() => S.phase)) === 'COMPLETE');
  const f = await r.host.page.evaluate(() => ({ cash: S.players[1].cash, h: S.players[1].holdings.reduce((a, b) => a + b, 0), hist: S.history.length, audit: auditState().filter(x => !x.ok).map(x => x.label) }));
  assert.deepEqual(f, { cash: 1000000, h: 0, hist: 1, audit: [] });
  assert.deepEqual(r.host.page.errors, []);
  await r.closeAll();
});

test('host disappears: guest is told the game is paused (no host transfer exists in this architecture)', async () => {
  const r = await room(2);
  await r.host.page.click('#startGame'); await until(async () => (await r.guests[0].page.evaluate(() => S.started)) === true);
  await r.host.ctx.close();
  await r.guests[0].page.waitForFunction(() => /host disconnected/i.test(document.getElementById('onlineStatus').textContent), null, { timeout: 30000 });
  const poll = await call('GET', `/api/rooms/${r.code}/poll?token=${r.tokens[0]}&since=0`);
  assert.equal(poll.json.hostOnline, false);
  assert.equal(poll.json.members.filter(m => m.host).length, 1, 'still exactly one host: ownership is never transferred');
  await r.closeAll();
});

test('state versions: a poll that is up to date gets no state; stale publishers cannot rewind; guests cannot publish', async () => {
  const c = (await call('POST', '/api/rooms', { name: 'H' })).json, g = (await call('POST', `/api/rooms/${c.code}/join`, { name: 'G' })).json;
  const pub = s => call('POST', `/api/rooms/${c.code}/state?token=${c.token}`, { state: { started: true, marker: s, players: [] } });
  const v1 = (await pub('A')).json.version, v2 = (await pub('B')).json.version; assert.ok(v2 > v1);
  assert.equal((await call('GET', `/api/rooms/${c.code}/poll?token=${g.token}&since=${v2}`)).json.state, null);
  assert.equal((await call('GET', `/api/rooms/${c.code}/poll?token=${g.token}&since=0`)).json.state.marker, 'B');
  assert.equal((await call('POST', `/api/rooms/${c.code}/state?token=${g.token}`, { state: { marker: 'EVIL' } })).status, 403);
  assert.equal((await call('GET', `/api/rooms/${c.code}/poll?token=${g.token}&since=0`)).json.state.marker, 'B');
});

test('concurrent IPO bids from two guests + host: each processed once, escrow reconciles, oversubscription allocates exactly the supply, repeat finalize is a no-op', async () => {
  const r = await room(3, { ipoPlan: 'one' });
  await r.host.page.click('#startGame'); await until(async () => (await r.guests[0].page.evaluate(() => S.started)) === true);
  await r.host.page.evaluate(() => { S.round = 3; S.subRound = 1; S.phase = 'COMPLETE'; });
  await r.host.page.click('#startRound');
  assert.equal(await r.host.page.evaluate(() => S.phase), 'IPO_BID');
  const idx = await r.host.page.evaluate(() => S.ipoActiveIndex);
  const price = await r.host.page.evaluate(i => S.stocks[i].price, idx);
  await Promise.all([r.send(0, { type: 'IPO_BID', stock: idx, qty: 300 }), r.send(1, { type: 'IPO_BID', stock: idx, qty: 500 }), r.send(1, { type: 'IPO_BID', stock: idx, qty: 500 }), r.host.page.evaluate(([i]) => placeIPOBid(i, 400), [idx])]);
  await until(async () => (await r.host.page.evaluate(i => [0, 1, 2].map(k => S.players[k].ipoBids[i]).join(), idx)) === '400,300,500');
  const frozen = await r.host.page.evaluate(() => S.players.map(p => [p.cash, p.ipoFrozen]));
  assert.deepEqual(frozen, [[1000000 - 400 * price, 400 * price], [1000000 - 300 * price, 300 * price], [1000000 - 500 * price, 500 * price]], 'each bid reserved exactly once');
  // oversubscribe: only 500 shares exist for sale (rest in treasury; ledger still sums to 10,000)
  const res = await r.host.page.evaluate(i => { clearInterval(timerId); S.stocks[i].treasury = 9500; S.stocks[i].total = 500; const ok = finalizeIPO(); const again = finalizeIPO(); return { ok, again, alloc: S.players.map(p => p.holdings[i]), cash: S.players.map(p => p.cash), frozen: S.players.map(p => p.ipoFrozen), total: S.stocks[i].total, audit: auditState().filter(x => !x.ok).map(x => x.label) }; }, idx);
  assert.equal(res.ok, true); assert.equal(res.again, false, 'second finalize is ignored');
  assert.equal(res.alloc.reduce((a, b) => a + b, 0), 500, 'exactly the available supply is allocated');
  [400, 300, 500].forEach((bid, k) => assert.ok(res.alloc[k] <= bid));
  res.alloc.forEach((q, k) => { assert.equal(res.cash[k], 1000000 - q * price, 'unallocated funds refunded'); assert.equal(res.frozen[k], 0); });
  assert.equal(res.total, 0); assert.deepEqual(res.audit, []);
  await r.closeAll();
});

test('simultaneous VITO requests: first valid request wins, the second is rejected, rollback happens once', async () => {
  const r = await room(3);
  await r.host.page.click('#startGame'); await until(async () => (await r.guests[0].page.evaluate(() => S.started)) === true);
  const prompt = await r.host.page.evaluate(() => {
    S.round = 4; S.subRound = 2; S.phase = 'COMPLETE';
    for (const id of [1, 2]) { const p = S.players[id]; p.holdings[1] = 400; p.avg[1] = 80; p.lots[1] = [{ qty: 400, acquiredAt: 0 }]; S.stocks[1].total -= 400; S.ledgerBaseline.players.find(x => x.id === id).holdings[1] = 400; /* fixture: treat as opening holding so journals still reconcile */ }
    S.lastMainRoundClose = S.stocks.map(s => s.price); S.lastMainRoundClose[1] = 88; S.previousPrices = S.stocks.map(s => s.price);
    S.stocks[1].bankruptcySnapshot = makeBankruptcySnapshot(1); S.stocks[1].bankruptcyId = 1; S.stocks[1].bankruptcyRound = S.round; S.stocks[1].price = 0;
    checkVITO(); return S.pendingVito;
  });
  assert.deepEqual(prompt.playerIds.sort(), [1, 2], 'both holders are offered VITO');
  await until(async () => (await r.guests[1].page.evaluate(() => !!S.pendingVito)) === true);
  const rs = await Promise.all([r.send(0, { type: 'VITO', stock: 1, bankruptcyId: 1 }), r.send(1, { type: 'VITO', stock: 1, bankruptcyId: 1 })]);
  assert.deepEqual(rs.map(x => x.status), [202, 202]);
  await until(async () => (await r.host.page.evaluate(() => S.stocks[1].price)) === 88);
  await new Promise(x => setTimeout(x, 1500));
  const f = await r.host.page.evaluate(() => ({ used: S.players.filter(p => p.vitoUsed).map(p => p.id), rollbacks: S.eventJournal.filter(e => e.type === 'VITO_ROLLBACK').length, price: S.stocks[1].price, halt: S.stocks[1].vitoHaltedUntilRound, hold: [1, 2].map(i => S.players[i].holdings[1]), open: S.vitoPromptOpen, audit: auditState().filter(x => !x.ok).map(x => x.label) }));
  assert.equal(f.used.length, 1, 'only one player consumed VITO'); assert.equal(f.rollbacks, 1); assert.equal(f.price, 88); assert.ok(f.halt > 4);
  assert.deepEqual(f.hold, [400, 400], 'ordinary holdings preserved'); assert.equal(f.open, false); assert.deepEqual(f.audit, []);
  await r.closeAll();
});

test('mobile viewport (390×844): every page renders without horizontal overflow or errors, controls reachable', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); }); page.on('requestfailed', q => page.errors.push('failed ' + q.url()));
  await page.goto(server.url + '/');
  const overflow = async () => page.evaluate(() => { const w = innerWidth; const wide = [...document.querySelectorAll('.page.active *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('[style*="overflow"],.table-wrap,.scroll,table'); }).slice(0, 3).map(e => e.tagName + '.' + e.className); return { sw: document.documentElement.scrollWidth, w, wide }; });
  await H.startBotGame(page, { players: 3, timer: 30 });
  const bad = [];
  for (const name of await page.$$eval('[data-page]', els => [...new Set(els.map(e => e.dataset.page))])) {
    const b = page.locator(`[data-page="${name}"]`).first(); if (!(await b.isVisible())) continue; await b.click();
    const o = await overflow(); if (o.sw > o.w + 2) bad.push(`${name}: scrollWidth ${o.sw} > ${o.w} (${o.wide.join(' ')})`);
  }
  await page.locator('[data-page="game"]').first().click();
  for (const id of ['startRound', 'lock', 'buy']) { const box = await page.locator('#' + id).boundingBox(); assert.ok(box && box.width > 20 && box.height > 20, id + ' has a tappable size'); }
  assert.deepEqual(bad, [], 'horizontal overflow on mobile'); assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('Defect A (Oct-27 screenshot): after R1.SR1 settles, START is not offered for the finished slot and clicking it cannot restart the round', async () => {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players: 3, timer: 30, ipoPlan: 'none', events: false });
  await page.click('#startRound'); await page.clock.runFor(50);
  for (const i of [0, 1]) { await page.click(`[data-stock="${i}"]`); await page.fill('#qty', '200'); await page.click('#buy'); }
  await page.click('#lock'); await page.click('#modalReveal'); await page.clock.runFor(1000);
  const ui = await page.evaluate(() => ({ badge: document.getElementById('statusPill').textContent, start: document.getElementById('startRound').textContent, startOn: !document.getElementById('startRound').disabled, nextOn: !document.getElementById('nextRound').disabled, counter: [...document.querySelectorAll('#myStats .stat')].find(e => /Actions/.test(e.textContent)).textContent }));
  assert.equal(ui.badge, 'COMPLETE');
  assert.equal(ui.startOn, false, 'START must not be enabled for a settled slot');
  assert.doesNotMatch(ui.start, /SUB-ROUND 1$/, 'must not offer the already-played slot');
  assert.equal(ui.nextOn, true, 'the one legal action is advancing');
  assert.match(ui.counter, /0 \/ 3/, 'counter shows the NEXT slot\'s limit (R1.SR2 = 3), not the stale 5');
  const before = await page.evaluate(() => JSON.stringify({ h: S.history.length, ph: S.phase, b: S.players.map(p => p.actions.length), seed: S.rngN }));
  await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('startRound').click(); });
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(() => JSON.stringify({ h: S.history.length, ph: S.phase, b: S.players.map(p => p.actions.length), seed: S.rngN })), before, 'forced START clicks are no-ops');
  assert.deepEqual(page.errors, []); await ctx.close();
});
