'use strict';
// Browser end-to-end tests for the offline (bot) game. Real index.html, real engine, real UI controls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

test('D1 regression: bots are real bots after START BOT GAME (not remote humans)', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 4 });
  const seats = await page.evaluate(() => S.players.map(p => ({ id: p.id, remoteHuman: !!p.remoteHuman, profile: p.profile })));
  assert.equal(seats[0].remoteHuman, false);
  for (const s of seats.slice(1)) assert.equal(s.remoteHuman, false, `seat ${s.id} must be a bot, got ${JSON.stringify(s)}`);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('D1 regression: starting a round makes every bot decide and lock; LOCK then advances to REVIEW', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 3, timer: 30 });
  await page.click('#startRound');
  await H.waitPhase(page, 'DECISION');
  const bots = await page.evaluate(() => S.players.slice(1).map(p => ({ locked: p.locked, n: p.actions.length })));
  for (const b of bots) { assert.equal(b.locked, true, 'bot must be locked'); assert.ok(b.n >= 2, 'R1 SR1 bot must hold 2-5 BUYs'); }
  assert.equal(await page.evaluate(() => document.getElementById('lock').disabled), false, 'LOCK enabled for the human');
  // Human picks two distinct companies through the real UI.
  for (const idx of [0, 1]) { await page.click(`[data-stock="${idx}"]`); await page.fill('#qty', '200'); await page.click('#buy'); }
  await page.click('#lock');
  await H.waitPhase(page, 'REVIEW');
  assert.equal(await page.evaluate(() => document.getElementById('decisionStatus').innerText.includes('Thinking')), false, 'no seat may remain "Thinking"');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('D1 regression: timer expiry with an idle human can never leave the game stuck at 0s', async () => {
  const { ctx, page } = await H.openGame(browser, server.url);
  await H.startBotGame(page, { players: 2, timer: 3 });
  await page.click('#startRound');
  await H.waitPhase(page, 'REVIEW', 8000); // 3s timer, human never acts
  const s = await page.evaluate(() => ({ lockDis: document.getElementById('lock').disabled, confirmVisible: document.getElementById('confirm').style.display, confirmDis: document.getElementById('confirm').disabled, status: document.getElementById('decisionStatus').innerText, acts: S.players[0].actions.length }));
  assert.equal(s.confirmVisible, 'inline-block'); assert.equal(s.confirmDis, false);
  assert.ok(s.acts >= 2, 'R1 SR1 timeout auto-fills the compulsory BUYs');
  assert.ok(!s.status.includes('Thinking'));
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
