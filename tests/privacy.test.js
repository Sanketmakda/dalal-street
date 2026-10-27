'use strict';
// Part 2: private Intel is private in the NETWORK PROTOCOL, not only in the UI.
// Alice = host (player 0), Bob = guest (player 1), two separate browser contexts against the real server.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let server, browser;
before(async () => { server = await H.startServer(); browser = await H.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout ' + fn); await new Promise(r => setTimeout(r, 100)); } };
function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'content-type': 'application/json' } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, text: b, json: j }); });
    });
    r.on('error', reject); if (body !== undefined) r.write(JSON.stringify(body)); r.end();
  });
}
// Record every response body the guest receives from the server.
function record(page) { page.bodies = []; page.on('response', async r => { if (/\/api\//.test(r.url())) { try { page.bodies.push(await r.text()); } catch {} } }); }
const hasCard = (text, id) => new RegExp(`"cardId"\\s*:\\s*${id}\\b`).test(text);

async function setup() {
  const alice = await H.openGame(browser, server.url), bob = await H.openGame(browser, server.url);
  record(bob.page);
  const code = await H.createRoom(alice.page, 'Alice'); await H.joinRoom(bob.page, code, 'Bob');
  await until(async () => (await alice.page.evaluate(() => S.players.length)) === 2);
  await H.setTimerOption(alice.page, 60);
  await alice.page.click('#startGame'); await until(async () => bob.page.evaluate(() => S.started));
  await alice.page.click('#startRound'); await until(async () => (await bob.page.evaluate(() => S.phase)) === 'DECISION');
  await until(async () => (await bob.page.evaluate(() => S.players[1].privateCards.length)) > 0);
  const hands = await alice.page.evaluate(() => S.players.map(p => p.privateCards.map(c => ({ id: c.cardId, label: cardLabel(c), kind: c.kind }))));
  const token = await bob.page.evaluate(() => onlineToken), codeStr = code;
  return { alice, bob, hands, token, code: codeStr };
}

test('Alice and Bob are dealt separate hands of 5 distinct cards', async () => {
  const { alice, bob, hands } = await setup();
  assert.equal(hands[0].length, 5); assert.equal(hands[1].length, 5);
  const ids = [...hands[0], ...hands[1]].map(c => c.id);
  assert.equal(new Set(ids).size, 10, 'no card is held by two players');
  await alice.ctx.close(); await bob.ctx.close();
});

test('Bob never receives Alice\'s unrevealed cards, the card pool, the RNG seed, or Alice\'s pending orders (network payloads + page state)', async () => {
  const { alice, bob, hands } = await setup();
  await alice.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 300); });   // Alice's hidden orders
  await bob.page.evaluate(() => { addAction('BUY', 2, 200); addAction('BUY', 3, 200); });
  await until(async () => (await alice.page.evaluate(() => S.players[1].actions.length)) === 2);
  await new Promise(r => setTimeout(r, 1800)); // let several polls deliver state
  const all = bob.page.bodies.join('\n');
  assert.ok(bob.page.bodies.length > 3, 'captured guest traffic');
  for (const c of hands[0]) assert.equal(hasCard(all, c.id), false, `Alice card ${c.id} (${c.label}) leaked in Bob's network traffic`);
  for (const c of hands[1]) assert.equal(hasCard(all, c.id), true, 'Bob does receive his OWN cards');
  assert.equal(/"cardPool"/.test(all), false, 'the undealt card pool must not be sent (it reveals what others hold)');
  assert.equal(/"seed"\s*:/.test(all), false, 'the RNG seed must not be sent (it lets a guest predict future deals)');
  const bobState = await bob.page.evaluate(() => JSON.stringify(S));
  for (const c of hands[0]) assert.equal(hasCard(bobState, c.id), false, 'Alice card in Bob\'s page state');
  const aliceAct = await bob.page.evaluate(() => S.players[0].actions.length);
  assert.equal(aliceAct, 0, 'Alice\'s pending orders are hidden from Bob during the decision phase');
  // Bob sees only his own intel in currentIntel
  assert.deepEqual(await bob.page.evaluate(() => (S.currentIntel || []).map(x => x.player)), [1]);
  // ...and symmetric: Alice (host) did not need Bob's cards rendered
  assert.equal(await alice.page.evaluate(() => document.getElementById('intelHand').children.length), 5);
  await alice.ctx.close(); await bob.ctx.close();
});

test('direct endpoint abuse: forged ids, query params, wrong tokens and spoofed playerId cannot reveal or alter another hand', async () => {
  const { alice, bob, hands, token, code } = await setup();
  const base = server.url + `/api/rooms/${code}`;
  for (const extra of ['', '&playerId=0', '&player=0&id=0', '&host=true', '&since=0']) {
    const r = await req('GET', `${base}/poll?token=${token}${extra}`);
    assert.equal(r.status, 200);
    for (const c of hands[0]) assert.equal(hasCard(r.text, c.id), false, `leak via ${extra}`);
    assert.equal(r.json.state.players[0].privateCards.length, 0);
  }
  assert.equal((await req('GET', `${base}/poll?token=${token}x`)).status, 401);
  assert.equal((await req('GET', `${base}/poll`)).status, 401);
  const viaHeader = await new Promise(res => { const u = new URL(base + '/poll'); http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'x-room-token': token } }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }); });
  for (const c of hands[0]) assert.equal(hasCard(viaHeader, c.id), false);
  assert.equal((await req('GET', `${base}/state?token=${token}`)).status, 404, 'there is no endpoint that returns raw host state');
  // spoofed playerId in a command body is ignored: the action lands on Bob (id 1), never on Alice (id 0)
  await req('POST', `${base}/command?token=${token}`, { type: 'ADD_ACTION', action: 'BUY', stock: 4, qty: 200, playerId: 0 });
  await until(async () => (await alice.page.evaluate(() => S.players[1].actions.length)) === 1);
  assert.equal(await alice.page.evaluate(() => S.players[0].actions.length), 0);
  // tampering with localPlayerId in Bob's console only changes which (blank) record is rendered
  await bob.page.evaluate(() => { localPlayerId = 0; renderPrivateIntel(); });
  const text = await bob.page.textContent('#intelHand');
  for (const c of hands[0]) assert.equal(text.includes(c.label), false, 'Alice\'s hand not rendered after localPlayerId tampering');
  await alice.ctx.close(); await bob.ctx.close();
});

test('refresh/reconnect: each player keeps their own hand; the guest still cannot see the host\'s', async () => {
  const { alice, bob, hands } = await setup();
  await bob.page.reload();
  await until(async () => bob.page.evaluate(() => typeof S !== 'undefined' && S.players[1] && S.players[1].privateCards.length === 5));
  assert.deepEqual(await bob.page.evaluate(() => S.players[1].privateCards.map(c => c.cardId)), hands[1].map(c => c.id));
  assert.equal(await bob.page.evaluate(() => S.players[0].privateCards.length), 0);
  await alice.page.reload();
  await until(async () => alice.page.evaluate(() => typeof S !== 'undefined' && S.phase === 'DECISION' && S.players[0].privateCards.length === 5));
  assert.deepEqual(await alice.page.evaluate(() => S.players[0].privateCards.map(c => c.cardId)), hands[0].map(c => c.id));
  assert.equal(await alice.page.evaluate(() => document.getElementById('intelHand').children.length), 5);
  await alice.ctx.close(); await bob.ctx.close();
});

test('before resolution Bob\'s History/Revealed Intel contain no hidden cards; after resolution Alice\'s hand becomes public with outcomes; next deal does not carry the old hand', async () => {
  const { alice, bob, hands } = await setup();
  await bob.page.click('[data-page="history"]');
  assert.equal(await bob.page.evaluate(() => S.revealedCards.length), 0);
  assert.match(await bob.page.textContent('#revealedIntel'), /become public after each Sub-Round/);
  const bodies0 = bob.page.bodies.join('\n');
  for (const c of hands[0]) assert.equal(hasCard(bodies0, c.id), false);
  // play the sub-round
  await alice.page.evaluate(() => { addAction('BUY', 0, 200); addAction('BUY', 1, 200); });
  await bob.page.evaluate(() => { addAction('BUY', 2, 200); addAction('BUY', 3, 200); });
  await until(async () => (await alice.page.evaluate(() => S.players[1].actions.length)) === 2);
  await bob.page.click('[data-page="game"]'); await bob.page.click('#lock'); await until(async () => alice.page.evaluate(() => S.players[1].locked));
  await alice.page.click('#lock'); await alice.page.click('#modalReveal');
  await until(async () => (await bob.page.evaluate(() => S.phase === 'COMPLETE' && S.settled)));
  const revealed = await bob.page.evaluate(() => S.revealedCards.map(r => ({ player: r.player, ids: r.cards.map(c => c.cardId), outcomes: r.cards.map(c => !!c.outcome) })));
  assert.deepEqual(revealed.map(r => r.player).sort(), ['Alice', 'Bob']);
  assert.deepEqual(revealed.find(r => r.player === 'Alice').ids, hands[0].map(c => c.id), 'the correct historical hand is revealed');
  assert.deepEqual(revealed.find(r => r.player === 'Bob').ids, hands[1].map(c => c.id));
  assert.ok(revealed.every(r => r.outcomes.every(Boolean)), 'every revealed card carries its outcome');
  await bob.page.click('[data-page="history"]');
  const txt = await bob.page.textContent('#revealedIntel');
  assert.match(txt, /Alice/); assert.match(txt, /R1 · SR1/);
  // next sub-round: fresh deal; every card id exists exactly once across pool+hands (nothing carried over twice)
  await alice.page.click('#nextRound'); await until(async () => (await bob.page.evaluate(() => S.subRound)) === 2);
  await alice.page.click('#startRound'); await until(async () => (await bob.page.evaluate(() => S.phase)) === 'DECISION');
  const uniq = await alice.page.evaluate(() => { const ids = [...S.cardPool, ...S.players.flatMap(p => p.privateCards)].map(c => c.cardId); return { n: ids.length, u: new Set(ids).size }; });
  assert.equal(uniq.n, uniq.u, 'no duplicated card instances after re-deal');
  assert.equal(await alice.page.evaluate(() => S.players.every(p => p.privateCards.length === 5 && p.privateCards.every(c => !c.outcome))), true, 'new hands carry no outcome from the previous sub-round');
  assert.equal(await alice.page.evaluate(() => S.players.every(p => p.status !== 'x')), true);
  const bobNow = await bob.page.evaluate(() => S.players[0].privateCards.length);
  assert.equal(bobNow, 0, 'Alice\'s NEW hand is private again');
  assert.deepEqual(alice.page.errors, []); assert.deepEqual(bob.page.errors, []);
  await alice.ctx.close(); await bob.ctx.close();
});

test('server fails closed: a malformed currentIntel is never forwarded to a guest', async () => {
  const http = require('node:http');
  const call = (method, path, body) => new Promise((res, rej) => { const u = new URL(server.url + path); const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'content-type': 'application/json' } }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ status: x.statusCode, text: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const room = (await call('POST', '/api/rooms', { name: 'H' })).json, guest = (await call('POST', `/api/rooms/${room.code}/join`, { name: 'G' })).json;
  const secret = 'LEAK-CHECK-' + Date.now();
  await call('POST', `/api/rooms/${room.code}/state?token=${room.token}`, { state: { started: true, players: [{ id: 0, privateCards: [{ cardId: secret }] }, { id: 1 }], currentIntel: { 0: [secret] } } });
  const poll = await call('GET', `/api/rooms/${room.code}/poll?token=${guest.token}&since=0`);
  assert.equal(poll.status, 200); assert.ok(!poll.text.includes(secret));
});
