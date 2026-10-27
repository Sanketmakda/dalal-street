# Test report – round 2 (final files, Node 22, Playwright Chromium)

Commands run (all executed on the exact files being committed):

| Command | Result |
|---|---|
| `node --check server.js` | PASS |
| `node tests/check_syntax.js` (both inline scripts of `index.html`) | PASS |
| `node --test --test-concurrency=1 tests/*.test.js` (= `npm test`) | **PASS – 53 / 53, 0 failed** (~100 s) |

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
