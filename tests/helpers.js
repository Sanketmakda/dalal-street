'use strict';
// Shared helpers for the Dalal Street test suite. All tests drive the REAL index.html and server.js.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  for (const dir of [process.env.PLAYWRIGHT_MODULE_DIR, '/opt/npm-tools/node_modules'].filter(Boolean)) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright'); } catch {}
  }
  throw new Error('playwright is not installed. Run `npm i -D playwright` or set PLAYWRIGHT_MODULE_DIR.');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
let portCounter = 3200 + Math.floor(Math.random() * 400);

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers })); }).on('error', reject);
  });
}

async function startServer(env = {}) {
  const port = portCounter++;
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', d => log += d); proc.stderr.on('data', d => log += d);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await httpGet(url + '/health'); if (r.status === 200) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
    if (i === 49) { proc.kill(); throw new Error('server did not start: ' + log); }
  }
  return {
    url, port, proc, get log() { return log; },
    stop: () => new Promise(res => { if (proc.exitCode !== null) return res(); proc.once('exit', res); proc.kill('SIGTERM'); }),
  };
}

async function launch() { return chromium.launch(); }

// Open the game in a fresh, independent browser context with error capture.
async function openGame(browser, base, { clock = false, query = '' } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => page.errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400 && !/\/api\//.test(r.url())) page.errors.push(`http ${r.status()}: ${r.url()}`); });
  if (clock) await page.clock.install();
  await page.goto(base + '/' + query);
  return { ctx, page };
}

// Offline (bot) game, started through the real UI controls.
async function startBotGame(page, { players = 2, timer = 3, ipoPlan, events, bonus } = {}) {
  await page.evaluate(({ players, timer, ipoPlan, events, bonus }) => {
    const t = document.getElementById('timer');
    if (![...t.options].some(o => o.value === String(timer))) { const o = document.createElement('option'); o.value = String(timer); o.textContent = timer + 's (test)'; t.appendChild(o); }
    t.value = String(timer); t.dispatchEvent(new Event('change'));
    const pc = document.getElementById('playerCount'); pc.value = String(players); pc.dispatchEvent(new Event('change'));
    if (ipoPlan) { const e = document.getElementById('ipoPlan'); e.value = ipoPlan; e.dispatchEvent(new Event('change')); }
    if (events != null) { const e = document.getElementById('eventsOn'); e.checked = events; e.dispatchEvent(new Event('change')); }
    if (bonus != null) { const e = document.getElementById('bonusOn'); e.checked = bonus; e.dispatchEvent(new Event('change')); }
  }, { players, timer, ipoPlan, events, bonus });
  await page.click('#startGame');
}

const phase = page => page.evaluate(() => S.phase);

async function waitPhase(page, wanted, timeout = 10000) {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  await page.waitForFunction(l => l.includes(S.phase), list, { timeout });
}

async function createRoom(page, name = 'Host') {
  await page.fill('#onlineName', name);
  await page.click('#onlineCreate');
  await page.waitForFunction(() => document.getElementById('onlineRoomCode').textContent.length === 6, null, { timeout: 8000 });
  return (await page.textContent('#onlineRoomCode')).trim();
}
async function joinRoom(page, code, name = 'Guest') {
  await page.fill('#onlineName', name);
  await page.fill('#onlineCode', code);
  await page.click('#onlineJoin');
}
async function setTimerOption(page, seconds) {
  await page.evaluate(sec => {
    const t = document.getElementById('timer');
    if (![...t.options].some(o => o.value === String(sec))) { const o = document.createElement('option'); o.value = String(sec); o.textContent = sec + 's (test)'; t.appendChild(o); }
    t.value = String(sec); t.dispatchEvent(new Event('change'));
  }, seconds);
}

module.exports = { ROOT, httpGet, startServer, launch, openGame, startBotGame, phase, waitPhase, createRoom, joinRoom, setTimerOption };
