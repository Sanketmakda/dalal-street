'use strict';
// Part 4: portfolio / cash / supply / average-price accounting, reconstructed INDEPENDENTLY from the journals after
// EVERY settlement of full simulated games (real engine: dealIntel, botDecisions, resolveRound, IPO, events, VITO).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

// Runs one whole game in the page and returns every violation found by independent reconciliation.
function driver({ seed, count, events, ipo, corrupt }) {
  const old = S, viol = [], cov = { events: {}, vito: 0, ipoSettle: 0, sub: 0, frozenSeen: 0 };
  S = freshState(); resizePlayers(count); captureLedgerBaseline(); S.silent = true; S.started = true;
  S.eventsOn = events; S.bonusOn = true; S.ipoPlan = ipo ? 'two' : 'none'; S.seed = seed; S.rng = mulberry32(seed); S.rngN = 0; S.autoVITO = true;
  const fail = (tag, msg) => { if (viol.length < 25) viol.push(tag + ': ' + msg); };
  const avgReplay = () => { // average price recomputed from fills only (valid when no corporate actions/IPO change cost basis)
    const h = S.players.map(() => S.stocks.map(() => 0)), a = S.players.map(() => S.stocks.map(() => 0));
    for (const t of S.tradeJournal) {
      const pi = t.playerId, i = t.stockIndex;
      if (t.type === 'BUY') { const oa = a[pi][i] || t.price; a[pi][i] = (h[pi][i] * oa + t.qty * t.price) / (h[pi][i] + t.qty); h[pi][i] += t.qty; }
      else { h[pi][i] -= t.qty; if (h[pi][i] === 0) a[pi][i] = 0; }
    }
    return a;
  };
  const verify = tag => {
    S.stocks.forEach((s, i) => {
      const held = S.players.reduce((n, p) => n + p.holdings[i], 0);
      if (held + s.total + (s.treasury || 0) !== 10000) fail(tag, `supply ${s.name}: held ${held} + avail ${s.total} + treasury ${s.treasury || 0} != 10000`);
      if (!Number.isInteger(s.price) || s.price < 0 || s.price > 10000) fail(tag, `price ${s.name}=${s.price}`);
    });
    S.players.forEach(p => {
      const mv = S.stocks.reduce((n, s, i) => n + p.holdings[i] * s.price, 0), pv = p.cash + (p.ipoFrozen || 0) + mv;
      if (Math.abs(portfolioValue(p) - pv) > 0.01) fail(tag, `${p.name} portfolio ${portfolioValue(p)} != cash+frozen+market ${pv}`);
      if (totalShares(p) !== p.holdings.reduce((a, b) => a + b, 0)) fail(tag, `${p.name} totalShares`);
      if (!(p.cash >= 0) || !Number.isFinite(p.cash)) fail(tag, `${p.name} cash ${p.cash}`);
      const trades = S.tradeJournal.filter(t => t.playerId === p.id).reduce((n, t) => n + t.cashDelta, 0);
      const ev = S.eventJournal.filter(e => e.playerId === p.id && Number.isFinite(e.cashDelta)).reduce((n, e) => n + e.cashDelta, 0);
      if (Math.abs(p.cash - (1000000 + trades + ev)) > 0.01) fail(tag, `${p.name} cash ${p.cash} != journal ${1000000 + trades + ev}`);
      S.stocks.forEach((s, i) => {
        const sh = S.tradeJournal.filter(t => t.playerId === p.id && t.stockIndex === i).reduce((n, t) => n + (t.type === 'BUY' ? t.qty : -t.qty), 0)
          + S.eventJournal.filter(e => e.playerId === p.id && e.stockIndex === i && (e.kind === 'PLAYER_SHARES' || e.kind === 'IPO_SETTLEMENT') && Number.isFinite(e.sharesDelta)).reduce((n, e) => n + e.sharesDelta, 0);
        if (sh !== p.holdings[i]) fail(tag, `${p.name}/${s.name} holdings ${p.holdings[i]} != journal ${sh}`);
        if (!Number.isFinite(p.avg[i]) || p.avg[i] < 0) fail(tag, `${p.name}/${s.name} avg ${p.avg[i]}`);
        if (p.holdings[i] === 0 && p.avg[i] !== 0) fail(tag, `${p.name}/${s.name} avg ${p.avg[i]} with zero holding`);
        if (p.holdings[i] > 2500 && !p.bonusOverflow[i] && !p.eventOverflow[i]) fail(tag, `${p.name}/${s.name} ${p.holdings[i]} > 2500 without overflow flag`);
        const lots = (p.lots[i] || []).reduce((n, l) => n + l.qty, 0);
        if (lots !== p.holdings[i]) fail(tag, `${p.name}/${s.name} lots ${lots} != holdings ${p.holdings[i]}`);
      });
      if (!p.active) cov.frozenSeen++;
    });
    if (!events && !ipo) { const a = avgReplay(); S.players.forEach((p, pi) => S.stocks.forEach((s, i) => { if (Math.abs(a[pi][i] - p.avg[i]) > 1e-6) fail(tag, `${p.name}/${s.name} avg ${p.avg[i]} != replay ${a[pi][i]}`); })); }
    const bad = auditState().find(x => !x.ok); if (bad) fail(tag, 'auditState: ' + bad.label);
  };
  const run = (r, sr) => {
    S.round = r; S.subRound = sr; S.event = null; S.stocks.forEach(s => s.circuit = null); S.previousPrices = S.stocks.map(s => s.price);
    if (ipo && r === 3 && sr === 1 && S.ipoLaunched < 1) launchIPO(1);
    if (ipo && r === 4 && sr === 1 && S.ipoLaunched < 2) launchIPO(2);
    if (S.phase === 'IPO_BID') { clearInterval(timerId); S.timerLeft = 0; finalizeIPO(); S.phase = 'COMPLETE'; cov.ipoSettle++; }
    unlockIPOs(); S.phase = 'DECISION'; S.previousPrices = S.stocks.map(s => s.price); dealIntel();
    S.players.forEach(p => { if (p.active) { p.actions = []; p.locked = false; p.confirmed = false; } });
    botDecisions();
    if (S.players[0].active) { S.players[0].profile = ['value', 'momentum', 'contrarian', 'concentrator', 'cash'][seed % 5]; S.players[0].actions = []; botDecisionsForHumanStress(); S.players[0].locked = true; }
    S.players.forEach(p => { if (p.active) p.locked = true; });
    // a quit mid-game must freeze the portfolio and keep it reconciling
    if (r === 5 && sr === 1 && count > 3) { const q = S.players[count - 1]; q.active = false; q.frozen = true; q.status = 'Quit · Frozen'; q.actions = []; cancelPendingIPOBids(q); }
    const frozenBefore = S.players.filter(p => !p.active).map(p => [p.id, p.cash, p.holdings.join()]);
    const hb = S.history.length; S.phase = 'REVEAL';
    if (!resolveRound()) { fail(`R${r}.${sr}`, 'resolveRound refused'); return; }
    if (S.history.length !== hb + 1) fail(`R${r}.${sr}`, 'history length');
    if (S.phase === 'IPO_BID') { clearInterval(timerId); finalizeIPO(); S.phase = 'COMPLETE'; cov.ipoSettle++; }
    if (sr === 2) finishMainRoundCloseIfPending();
    for (const e of S.eventJournal) cov.events[e.type] = 1;
    cov.vito = S.vitoHistory.length; cov.sub++;
    for (const [id, cash0, h0] of frozenBefore) { const p = S.players[id]; if (events === false && (p.cash !== cash0 || p.holdings.join() !== h0)) fail(`R${r}.${sr}`, `frozen ${p.name} portfolio changed without events`); }
    if (corrupt && r === 3 && sr === 1) { S.players[0].cash += 1000; S.stocks[2].total -= 200; }
    verify(`R${r}.${sr}`);
    // repeating the settlement must not change anything
    const snap = JSON.stringify([S.players.map(p => [p.cash, p.holdings]), S.stocks.map(s => s.price), S.tradeJournal.length, S.eventJournal.length]);
    S.phase = 'COMPLETE'; resolveRound(); resolveRound(); S.phase = 'REVEAL'; if (S.resolving) fail(`R${r}.${sr}`, 'resolving flag stuck');
    S.phase = 'COMPLETE';
    if (snap !== JSON.stringify([S.players.map(p => [p.cash, p.holdings]), S.stocks.map(s => s.price), S.tradeJournal.length, S.eventJournal.length])) fail(`R${r}.${sr}`, 'replayed settlement changed state');
  };
  try {
    for (let r = 1; r <= 10; r++) for (let sr = 1; sr <= 2; sr++) run(r, sr);
    if (shouldOpenBonusRound()) for (let sr = 1; sr <= 2; sr++) run(11, sr);
    const vitoUse = S.players.map(p => S.vitoHistory.filter(v => v.playerId === p.id).length);
    if (vitoUse.some(n => n > 1)) fail('end', 'a player used VITO more than once: ' + vitoUse);
    return { viol, cov, subRounds: S.history.length, rounds: Math.max(...S.history.map(h => h.round)) };
  } finally { clearInterval(timerId); S = old; }
}
const runDriver = (page, opts) => page.evaluate(`(${driver.toString()})(${JSON.stringify(opts)})`);

test('portfolio/cash/supply/lots/average reconcile after EVERY settlement, with events + IPOs + VITO + a mid-game quit (8 seeded games)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const seen = new Set(); let vito = 0, ipo = 0, subs = 0;
  for (const seed of [101, 202, 303, 404, 505, 606, 707, 808]) {
    const r = await runDriver(page, { seed, count: 3 + (seed % 4), events: true, ipo: true });
    assert.deepEqual(r.viol, [], `seed ${seed}`);
    Object.keys(r.cov.events).forEach(e => seen.add(e)); vito += r.cov.vito; ipo += r.cov.ipoSettle; subs += r.subRounds;
    assert.ok(r.rounds >= 10 && r.subRounds >= 20, 'ran R1..R10');
  }
  console.log('# coverage: sub-rounds', subs, '| event types', [...seen].sort().join(','), '| VITO uses', vito, '| IPO settlements', ipo);
  assert.ok(seen.has('IPO_SETTLEMENT'), 'IPO allocation exercised');
  await ctx.close();
});

test('seeded full games at 2, 6 and 10 players (events + IPOs + VITO): every settlement reconciles; each run reaches Round 10', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const runs = [[2, 1201], [2, 1202], [6, 1203], [6, 1204], [10, 1205], [10, 1206]];
  for (const [count, seed] of runs) {
    const r = await runDriver(page, { seed, count, events: true, ipo: true });
    assert.deepEqual(r.viol, [], `players=${count} seed=${seed}`);
    assert.ok(r.rounds >= 10 && r.subRounds >= 20, `players=${count} seed=${seed} ran R1..R10 (rounds ${r.rounds}, sub-rounds ${r.subRounds})`);
    console.log(`# seeded game players=${count} seed=${seed}: rounds=${r.rounds} subRounds=${r.subRounds} violations=0 events=${Object.keys(r.cov.events).length} vito=${r.cov.vito} ipoSettle=${r.cov.ipoSettle}`);
  }
  await ctx.close();
});

test('average price = replay of fills (no silent change from price moves); frozen/quit portfolios do not trade (no events/IPO)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  for (const seed of [11, 22, 33, 44]) { const r = await runDriver(page, { seed, count: 5, events: false, ipo: false }); assert.deepEqual(r.viol, [], `seed ${seed}`); assert.ok(r.cov.frozenSeen > 0, 'a frozen portfolio was audited'); }
  // price moves alone never alter cost basis
  const same = await page.evaluate(() => {
    S = freshState(); resizePlayers(2); S.silent = true; S.started = true; S.rng = mulberry32(5);
    S.players[0].holdings[0] = 400; S.players[0].avg[0] = 123.45; S.players[0].lots[0] = [{ qty: 400, acquiredAt: 0 }]; S.stocks[0].total -= 400;
    const z = Array(S.stocks.length).fill(0); for (let k = 0; k < 5; k++) { S.previousPrices = S.stocks.map(s => s.price); resolvePrices(z, z); }
    return S.players[0].avg[0];
  });
  assert.equal(same, 123.45);
  await ctx.close();
});

test('dividend pays MATURE lots only (incl. frozen portfolio); split doubles mature lots only and preserves cost basis', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await page.evaluate(() => {
    const out = {};
    const setup = () => { S = freshState(); resizePlayers(3); S.silent = true; S.started = true; S.eventsOn = true; S.round = 5; S.subRound = 1; S.phase = 'COMPLETE';
      const cur = currentSubRoundIndex(); // mature = acquired >= 2 sub-rounds ago
      const a = S.players[0], b = S.players[1], c = S.players[2];
      const give = (p, qty, ago, avg) => { p.holdings[0] += qty; p.avg[0] = avg; p.lots[0].push({ qty, acquiredAt: cur - ago }); S.stocks[0].total -= qty; };
      give(a, 300, 3, 100); give(a, 200, 0, 100); give(b, 400, 4, 120); c.active = false; c.frozen = true; c.status = 'Quit · Frozen'; give(c, 200, 5, 90);
      S.previousPrices = S.stocks.map(s => s.price); return { a, b, c }; };
    // --- DIVIDEND: seq → run (r<=.5), type 0 = DIVIDEND, company 0, div = 5
    let { a, b, c } = setup(); const cash0 = [a.cash, b.cash, c.cash]; const seq = v => { let k = 0; S.rng = () => v[Math.min(k++, v.length - 1)]; }; seq([0.1, 0.0, 0.0, 0.0]);
    const ev = maybeEvent(); out.divTitle = ev && ev.title; out.divCash = [a.cash - cash0[0], b.cash - cash0[1], c.cash - cash0[2]];
    // --- SPLIT: type index 4 (0.45*9=4.05), company 0
    ({ a, b, c } = setup()); const hold0 = [a.holdings[0], b.holdings[0], c.holdings[0]], basis0 = [a, b, c].map(p => p.holdings[0] * p.avg[0]); const price0 = S.stocks[0].price; seq([0.1, 0.45, 0.0, 0.0]);
    const ev2 = maybeEvent(); out.splitTitle = ev2 && ev2.title; out.splitHold = [a.holdings[0], b.holdings[0], c.holdings[0]]; out.hold0 = hold0; out.splitBasis = [a, b, c].map((p, k) => Math.abs(p.holdings[0] * p.avg[0] - basis0[k]) < 0.01); out.splitPrice = [price0, S.stocks[0].price];
    out.splitSupply = S.stocks[0].total + S.players.reduce((n, p) => n + p.holdings[0], 0) + (S.stocks[0].treasury || 0);
    return out;
  });
  assert.match(r.divTitle, /Dividend/);
  assert.deepEqual(r.divCash, [300 * 5, 400 * 5, 200 * 5], 'only mature shares are paid; the 200 immature shares of player 0 earn nothing; frozen player is paid');
  assert.match(r.splitTitle, /Split/);
  assert.deepEqual(r.splitHold, [800, 800, 400], 'mature lots double: A 300→600 (+200 immature unchanged) = 800; B 400→800; C(frozen) 200→400');
  assert.deepEqual(r.splitBasis, [true, true, true], 'total cost basis (holdings × average) is unchanged by a split');
  assert.equal(r.splitPrice[1], Math.round(r.splitPrice[0] / 2));
  assert.equal(r.splitSupply, 10000, 'supply still reconciles after the split');
  await ctx.close();
});

test('built-in engine suites (sell edge cases, corporate actions, IPO escrow, VITO halt, circuits) report zero failures', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await page.evaluate(() => { const a = runSellEdgeTests(), b = runCorporateActionTests(); return { a, b }; });
  assert.deepEqual(r.a.failures, []); assert.deepEqual(r.b.failures, []);
  assert.ok(r.a.passed >= 20 && r.b.passed >= 50, `suites executed: sell ${r.a.passed}, corporate ${r.b.passed}`);
  console.log('# built-in suites passed:', r.a.passed, '+', r.b.passed);
  await ctx.close();
});

test('VITO: restores previous main-round close, once per player, reverses only bankruptcy transactions, halts trading to next main round', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await page.evaluate(() => {
    S = freshState(); resizePlayers(3); S.silent = true; S.started = true; S.eventsOn = true; S.round = 4; S.subRound = 2; S.phase = 'COMPLETE'; S.rng = mulberry32(9);
    const a = S.players[0]; a.holdings[1] = 400; a.avg[1] = 80; a.lots[1] = [{ qty: 400, acquiredAt: 0 }]; S.stocks[1].total -= 400;
    S.lastMainRoundClose = S.stocks.map(s => s.price); S.lastMainRoundClose[1] = 88; S.previousPrices = S.stocks.map(s => s.price);
    S.stocks[1].bankruptcySnapshot = makeBankruptcySnapshot(1); S.stocks[1].bankruptcyId = 1; S.stocks[1].bankruptcyRound = S.round; S.stocks[1].price = 0;
    const cashBefore = a.cash, holdBefore = a.holdings[1];
    const res = invokeVITO(0, 1, 1), again = invokeVITO(0, 1, 1);
    return { ok: res.ok, price: S.stocks[1].price, halt: S.stocks[1].vitoHaltedUntilRound, used: a.vitoUsed, again: again.ok, cash: a.cash - cashBefore, hold: a.holdings[1] - holdBefore, audit: auditState().filter(x => !x.ok).map(x => x.label) };
  });
  assert.equal(r.ok, true); assert.equal(r.price, 88, 'previous main-round closing price restored'); assert.ok(r.halt > 4, 'trading halted until the next main round');
  assert.equal(r.used, true); assert.equal(r.again, false, 'one VITO per player per game'); assert.equal(r.hold, 0); assert.deepEqual(r.audit, []);
  await ctx.close();
});

test('negative control: the reconciliation checker DOES detect injected cash and supply corruption', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await runDriver(page, { seed: 101, count: 4, events: false, ipo: false, corrupt: true });
  assert.ok(r.viol.some(v => /cash .* != journal/.test(v)), 'cash corruption detected: ' + r.viol.slice(0, 3));
  assert.ok(r.viol.some(v => /supply/.test(v)), 'supply corruption detected');
  await ctx.close();
});

test('DISPLAYED Cash / Portfolio / Total shares / holdings table equal independent reconstruction after UI-driven settlements', async () => {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players: 3, timer: 30, ipoPlan: 'none', events: false });
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  for (let k = 0; k < 4; k++) {
    await page.click('#startRound'); await page.clock.runFor(50);
    let done = 0; const need = k === 0 ? 2 : 1;
    for (let i = 0; i < 8 && done < need; i++) { await page.click(`[data-stock="${i}"]`); await page.fill('#qty', '200'); if (!(await page.evaluate(() => document.getElementById('buy').disabled))) { await page.click('#buy'); done++; } }
    await page.click('#lock'); await page.click('#modalReveal'); await page.clock.runFor(1000);
    const shown = await page.evaluate(() => { const g = l => [...document.querySelectorAll('#myStats .stat')].find(s => s.textContent.startsWith(l)).querySelector('b').textContent; return { cash: g('Cash'), pv: g('Portfolio'), sh: g('Total shares'), rows: [...document.querySelectorAll('#myHoldings tr')].map(r => [...r.children].map(c => c.textContent)) }; });
    const truth = await page.evaluate(() => { const p = S.players[0]; return { cash: p.cash, frozen: p.ipoFrozen || 0, h: p.holdings.slice(), price: S.stocks.map(s => s.price), avg: p.avg.slice(), names: S.stocks.map(s => s.name), buys: S.tradeJournal.filter(t => t.playerId === 0 && t.type === 'BUY') }; });
    const mv = truth.h.reduce((n, q, i) => n + q * truth.price[i], 0);
    assert.equal(shown.cash, inr(truth.cash)); assert.equal(shown.pv, inr(truth.cash + truth.frozen + mv)); assert.equal(shown.sh, truth.h.reduce((a, b) => a + b, 0).toLocaleString('en-IN'));
    truth.h.forEach((q, i) => { if (!q) return; const row = shown.rows.find(r => r[0] === truth.names[i]); assert.ok(row, 'holding row for ' + truth.names[i]); assert.equal(row[1], q.toLocaleString('en-IN')); assert.equal(row[2], inr(q * truth.price[i]));
      const fills = truth.buys.filter(t => t.stockIndex === i); const avg = fills.reduce((n, t) => n + t.qty * t.price, 0) / fills.reduce((n, t) => n + t.qty, 0); assert.equal(row[3], inr(avg), 'average acquisition price = qty-weighted fill price'); });
    // cash independently: 10,00,000 − Σ BUY cost
    assert.equal(truth.cash, 1000000 - truth.buys.reduce((n, t) => n + t.qty * t.price, 0));
    await page.click('#nextRound'); if (k === 1) {} 
  }
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
