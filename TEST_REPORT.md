# Test report – round 2 (final files, Node 22, Playwright Chromium)

Commands run (all executed on the exact files being committed):

| Command | Result |
|---|---|
| `node --check server.js` | PASS |
| `node tests/check_syntax.js` (both inline scripts of `index.html`) | PASS |
| `node --test --test-concurrency=1 tests/*.test.js` (= `npm test`) | **PASS – 54 / 54, 0 failed** (~100 s) |

Every test drives the real `index.html` + `server.js`; multiplayer tests use two separate browser contexts (host "Alice", guest "Bob"). Each test also asserts no uncaught page errors / console errors / failed requests where a page is used.

| Area (file) | Tests | Result | Evidence |
|---|---|---|---|
| Part 1 – state machine (`state_machine.test.js`) | 7 | PASS | label/button/counter checked in LOBBY, DECISION, REVIEW, settled-COMPLETE, next slot, R1.SR1→SR2→R2.SR1; double-click/duplicate calls → one deal, one settlement (history 1, trades 2), one advance; illegal START/NEXT/CONFIRM/LOCK/resolve are no-ops; START and NEXT never both enabled in any of 16 phase/settled combinations; R10→game over (no R12), optional R11 limit 5; online host+guest identical labels, guest disabled, host refresh keeps settled state; RNG resumes after refresh. **All 6 state tests FAIL on deployed `810dffc`.** |
| Part 2 – privacy (`privacy.test.js`) | 5 | PASS | separate 5-card hands; Bob's captured network bodies + page state contain none of Alice's cardIds, no `cardPool`, no `seed`, Alice's orders hidden; forged `playerId`/query params/headers/no token/wrong token → nothing leaked, spoofed command body cannot act as Alice; refresh keeps own hand; before settlement History has no hidden cards; after settlement Alice's exact hand + outcomes are public; next deal has unique card instances and no carried outcomes. **3 of 5 FAIL on `810dffc`** (real leak: `currentIntel` carried every hand). |
| Part 2/3 – cards & indices (`cards_indices.test.js`) | 11 | PASS | engine prices equal an independent hand-coded formula for all 8 companies for BANK NIFTY / NIFTY / SENSEX / USD/INR / VIX clues; company clue +15 Medium = +1.5%; additive stacking, cap ±60, circuit 5%; bounds ₹0–10,000; determinism; replay applies effects once; neutral fallback; dealIntel structure; help dialog numbers equal engine numbers. (Banking-mapping and FX tests fail on `810dffc` because those are the two behaviour changes below.) |
| Part 4 – accounting (`accounting.test.js`) | 7 | PASS | after **every** settlement of 8 seeded full games (176 sub-rounds; events seen: BANKRUPTCY, BONUS_FREE, BONUS_PAID, BUYBACK, COMPANY_NEWS, DEFAULTER, DIVIDEND, MARKET_NEWS, RESULT, SPLIT, VITO_ROLLBACK; 6 VITO rollbacks; 16 IPO settlements; mid-game quit): supply = 10,000, portfolio = cash + frozen + market value, total shares, cash = ₹10,00,000 + journals, holdings = journals, lots = holdings, avg = replay of fills (events off), replayed settlement changes nothing. Negative control proves the checker detects injected corruption. Displayed Cash/Portfolio/Total shares/holdings/avg equal independent reconstruction in the UI. Dividend (mature only, frozen paid), split (mature doubles, cost basis constant, supply 10,000), VITO (price restored, once per player, no extra holdings). Built-in engine suites: 0 failures. |
| Round 1 suites (`e2e_bots`, `fullgame`, `rules`, `online`, `regressions`) | 23 | PASS | unchanged behaviour of the stuck-round fix (`810dffc`) re-verified, incl. full 4-player game to game over, two-context online play, refresh, duplicate commands, server restart. |

## NOT RUN / unverified
* **Live deployment** – see delivery notes (pushed commit, Render status and live smoke tests are reported separately; not part of this table until executed).
* The ₹3,15,000 / ₹10,33,500 / 4,800-share figures in your screenshot cannot be independently reconstructed (no trade log). The same arithmetic is verified for every state the engine can reach in the tests above, but those specific numbers are **not** confirmed.
* Corporate-action cost basis was tested independently for **split** only; free/paid bonus avg-price handling is covered by the engine's built-in suite and the per-settlement ledger checks, not by a dedicated cost-basis assertion.
* The host's browser holds all hands (architecture); no test can or does claim otherwise.


## Round 2 follow-up (verification session)
* Re-ran `npm test` on `85c3178`: 53/53 PASS. Added 1 test (server fails closed on a malformed `currentIntel`; fails on `85c3178`'s server, passes now) → **54/54 PASS**.
* `server.js personalizedState`: a non-array `currentIntel` was forwarded unfiltered to guests. The engine always writes an array, so this was not reachable in normal play, but the filter now fails closed.
* New `tests/live_smoke.js <url>` (HTTP-only post-deploy smoke: page, HEAD, health, create/join, permissions, guest payload privacy, 404). Executed against a local server: ALL PASSED. **Not executed against the Render URL** — this session's network allowlist blocks onrender.com.


---
# Round 3 report (base `74811f7`) — Node 22, Playwright Chromium, real `index.html` + `server.js`

| Command | Result |
|---|---|
| `node --check server.js` | PASS |
| `node tests/check_syntax.js` | PASS (syntax only — not evidence of gameplay) |
| `npm test` (`node --test --test-concurrency=1 tests/*.test.js`) | **PASS 68 / 68**, repeated **5 consecutive full runs, 5 × 68/68** on the final code |
| Same suite earlier in the round, before the test-determinism fix | 66/68, 68/68, 67/68, 68/68, 67/68 — failures were test-side (see DEFECTS F) |

## Defect A reproduction (original `810dffc` vs current)
Same script, real UI, 3-player bot game, 2 BUYs, lock, reveal:

| | header | badge | START | NEXT | counter | forced START click |
|---|---|---|---|---|---|---|
| `810dffc` | Round 1 · Sub-Round 1/2 | COMPLETE | **enabled**, "START R1 · SUB-ROUND 1" | enabled | Actions 0 / 5 | DECISION, bots re-dealt (`[5,4]`) |
| current | Round 1 · Sub-Round 1/2 · settled | COMPLETE | **disabled**, "START R1 · SUB-ROUND 2" | enabled | Actions (R1·SR2) 0 / 3 | no change |

All 7 `state_machine.test.js` tests fail on the `810dffc` tree and pass on current.

## New tests this round (`tests/lifecycle.test.js`, + 1 in `accounting.test.js`)
| Scenario | Result | Evidence |
|---|---|---|
| Late join after start | PASS | API 409 "already started"; UI shows "Could not join", roster unchanged |
| 11th player; malformed codes | PASS | 409 "full"; `abc!`, `%00`, 64-char code → JSON 404/400 |
| Rejected orders (199, 501, duplicate company, SELL/SKIP in R1.SR1, bad index, 200.5, −200) | PASS | cash, holdings, pending orders, supply, history, trades byte-identical before/after; reason shown each time; earlier valid order kept |
| UI-driven bot games, **2 / 6 / 10 players**, R1.SR1→SR2→R2.SR1 | PASS ×3 | every bot decided+locked via the real engine; one settlement each; `auditState` clean; supply 10,000; portfolio = cash+frozen+market |
| Guest quits mid-round | PASS | host sees "Quit · Frozen"; later ADD_ACTION ignored; round settles; guest cash ₹10,00,000, 0 shares |
| Host disappears | PASS | guest status "Host disconnected"; `hostOnline:false`; still one host (no transfer exists) |
| State versions / out-of-order | PASS | up-to-date poll → `state:null`; guest cannot publish (403); stale state cannot overwrite |
| Concurrent IPO bids (host + 2 guests, duplicate guest bid) + oversubscription | PASS | each bid reserved once; only 500 shares for sale → exactly 500 allocated, each ≤ bid, unallocated refunded, frozen=0; second `finalizeIPO` → false |
| Simultaneous VITO from two eligible guests | PASS | exactly 1 `vitoUsed`, 1 `VITO_ROLLBACK`, price restored to previous close (₹88 in fixture), halt to next main round, holdings preserved |
| Mobile 390×844 | PASS | no horizontal overflow on any page; start/lock/buy tappable; no console errors |
| Defect A screenshot regression | PASS | table above |
| Seeded full games (events+IPOs+VITO+bonus), each settlement reconciled | PASS | players/seed → rounds/sub-rounds/violations: 2/1201 → 11/22/0 · 2/1202 → 11/22/0 · 6/1203 → 11/22/0 · 6/1204 → 11/22/0 · 10/1205 → 11/22/0 · 10/1206 → 11/22/0 (plus the 8 earlier seeds, 3–6 players) |

## BLOCKED / NOT RUN
* **Live Render deployment — BLOCKED.** `*.onrender.com` is not reachable from this sandbox (curl: CONNECT 403; fetch tool: not on allowlist) and there is no Render API access. To unblock: run `npm run smoke:live https://<service>.onrender.com` and share the output, or share the Render deploy log / Events page.
* Which of `cfko` / `cfk0` is the real service name — cannot be determined here; the screenshot you described says `cfko`.
* The ₹3,15,000 / ₹10,33,500 / 4,800 figures — not reconstructable without that session's trade log.
* Real-time (non-fake-clock) 2-minute IPO window and full 10-round multiplayer between two browsers: the IPO path ran with the engine's own timers/`finalizeIPO`; a full two-browser 10-round game was **not** run (full games were run engine-side and UI-driven through the bot flow).
* No dedicated test of free/paid bonus average-price handling beyond the per-settlement reconciliation and engine self-tests.
