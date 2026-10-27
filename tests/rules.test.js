'use strict';
// BUY/SELL rule tests against the real engine (addAction/removePendingAction/lock) in a real browser.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

const tryAdd = (page, type, i, qty) => page.evaluate(([t, i, q]) => { const ok = addAction(t, i, q); return { ok, msg: ok ? '' : document.getElementById('validation').textContent }; }, [type, i, qty]);

async function newGame(players = 2) {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players, timer: 30, ipoPlan: 'none', events: false, bonus: false });
  return { ctx, page };
}
async function finishSubRound(page) {
  await page.click('#lock'); await page.click('#modalReveal'); await page.clock.runFor(1000);
  assert.equal(await H.phase(page), 'COMPLETE');
  await page.click('#nextRound');
}

test('starting cash is ₹10,00,000 and R1.SR1 compulsory-buy rules are enforced', async () => {
  const { ctx, page } = await newGame();
  assert.equal(await page.evaluate(() => S.players.every(p => p.cash === 1000000)), true);
  await page.click('#startRound'); await page.clock.runFor(50);
  // lock with 0 or 1 BUY is refused with a visible reason
  await page.click('#lock');
  assert.match(await page.textContent('#validation'), /2–5 BUY/);
  assert.equal(await H.phase(page), 'DECISION');
  assert.equal((await tryAdd(page, 'BUY', 0, 199)).ok, false);
  assert.match((await tryAdd(page, 'BUY', 0, 501)).msg, /200–500/);
  assert.equal((await tryAdd(page, 'SELL', 0, 200)).ok, false, 'no SELL in R1.SR1 (no short selling)');
  assert.equal((await tryAdd(page, 'SKIP', 0, 0)).ok, false, 'no SKIP in R1.SR1');
  assert.equal((await tryAdd(page, 'BUY', 0, 200)).ok, true);
  assert.match((await tryAdd(page, 'BUY', 0, 200)).msg, /only once/, 'duplicate company rejected');
  await page.click('#lock'); assert.match(await page.textContent('#validation'), /2–5 BUY/, 'one BUY is not enough');
  assert.equal((await tryAdd(page, 'BUY', 1, 200)).ok, true);
  // action removal
  await page.click('[data-remove-action="1"]');
  assert.equal(await page.evaluate(() => S.players[0].actions.length), 1);
  assert.equal((await tryAdd(page, 'BUY', 1, 200)).ok, true);
  for (const i of [2, 3, 4]) assert.equal((await tryAdd(page, 'BUY', i, 200)).ok, true);
  assert.match((await tryAdd(page, 'BUY', 5, 200)).msg, /limit/, 'sixth action rejected (R1.SR1 allows 5)');
  await ctx.close();
});

test('cash, supply and 2,500 cap checks', async () => {
  const { ctx, page } = await newGame();
  await page.click('#startRound'); await page.clock.runFor(50);
  await page.evaluate(() => { S.players[0].holdings[3] = 2400; S.players[0].cash = Math.round(S.stocks[0].price * 300); });
  assert.match((await tryAdd(page, 'BUY', 3, 200)).msg, /2,500/);
  const price = await page.evaluate(() => S.stocks[0].price);
  assert.ok(500 * price > 300 * price, 'precondition: 500 shares unaffordable with cash for 300');
  assert.match((await tryAdd(page, 'BUY', 0, 500)).msg, /cash/i);
  await ctx.close();
});

test('SELL: maturity after two complete sub-rounds, 50% cap, <400 exception, min 200, action limit', async () => {
  const { ctx, page } = await newGame();
  await page.click('#startRound'); await page.clock.runFor(50);
  assert.equal((await tryAdd(page, 'BUY', 0, 500)).ok, true);
  assert.equal((await tryAdd(page, 'BUY', 1, 300)).ok, true);
  assert.equal((await tryAdd(page, 'BUY', 2, 200)).ok, true);
  await finishSubRound(page);                       // → R1.SR2
  await page.click('#startRound'); await page.clock.runFor(50);
  assert.match((await tryAdd(page, 'SELL', 0, 200)).msg, /two-sub-round/, 'not mature after 1 sub-round');
  await finishSubRound(page);                       // → R2.SR1 (shares bought in SR1 now mature)
  await page.click('#startRound'); await page.clock.runFor(50);
  const elig = await page.evaluate(() => [0, 1, 2].map(i => eligibleSellQty(S.players[0], i)));
  assert.deepEqual(elig, [500, 300, 200]);
  assert.match((await tryAdd(page, 'SELL', 0, 300)).msg, /cap|50%/, '500 eligible → max 250');
  assert.match((await tryAdd(page, 'SELL', 0, 199)).msg, /minimum/);
  assert.equal((await tryAdd(page, 'SELL', 0, 250)).ok, true);
  assert.equal((await tryAdd(page, 'SELL', 1, 300)).ok, true, '<400 eligible: all may be sold');
  assert.equal((await tryAdd(page, 'SELL', 2, 200)).ok, true);
  assert.match((await tryAdd(page, 'SELL', 3, 200)).msg, /limit/, 'R2 allows 3 actions');
  const cashBefore = await page.evaluate(() => S.players[0].cash);
  await finishSubRound(page);
  const after = await page.evaluate(() => ({ cash: S.players[0].cash, h: S.players[0].holdings.slice(0, 3) }));
  assert.deepEqual(after.h, [250, 0, 0]);
  assert.ok(after.cash > cashBefore, 'sale proceeds credited');
  await ctx.close();
});

test('settlement is idempotent: repeated CONFIRM / resolveRound cannot double-execute', async () => {
  const { ctx, page } = await newGame();
  await page.click('#startRound'); await page.clock.runFor(50);
  await tryAdd(page, 'BUY', 0, 200); await tryAdd(page, 'BUY', 1, 200);
  await page.click('#lock'); await page.click('#modalReveal'); await page.clock.runFor(1000);
  const snap = await page.evaluate(() => ({ cash: S.players[0].cash, h: S.players[0].holdings.slice(), n: S.history.length, trades: S.tradeJournal.length }));
  const again = await page.evaluate(() => { const r = [resolveRound(), resolveRound()]; return r; });
  assert.deepEqual(again, [false, false]);
  await page.evaluate(() => document.getElementById('confirm').click());
  await page.clock.runFor(1000);
  const snap2 = await page.evaluate(() => ({ cash: S.players[0].cash, h: S.players[0].holdings.slice(), n: S.history.length, trades: S.tradeJournal.length }));
  assert.deepEqual(snap2, snap);
  await ctx.close();
});

test('timer expiry: countdown is visible and the game reaches REVIEW deterministically (idle human)', async () => {
  const { ctx, page } = await newGame(3);
  await page.click('#startRound'); await page.clock.runFor(50);
  const t0 = await page.textContent('#timerPill');
  await page.clock.runFor(3000);
  const t1 = await page.textContent('#timerPill');
  assert.notEqual(t0, t1, 'timer visibly counts down');
  await page.clock.runFor(30000);
  assert.equal(await H.phase(page), 'REVIEW');
  assert.equal(await page.evaluate(() => S.players.every(p => p.locked)), true);
  assert.equal(await page.evaluate(() => S.players[0].actions.length >= 2), true, 'R1.SR1 timeout auto-fills compulsory BUYs');
  await page.click('#confirm'); await page.clock.runFor(1000);
  assert.equal(await H.phase(page), 'COMPLETE');
  assert.equal(await page.evaluate(() => S.history.length), 1);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('price floor/ceiling and share conservation after many settled sub-rounds (engine simulation)', async () => {
  const { ctx, page } = await newGame(4);
  const r = await page.evaluate(() => { try { const out = simulateOneGame(12345, 6); return out; } catch (e) { return { error: String(e) }; } });
  assert.ok(!r || !r.error, JSON.stringify(r));
  await ctx.close();
});
