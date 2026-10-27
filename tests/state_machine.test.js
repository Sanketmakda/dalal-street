'use strict';
// Part 1: one source of truth for round/sub-round/phase/buttons/labels, explicit legal transitions.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout ' + fn); await new Promise(r => setTimeout(r, 100)); } };
const ui = page => page.evaluate(() => ({
  title: document.getElementById('roundTitle').textContent, phase: document.getElementById('statusPill').textContent,
  desc: document.getElementById('phaseText').textContent,
  start: { text: document.getElementById('startRound').textContent, dis: document.getElementById('startRound').disabled, why: document.getElementById('startRound').title },
  next: { text: document.getElementById('nextRound').textContent, dis: document.getElementById('nextRound').disabled, why: document.getElementById('nextRound').title },
  lock: document.getElementById('lock').disabled, confirm: getComputedStyle(document.getElementById('confirm')).display,
  actions: [...document.querySelectorAll('#myStats .stat')].map(s => s.textContent).find(t => /^Actions/.test(t)),
}));

async function newGame(opts = {}) {
  const { ctx, page } = await H.openGame(browser, server.url, { clock: true });
  await H.startBotGame(page, { players: 2, timer: 30, ipoPlan: 'none', events: false, bonus: opts.bonus ?? false });
  return { ctx, page };
}
async function play(page, n = 2) { // one human sub-round through the real UI
  await page.click('#startRound'); await page.clock.runFor(50);
  const need = await page.evaluate(() => (S.round === 1 && S.subRound === 1 ? 2 : 1));
  let done = 0;
  for (let i = 0; i < 8 && done < need; i++) { await page.click(`[data-stock="${i}"]`); await page.fill('#qty', '200'); if (!(await page.evaluate(() => document.getElementById('buy').disabled))) { await page.click('#buy'); done++; } }
  await page.click('#lock'); await page.click('#modalReveal'); await page.clock.runFor(1000);
}

test('every label/button/counter is consistent in every phase of R1.SR1 → R1.SR2 → R2.SR1', async () => {
  const { ctx, page } = await newGame();
  let u = await ui(page);
  assert.equal(u.phase, 'LOBBY'); assert.equal(u.start.dis, false); assert.equal(u.next.dis, true); assert.match(u.next.why, /Nothing to advance/);
  assert.match(u.actions, /0 \/ 5/);
  await page.click('#startRound'); await page.clock.runFor(50);
  u = await ui(page);
  assert.equal(u.phase, 'DECISION'); assert.equal(u.start.dis, true); assert.equal(u.next.dis, true);
  assert.match(u.start.text, /R1 · SUB-ROUND 1 IN PROGRESS/); assert.ok(u.start.why.length > 5, 'disabled START explains why');
  assert.equal(u.lock, false); assert.match(u.actions, /0 \/ 5/);
  for (const i of [0, 1]) { await page.click(`[data-stock="${i}"]`); await page.fill('#qty', '200'); await page.click('#buy'); }
  await page.click('#lock');
  u = await ui(page);
  assert.equal(u.phase, 'REVIEW'); assert.equal(u.start.dis, true); assert.equal(u.next.dis, true); assert.equal(u.lock, true);
  assert.match(u.start.why, /CONFIRM/); assert.match(u.actions, /2 \/ 5/);
  await page.click('#modalReveal'); await page.clock.runFor(1000);
  u = await ui(page);
  // The screenshot bug: COMPLETE + "START R1·SR1" + "NEXT ROUND" enabled together.
  assert.equal(u.phase, 'COMPLETE'); assert.match(u.title, /Sub-Round 1\/2 · settled/);
  assert.equal(u.start.dis, true, 'a settled slot cannot be restarted'); assert.match(u.start.why, /already settled/);
  assert.equal(u.next.dis, false); assert.match(u.next.text, /ADVANCE → R1 · SUB-ROUND 2/);
  assert.doesNotMatch(u.start.text, /START R1 · SUB-ROUND 1$/, 'no START button for the slot that already ran');
  assert.match(u.actions, /0 \/ 3/, 'counter reset and shows the NEXT slot limit (R1.SR2 = 3)');
  assert.match(u.desc, /settled\. Next: R1 · Sub-Round 2/);
  await page.click('#nextRound');
  u = await ui(page);
  assert.equal(u.phase, 'COMPLETE'); assert.match(u.title, /Sub-Round 2\/2$/); assert.doesNotMatch(u.title, /settled/);
  assert.equal(u.start.dis, false); assert.match(u.start.text, /START R1 · SUB-ROUND 2/); assert.equal(u.next.dis, true);
  assert.match(u.next.why, /not been played yet/); assert.match(u.actions, /0 \/ 3/);
  await play(page); // SR2
  u = await ui(page);
  assert.match(u.next.text, /ADVANCE → R2 · SUB-ROUND 1/); assert.equal(u.start.dis, true);
  assert.equal(await page.evaluate(() => S.round), 1);
  await page.click('#nextRound');
  u = await ui(page);
  assert.match(u.title, /Round 2 · Sub-Round 1\/2$/); assert.match(u.start.text, /START R2 · SUB-ROUND 1/); assert.match(u.actions, /0 \/ 3/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('double-clicks and repeated calls cannot start twice, advance twice or settle twice', async () => {
  const { ctx, page } = await newGame();
  const bots = () => page.evaluate(() => S.botLog.filter(x => /bots calculating/.test(x)).length);
  await page.dblclick('#startRound'); await page.clock.runFor(50);
  assert.equal(await bots(), 1, 'dealing/bot decisions ran once');
  assert.equal(await page.evaluate(() => (startRound(), startRound(), S.botLog.filter(x => /bots calculating/.test(x)).length)), 1);
  for (const i of [0, 1]) { await page.click(`[data-stock="${i}"]`); await page.fill('#qty', '200'); await page.click('#buy'); }
  await page.click('#lock');
  await page.evaluate(() => { document.getElementById('modalReveal').click(); document.getElementById('modalReveal').click(); document.getElementById('confirm').click(); });
  await page.clock.runFor(2000);
  assert.equal(await page.evaluate(() => S.history.length), 1, 'one settlement');
  assert.equal(await page.evaluate(() => S.tradeJournal.filter(t => t.playerId === 0).length), 2, 'two trades, not four');
  assert.equal(await page.evaluate(() => S.players[0].holdings.slice(0, 2).join()), '200,200');
  await page.dblclick('#nextRound');
  assert.deepEqual(await page.evaluate(() => [S.round, S.subRound, S.settled]), [1, 2, false], 'advanced exactly one slot');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('invalid transitions are ignored: START while settled, NEXT before play, CONFIRM in DECISION, resolve out of phase, lock when settled', async () => {
  const { ctx, page } = await newGame();
  const snap = () => page.evaluate(() => JSON.stringify({ r: S.round, sr: S.subRound, ph: S.phase, st: S.settled, h: S.history.length, c: S.players[0].cash }));
  const s0 = await snap();
  await page.evaluate(() => { document.getElementById('nextRound').onclick(); });          // NEXT before anything was played
  assert.equal(await snap(), s0);
  await page.click('#startRound'); await page.clock.runFor(50);
  const s1 = await snap();
  await page.evaluate(() => { document.getElementById('confirm').onclick(); document.getElementById('nextRound').onclick(); document.getElementById('startRound').onclick(); });
  assert.equal(await snap(), s1, 'CONFIRM/NEXT/START are no-ops during DECISION');
  assert.equal(await page.evaluate(() => resolveRound()), false, 'resolveRound outside REVEAL is refused');
  await page.click('#lock'); // human has no BUYs: refused with a reason, still DECISION
  assert.match(await page.textContent('#validation'), /2–5 BUY/); assert.equal(await page.evaluate(() => S.phase), 'DECISION');
  await page.clock.runFor(31000); // timer expiry → REVIEW
  assert.equal(await page.evaluate(() => S.phase), 'REVIEW');
  await page.click('#confirm'); await page.clock.runFor(1000);
  const s2 = await snap();
  await page.evaluate(() => { document.getElementById('startRound').onclick(); document.getElementById('lock').onclick(); document.getElementById('confirm').onclick(); });
  await page.clock.runFor(1000);
  assert.equal(await snap(), s2, 'START/LOCK/CONFIRM are no-ops on a settled slot');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('legal-transition table: forced illegal phase jumps are not offered by controls', async () => {
  const { ctx, page } = await newGame();
  const res = await page.evaluate(() => {
    const out = {};
    for (const phase of ['LOBBY', 'DECISION', 'REVIEW', 'REVEAL', 'IPO_BID', 'IPO_COMPLETE', 'COMPLETE', 'GAME OVER']) for (const settled of [false, true]) {
      S.phase = phase; S.settled = settled; S.gameOver = phase === 'GAME OVER'; S.vitoPromptOpen = false;
      const c = controlState(); out[phase + '/' + settled] = [!c.startDisabled, !c.nextDisabled];
    }
    return out;
  });
  const enabled = Object.entries(res).filter(([, [s, n]]) => s || n).map(([k, v]) => k + ':' + v.map(Number).join(''));
  for (const [k, [s, n]] of Object.entries(res)) assert.ok(!(s && n), `${k}: START and NEXT must never both be enabled`);
  assert.deepEqual(enabled.sort(), ['COMPLETE/false:10', 'COMPLETE/true:01', 'IPO_COMPLETE/false:01', 'IPO_COMPLETE/true:01', 'LOBBY/false:10', 'LOBBY/true:10'].sort());
  await ctx.close();
});

test('R10 → game over (no Round 12) and Bonus R11 limits', async () => {
  const { ctx, page } = await newGame({ bonus: false });
  await page.evaluate(() => { S.started = true; S.round = 10; S.subRound = 2; S.phase = 'COMPLETE'; S.settled = true; S.bonusOn = false; renderAll(); });
  let u = await ui(page);
  assert.match(u.next.text, /FINISH GAME/); assert.equal(u.start.dis, true); assert.match(u.start.text, /GAME COMPLETE/);
  await page.click('#nextRound');
  assert.equal(await page.evaluate(() => S.gameOver), true); assert.equal(await page.evaluate(() => S.round), 10);
  u = await ui(page); assert.equal(u.start.dis, true); assert.equal(u.next.dis, true);
  // R10 limit 5, bonus R11 limit 5, never R12
  const lim = await page.evaluate(() => [maxActionsFor(10, 1), maxActionsFor(10, 2), maxActionsFor(11, 1), maxActionsFor(11, 2), maxActionsFor(12, 1)]);
  assert.deepEqual(lim, [5, 5, 5, 5, 0]);
  await page.evaluate(() => document.getElementById('modalBack').classList.remove('show'));
  await page.evaluate(() => { S = freshState(); resizePlayers(2); S.started = true; S.round = 10; S.subRound = 2; S.phase = 'COMPLETE'; S.settled = true; S.bonusOn = true; S.gameOver = false; shouldOpenBonusRound = () => true; renderAll(); });
  assert.match((await ui(page)).next.text, /ADVANCE → R11 · SUB-ROUND 1/);
  await page.click('#nextRound');
  assert.deepEqual(await page.evaluate(() => [S.round, S.subRound, S.gameOver]), [11, 1, false]);
  assert.match((await ui(page)).actions, /0 \/ 5/);
  await page.evaluate(() => { S.round = 11; S.subRound = 2; S.settled = true; S.phase = 'COMPLETE'; renderAll(); });
  await page.click('#nextRound');
  assert.equal(await page.evaluate(() => S.gameOver), true); assert.equal(await page.evaluate(() => S.round), 11);
  await ctx.close();
});

test('online: host + guest see the same labels; guest controls are disabled with a reason; host refresh keeps the settled/advance state', async () => {
  const host = await H.openGame(browser, server.url), guest = await H.openGame(browser, server.url);
  const code = await H.createRoom(host.page, 'H'); await H.joinRoom(guest.page, code, 'G');
  await until(async () => (await host.page.evaluate(() => S.players.length)) === 2);
  await H.setTimerOption(host.page, 30);
  await host.page.click('#startGame'); await until(async () => guest.page.evaluate(() => S.started));
  await host.page.click('#startRound'); await until(async () => (await guest.page.evaluate(() => S.phase)) === 'DECISION');
  assert.equal((await ui(guest.page)).start.dis, true);
  await host.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 200); });
  await guest.page.evaluate(() => { addAction('BUY', 2, 200); addAction('BUY', 3, 200); });
  await until(async () => (await host.page.evaluate(() => S.players[1].actions.length)) === 2);
  await guest.page.click('#lock'); await until(async () => host.page.evaluate(() => S.players[1].locked));
  await host.page.click('#lock'); await host.page.click('#modalReveal');
  await until(async () => (await guest.page.evaluate(() => S.phase === 'COMPLETE' && S.settled)));
  const strip = u => ({ ...u, actions: undefined });
  const uh = await ui(host.page), ug = await ui(guest.page);
  assert.equal(uh.start.dis, true); assert.equal(uh.next.dis, false);
  assert.equal(ug.start.dis, true); assert.equal(ug.next.dis, true, 'guest cannot advance');
  assert.equal(uh.start.text, ug.start.text); assert.equal(uh.title, ug.title); assert.equal(uh.desc, ug.desc);
  assert.ok(uh.start.why.length > 5, 'host START has an explanation');
  await host.page.reload();
  await until(async () => host.page.evaluate(() => typeof S !== 'undefined' && S.phase === 'COMPLETE' && S.settled === true));
  const uh2 = await ui(host.page);
  assert.equal(uh2.start.dis, true); assert.equal(uh2.next.dis, false); assert.match(uh2.next.text, /ADVANCE → R1 · SUB-ROUND 2/);
  assert.equal(await host.page.evaluate(() => S.history.length), 1, 'refresh did not settle again');
  await host.page.click('#nextRound');
  await until(async () => (await guest.page.evaluate(() => S.subRound)) === 2);
  assert.equal((await ui(guest.page)).start.text, 'ADMIN: START R1 · SUB-ROUND 2');
  assert.deepEqual(host.page.errors, []); assert.deepEqual(guest.page.errors, []);
  await host.ctx.close(); await guest.ctx.close();
});

test('host refresh resumes the SAME random sequence (a restored host must not replay shuffles/regimes from the start)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  const r = await page.evaluate(() => {
    S = freshState(); S.seed = 424242; S.rng = mulberry32(S.seed); S.rngN = 0;
    const reference = mulberry32(424242), expected = Array.from({ length: 8 }, () => reference());
    const live = [rand(), rand(), rand()];
    const restored = JSON.parse(JSON.stringify(S));            // what a refreshed host gets back from the server (functions are not serialised)
    S = restored; const after = [rand(), rand(), rand(), rand(), rand()];
    return { expected, got: [...live, ...after] };
  });
  assert.deepEqual(r.got, r.expected);
  await ctx.close();
});
