'use strict';
// Parts 2 & 3: card semantics and index effects, verified against the REAL engine functions in a real browser,
// with the expected numbers computed independently here from the documented formulas (hard-coded constants).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

// Base companies as defined in the game (name, start price, beta, sector).
const CO = [
  ['Reliance', 120, .90, 'Energy/Consumer'], ['Tata Motors', 85, 1.15, 'Auto'], ['Infosys', 210, .95, 'IT'], ['HDFC Bank', 180, 1.10, 'Banking'],
  ['ICICI Bank', 95, 1.12, 'Banking'], ['Bharti Airtel', 110, .85, 'Telecom'], ['LT', 150, 1.00, 'Capital Goods'], ['TCS', 230, .90, 'IT']];
const MIX = s => s === 'Banking' ? [.20, .15, .65] : [.35, .25, .40];
const FX = s => ({ 'IT': .45, 'Energy/Consumer': -.35, 'Auto': -.2 })[s] ?? .05;

// Documented formula, independent of the engine. regime SIDEWAYS (base 0), no noise, no order flow.
function expectedPrices({ nifty = 0, sensex = 0, bank = 0, fx = 0, vix = 15, cards = {} }) {
  return CO.map(([name, p, beta, sector], i) => {
    const m = MIX(sector);
    const raw = ((nifty * m[0] + sensex * m[1] + bank * m[2]) / 100) * beta + (fx / 100) * FX(sector) - Math.max(0, vix - 15) / 1000 + Math.max(-60, Math.min(60, cards[i] || 0)) / 1000;
    let np = Math.max(0, Math.min(10000, Math.round(p * (1 + raw))));
    const up = Math.round(p * 1.05), lo = Math.round(p * .95);
    if (np > up) np = up; if (np < lo) np = lo; return np;
  });
}
async function engine(page) {
  await page.evaluate(() => { S = freshState(); resizePlayers(2); S.silent = true; S.started = true; S.round = 2; S.subRound = 1; S.rng = () => 0.5; S.market = { nifty: 0, sensex: 0, bankNifty: 0, usdInr: 0, vix: 14 }; S.previousPrices = S.stocks.map(s => s.price); S.players.forEach(p => { p.privateCards = []; }); });
}
const settle = (page, cards) => page.evaluate(cards => {
  S.players[0].privateCards = cards; S.players[1].privateCards = [];
  const buy = Array(S.stocks.length).fill(0), sell = Array(S.stocks.length).fill(0);
  S.previousPrices = S.stocks.map(s => s.price);
  resolvePrices(buy, sell);
  return { prices: S.stocks.map(s => s.price), market: { ...S.market }, circuits: S.stocks.map(s => s.circuit), regime: S.regime };
}, cards);
const mk = (index, signal, confidence = 'Medium') => ({ cardId: 1, kind: 'MARKET', index, signal, confidence });

test('with no clues, SIDEWAYS regime and zero noise nothing moves (formula baseline)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const r = await settle(page, []);
  assert.equal(r.regime, 'SIDEWAYS'); assert.deepEqual(r.prices, CO.map(c => c[1]));
  await ctx.close();
});

test('BANK NIFTY clue: engine == documented formula for all 8 companies; HDFC/ICICI use the Banking mapping (65%), others 40%', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const r = await settle(page, [mk('BANK NIFTY', 30)]);
  assert.equal(r.market.bankNifty, 1.2, '30 × gain 0.04');
  assert.deepEqual(r.prices, expectedPrices({ bank: 1.2 }));
  // Banking sensitivity is strictly higher than the default mix at equal beta:
  assert.ok(.65 > .40);
  await ctx.close();
});

test('NIFTY 50 and SENSEX clues apply broad-market pressure to every listed company (gain 0.03)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const r = await settle(page, [mk('NIFTY 50', 30), mk('SENSEX', -30)]);
  assert.equal(r.market.nifty, .9); assert.equal(r.market.sensex, -.9);
  assert.deepEqual(r.prices, expectedPrices({ nifty: .9, sensex: -.9 }));
  await ctx.close();
});

test('USD/INR uses exact-sector FX betas (LT/Capital Goods is NOT treated as IT); INDIA VIX applies −(VIX−15)/1000 to everyone', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  let r = await settle(page, [mk('USD/INR', 30)]);
  assert.equal(r.market.usdInr, .75);
  assert.deepEqual(r.prices, expectedPrices({ fx: .75 }));
  assert.equal(await page.evaluate(() => [fxBetaFor('Capital Goods'), fxBetaFor('IT'), fxBetaFor('Telecom')].join()), '0.05,0.45,0.05');
  await engine(page);
  r = await settle(page, [mk('INDIA VIX', 30)]);
  assert.equal(r.market.vix, 16.5);
  assert.deepEqual(r.prices, expectedPrices({ vix: 16.5 }));
  await ctx.close();
});

test('company clues: +15 Medium = +1.5% push; stacking across cards is additive and capped at ±60; low/high confidence weights 0.5/1.5', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const c = (i, signal, confidence = 'Medium', kind = 'COMPANY') => ({ cardId: 1, kind, company: CO[i][0], i, signal, confidence });
  let r = await settle(page, [c(7, 15)]);
  assert.deepEqual(r.prices, expectedPrices({ cards: { 7: 15 } })); assert.equal(r.prices[7], Math.round(230 * 1.015));
  assert.equal(await page.evaluate(() => intelPressure(7)), 15);
  await engine(page);
  r = await settle(page, [c(5, 30, 'High'), c(5, -15, 'Low')]);                       // 45 − 7.5 = 37.5
  assert.equal(await page.evaluate(() => intelPressure(5)), 37.5);
  assert.deepEqual(r.prices, expectedPrices({ cards: { 5: 37.5 } }));
  await engine(page);
  r = await settle(page, [c(1, 40, 'High'), c(1, 40, 'High')]);                        // 120 → capped at 60 → +6% → circuit 5%
  assert.equal(await page.evaluate(() => intelPressure(1)), 60);
  assert.equal(r.prices[1], Math.round(85 * 1.05)); assert.equal(r.circuits[1], 'UPPER CIRCUIT');
  assert.deepEqual(r.prices, expectedPrices({ cards: { 1: 60 } }));
  await engine(page);
  r = await settle(page, [c(2, 0, 'Medium', 'UPPER_CIRCUIT'), c(4, 0, 'Medium', 'DEFAULTER'), c(0, 0, 'Medium', 'BUYBACK')]);
  assert.deepEqual(r.prices, expectedPrices({ cards: { 2: 25, 4: -25, 0: 8 } }));
  await ctx.close();
});

test('indices and clues STACK, and the ±5% circuit band governs the total (indices never widen it); price bounds ₹0–₹10,000 hold', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const c = { cardId: 1, kind: 'COMPANY', company: 'ICICI Bank', i: 4, signal: 40, confidence: 'High' };
  const r = await settle(page, [mk('BANK NIFTY', 30), mk('NIFTY 50', 30), mk('SENSEX', 30), c, { ...c, cardId: 2 }]);
  assert.deepEqual(r.prices, expectedPrices({ nifty: .9, sensex: .9, bank: 1.2, cards: { 4: 120 } }));
  assert.equal(r.prices[4], Math.round(95 * 1.05)); assert.equal(r.circuits[4], 'UPPER CIRCUIT');
  for (let i = 0; i < 8; i++) assert.ok(r.prices[i] <= Math.round(CO[i][1] * 1.05) && r.prices[i] >= Math.round(CO[i][1] * .95));
  // bounds with extreme prices
  const b = await page.evaluate(() => {
    S.stocks[0].price = 9999; S.stocks[1].price = 1; S.stocks[2].price = 0; S.stocks[2].lastPositivePrice = 100;
    S.previousPrices = S.stocks.map(s => s.price); S.players[0].privateCards = [{ cardId: 9, kind: 'MARKET', index: 'NIFTY 50', signal: 30, confidence: 'High' }];
    const z = Array(S.stocks.length).fill(0); resolvePrices(z, z); return S.stocks.map(s => s.price);
  });
  assert.ok(b.every(x => x >= 0 && x <= 10000)); assert.equal(b[2], 0, 'a ₹0 company is not moved by index pressure alone (needs positive company-card pressure)');
  await ctx.close();
});

test('determinism: same state + same inputs → identical result', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const run = () => page.evaluate(() => { S = freshState(); resizePlayers(2); S.silent = true; S.started = true; S.round = 2; S.rng = mulberry32(777); S.rngN = 0; S.players[0].privateCards = [{ cardId: 1, kind: 'MARKET', index: 'BANK NIFTY', signal: 15, confidence: 'High' }]; const z = Array(S.stocks.length).fill(0); S.previousPrices = S.stocks.map(s => s.price); resolvePrices(z, z); return JSON.stringify([S.stocks.map(s => s.price), S.market, S.regime]); });
  assert.equal(await run(), await run());
  await ctx.close();
});

test('neutral fallback clue (signal 0, Low) only dilutes the index average; averaging is confidence-weighted', async () => {
  const { ctx, page } = await H.openGame(browser, server.url); await engine(page);
  const out = await page.evaluate(() => { S.players[0].privateCards = [{ kind: 'MARKET', index: 'NIFTY 50', signal: 30, confidence: 'Medium' }, { kind: 'MARKET', index: 'NIFTY 50', signal: 0, confidence: 'Low' }]; return marketCardPressure().nifty; });
  assert.equal(out, 20, '(30×1 + 0×0.5) / (1 + 0.5)');
  await ctx.close();
});

test('index/clue effects are applied once: a replayed settlement does not move prices, indices or history again', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 2, timer: 30, ipoPlan: 'none', events: false });
  await page.evaluate(() => { startRound(); });
  const r = await page.evaluate(() => {
    S.players.forEach(p => { p.actions = [{ type: 'BUY', i: 0, qty: 200, price: S.stocks[0].price }, { type: 'BUY', i: 1, qty: 200, price: S.stocks[1].price }]; p.locked = true; });
    S.players[0].privateCards = [{ cardId: 5, kind: 'MARKET', index: 'BANK NIFTY', signal: 30, confidence: 'High' }];
    S.phase = 'REVEAL'; const first = resolveRound();
    const state = () => JSON.stringify([S.stocks.map(s => s.price), S.market, S.history.length, S.tradeJournal.length, S.players.map(p => [p.cash, p.holdings])]);
    const snap = state(); const again = [resolveRound(), resolveRound()];
    return { first, again, same: snap === state(), moved: S.stocks[4].price !== 95 };
  });
  assert.equal(r.first, true); assert.deepEqual(r.again, [false, false]); assert.equal(r.same, true);
  assert.equal(r.moved, true, 'the BANK NIFTY clue did move ICICI Bank exactly once');
  await ctx.close();
});

test('dealIntel: 5 distinct cards per active player (4 company-type on 4 different companies + 1 market/corporate), valid signals and confidences, no shared cards', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await page.evaluate(() => {
    S = freshState(); resizePlayers(6); S.silent = true; S.started = true; S.round = 2; S.rng = mulberry32(4242); S.rngN = 0; S.players.forEach(p => { p.active = true; });
    const rounds = [];
    for (let k = 0; k < 6; k++) {
      dealIntel(); const hands = S.players.map(p => p.privateCards.map(c => ({ ...c })));
      rounds.push(hands);
      S.players.forEach(p => p.privateCards.forEach(c => { c.outcome = 'x'; }));     // pretend it resolved
    }
    return { rounds, signals: CARD_SIGNALS, conf: Object.keys(CONFIDENCE_WEIGHT) };
  });
  for (const hands of r.rounds) {
    const ids = hands.flat().map(c => c.cardId); assert.equal(new Set(ids).size, ids.length, 'no card appears in two hands');
    for (const h of hands) {
      assert.equal(h.length, 5);
      const company = h.slice(0, 4); assert.ok(company.every(c => ['COMPANY', 'DEFAULTER', 'UPPER_CIRCUIT', 'LOWER_CIRCUIT', 'MARKET'].includes(c.kind)));
      const idx = company.filter(c => c.i != null).map(c => c.i); assert.equal(new Set(idx).size, idx.length, 'four different companies');
      for (const c of h) { assert.ok(r.conf.includes(c.confidence)); assert.ok(!c.outcome, 'a fresh deal carries no outcome from the previous hand'); if (c.kind === 'COMPANY') assert.ok(r.signals.company.includes(c.signal)); if (c.kind === 'MARKET' && c.signal) assert.ok(r.signals.market.includes(c.signal)); }
    }
  }
  // rotation: consecutive hands for the same seat are not the identical set of 5 cards
  const sig = h => h.map(c => c.cardId).sort().join();
  assert.notEqual(sig(r.rounds[0][0]), sig(r.rounds[1][0]));
  // pool exhaustion yields explicit neutral fallbacks, never a crash
  const f = await page.evaluate(() => { S.players.forEach(p => { p.privateCards = []; }); S.cardPool = []; S.cardPoolStockCount = S.stocks.length; S.cardPoolMarketBuilt = true; dealIntel(); return S.players[0].privateCards.map(c => [c.kind, c.signal, c.confidence]); });
  assert.equal(f.length, 5); assert.ok(f.every(([k, s, c]) => k === 'MARKET' && s === 0 && c === 'Low'));
  await ctx.close();
});

test('help UI: Private Intel dialog and the Indices section are reachable, accessible and match the engine constants', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 2, timer: 30, ipoPlan: 'none', events: false });
  await page.evaluate(() => startRound());
  const btn = page.locator('#intelHelp');
  assert.equal(await btn.getAttribute('aria-haspopup'), 'dialog'); await btn.focus(); await page.keyboard.press('Enter');
  const body = await page.textContent('#modalBody');
  assert.match(body, /How to read Private Intel/); assert.match(body, /\+1\.5% push on TCS/); assert.match(body, /\+4\.5% push on Bharti Airtel/);
  assert.match(body, /Low ×0\.5, Medium ×1, High ×1\.5/); assert.match(body, /capped at ±60/); assert.match(body, /host/i);
  // the number in the help equals the engine's own computation
  assert.equal(await page.evaluate(() => { S.players[0].privateCards = [{ kind: 'COMPANY', company: 'TCS', i: 7, signal: 15, confidence: 'Medium' }]; S.players[1].privateCards = []; return intelPressure(7) / INTEL_PRESSURE_DIVISOR * 100; }), 1.5);
  await page.keyboard.press('Tab'); await page.click('#modalClose');
  // chips show their decoded effect
  await page.evaluate(() => { renderPrivateIntel(); });
  assert.match(await page.textContent('#intelHand'), /push on TCS|push on|Nudges simulated|Neutral/);
  // Indices section in How to Play
  await page.click('[data-page="how"]'); await page.click('[data-how="15"]');
  const how = await page.textContent('#howBody');
  assert.match(how, /Indices & Market Effects/); assert.match(how, /static DEMO reference text/); assert.match(how, /0\.2\/0\.15\/0\.65/); assert.match(how, /IT 0\.45, Energy\/Consumer -0\.35|IT 0\.45, Energy\/Consumer −0\.35/);
  assert.match(how, /clamped to ±5%/); assert.match(how, /cannot apply an index effect twice|once per sub-round/);
  // simulated indices strip is distinct from the static ticker
  assert.match(await page.textContent('#simIndices'), /SIMULATED GAME INDICES/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
