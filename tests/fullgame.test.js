'use strict';
// Full offline game driven only through the real UI, with a fake browser clock so 2-minute IPO windows run instantly.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function playSubRound(page) {
  const before = await page.evaluate(() => ({ hist: S.history.length, r: S.round, sr: S.subRound }));
  await page.click('#startRound');
  await page.clock.runFor(50);
  let ph = await H.phase(page);
  if (ph === 'IPO_BID') { // IPO window: human bids through the UI, then the 2-minute window elapses
    await page.fill('#ipoQty', '200'); await page.click('#ipoBid');
    await page.clock.runFor(121000);
    assert.equal(await H.phase(page), 'IPO_COMPLETE');
    await page.click('#nextRound'); // IPO_COMPLETE -> COMPLETE
    await page.click('#startRound'); await page.clock.runFor(50);
    ph = await H.phase(page);
  }
  assert.equal(ph, 'DECISION', `R${before.r}.${before.sr} must reach DECISION`);
  // Human: buy two distinct companies via the UI when affordable (mandatory in R1 SR1), else just lock.
  const need = before.r === 1 && before.sr === 1 ? 2 : 1;
  let done = 0;
  for (let idx = 0; idx < 8 && done < need; idx++) {
    await page.click(`[data-stock="${idx}"]`); await page.fill('#qty', '200');
    if (!(await page.evaluate(() => document.getElementById('buy').disabled))) { await page.click('#buy'); done++; }
  }
  assert.ok(done >= need, 'human could place the required BUYs');
  await page.click('#lock');
  assert.equal(await H.phase(page), 'REVIEW');
  await page.click('#modalReveal');
  await page.clock.runFor(1000);
  assert.equal(await H.phase(page), 'COMPLETE', 'settlement must finish');
  const after = await page.evaluate(() => ({ hist: S.history.length }));
  assert.equal(after.hist, before.hist + 1, 'exactly one settlement per sub-round');
}

test('complete game R1.SR1 → final round with bots, driven through the UI', async () => {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players: 4, timer: 30, ipoPlan: 'two', events: true, bonus: true });
  let guard = 0;
  while (!(await page.evaluate(() => S.gameOver)) && guard++ < 30) {
    await playSubRound(page);
    // Invariants after every settlement
    const inv = await page.evaluate(() => ({
      negPrice: S.stocks.some(s => s.price < 0), over: S.stocks.some(s => s.price > 10000),
      negCash: S.players.some(p => p.cash < 0), cap: S.players.some(p => p.holdings.some((h, i) => h > 2500 && !p.bonusOverflow[i] && !p.eventOverflow[i])),
      supply: S.stocks.map((s, i) => S.players.reduce((n, p) => n + p.holdings[i], 0) + s.total + (s.treasury || 0)),
    }));
    assert.equal(inv.negPrice, false); assert.equal(inv.over, false); assert.equal(inv.negCash, false); assert.equal(inv.cap, false);
    for (const t of inv.supply) assert.equal(t, 10000, 'share supply must reconcile to 10,000');
    if (await page.evaluate(() => S.gameOver)) break;
    if (await page.evaluate(() => S.vitoPromptOpen)) { await page.click('#vitoNo'); }
    const st = await page.evaluate(() => ({ ph: S.phase, v: S.vitoPromptOpen, r: S.round, sr: S.subRound, over: S.gameOver, dis: document.getElementById('nextRound').disabled }));
    assert.equal(st.dis, false, 'NEXT ROUND must be enabled after settlement: ' + JSON.stringify(st));
    await page.click('#nextRound');
  }
  const end = await page.evaluate(() => ({ over: S.gameOver, r: S.round, hist: S.history.length, standings: S.finalStandings?.length }));
  assert.equal(end.over, true, 'game must end by itself');
  assert.ok(end.r >= 10, 'ran through at least Round 10');
  assert.ok(end.hist >= 20, 'at least 20 sub-rounds settled');
  assert.equal(end.standings, 4);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('R1 limits: 5 actions in R1.SR1, 3 in R1.SR2/R2-9, 5 in R10/11', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 2, timer: 30 });
  const limits = await page.evaluate(() => {
    const r = [];
    for (const [round, sr] of [[1, 1], [1, 2], [2, 1], [9, 2], [10, 1], [11, 1]]) { S.round = round; S.subRound = sr; r.push([round, sr, maxActions()]); }
    return r;
  });
  assert.deepEqual(limits, [[1, 1, 5], [1, 2, 3], [2, 1, 3], [9, 2, 3], [10, 1, 5], [11, 1, 5]]);
  await ctx.close();
});
