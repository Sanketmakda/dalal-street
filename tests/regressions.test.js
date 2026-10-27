'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout ' + fn); await new Promise(r => setTimeout(r, 100)); } };

test('A: / and /index.html load without errors; every navigation button opens its page; room URL pre-fills the code', async () => {
  for (const path of ['/', '/index.html', '/?room=ABC234']) {
    const { ctx, page } = await H.openGame(browser, server.url);
    await page.goto(server.url + path);
    assert.match(await page.title(), /Dalal/i);
    const pages = await page.$$eval('[data-page]', els => [...new Set(els.map(e => e.dataset.page))]);
    assert.ok(pages.length >= 4, 'nav buttons exist: ' + pages);
    for (const name of pages) {
      const btn = page.locator(`[data-page="${name}"]`).first();
      if (!(await btn.isVisible())) continue;
      await btn.click();
      assert.equal(await page.evaluate(n => document.getElementById(n).classList.contains('active'), name), true, `page ${name} opens`);
    }
    if (path.includes('room=')) assert.equal(await page.inputValue('#onlineCode'), 'ABC234');
    assert.deepEqual(page.errors, [], path);
    await ctx.close();
  }
});

test('D4 regression: an invalid committed batch from a remote player reopens decisions with a LIVE timer (not stuck)', async () => {
  const host = await H.openGame(browser, server.url), guest = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'H'); await H.joinRoom(guest.page, code, 'G');
  await until(async () => (await host.page.evaluate(() => S.players.length)) === 2);
  await host.page.click('#startGame'); await host.page.click('#startRound');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  const r = await host.page.evaluate(() => {
    // Tamper: lock the remote seat with a single BUY (R1.SR1 needs 2-5) and force the reveal.
    const g = S.players[1]; g.actions = [{ type: 'BUY', i: 0, qty: 200, price: S.stocks[0].price }]; g.locked = true;
    S.players[0].actions = [{ type: 'BUY', i: 0, qty: 200, price: S.stocks[0].price }, { type: 'BUY', i: 1, qty: 200, price: S.stocks[1].price }]; S.players[0].locked = true;
    S.phase = 'REVEAL'; const res = resolveRound();
    return { res, phase: S.phase, locked: g.locked, hist: S.history.length, timerLeft: S.timerLeft };
  });
  assert.deepEqual({ res: r.res, phase: r.phase, locked: r.locked, hist: r.hist }, { res: false, phase: 'DECISION', locked: false, hist: 0 });
  assert.ok(r.timerLeft >= 30);
  const t0 = await host.page.evaluate(() => S.timerLeft); await new Promise(x => setTimeout(x, 2300));
  assert.ok((await host.page.evaluate(() => S.timerLeft)) < t0, 'timer is running again');
  await host.ctx.close(); await guest.ctx.close();
});

test('D5 regression: host refresh while the round is in REVEAL resumes and settles exactly once', async () => {
  const host = await H.openGame(browser, server.url), guest = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'H'); await H.joinRoom(guest.page, code, 'G');
  await until(async () => (await host.page.evaluate(() => S.players.length)) === 2);
  await host.page.click('#startGame'); await host.page.click('#startRound');
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  // Put the room into the exact mid-flight state a refresh could catch: everyone locked, phase REVEAL, not yet resolved.
  await host.page.evaluate(() => { clearInterval(timerId); for (const p of S.players) { p.actions = [{ type: 'BUY', i: 0, qty: 200, price: S.stocks[0].price }, { type: 'BUY', i: 1, qty: 200, price: S.stocks[1].price }]; p.locked = true; p.confirmed = true; } S.phase = 'REVEAL'; });
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'REVEAL');
  await host.page.reload();
  await until(async () => (await host.page.evaluate(() => typeof S !== 'undefined' && S.phase === 'COMPLETE')), 10000);
  await until(async () => (await guest.page.evaluate(() => S.phase)) === 'COMPLETE');
  assert.equal(await host.page.evaluate(() => S.history.length), 1);
  assert.deepEqual(await host.page.evaluate(() => S.players.map(p => p.holdings.slice(0, 2))), [[200, 200], [200, 200]]);
  await host.ctx.close(); await guest.ctx.close();
});

test('D2 regression: opening an IPO window in an online room does not bid or freeze cash for remote humans', async () => {
  const host = await H.openGame(browser, server.url), guest = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'H'); await H.joinRoom(guest.page, code, 'G');
  await until(async () => (await host.page.evaluate(() => S.players.length)) === 2);
  await host.page.evaluate(() => { document.getElementById('ipoPlan').value = 'one'; document.getElementById('ipoPlan').dispatchEvent(new Event('change')); });
  await host.page.click('#startGame');
  await host.page.evaluate(() => { S.round = 3; S.subRound = 1; S.phase = 'COMPLETE'; });
  await host.page.click('#startRound');
  assert.equal(await host.page.evaluate(() => S.phase), 'IPO_BID');
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 500));
  const g = await host.page.evaluate(() => ({ cash: S.players[1].cash, frozen: S.players[1].ipoFrozen, bids: S.players[1].ipoBids.filter(Boolean).length }));
  assert.deepEqual(g, { cash: 1000000, frozen: 0, bids: 0 });
  await host.ctx.close(); await guest.ctx.close();
});
