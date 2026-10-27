# Test report (final files, `npm test`, Node 22 + Playwright Chromium, 23/23 PASS)

Run: `node --check server.js && node tests/check_syntax.js && node --test --test-concurrency=1 tests/*.test.js`

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1-3 | D1: bots are real bots; bots decide+lock and human LOCK → REVIEW; idle-human timeout reaches REVIEW | PASS | real Chromium, no console/page errors; fail on baseline |
| 4 | Full game R1.SR1 → game over (≥20 sub-rounds, IPO ×2, events, bonus on), UI-driven, fake clock | PASS | one settlement per sub-round; prices within 0–10,000; no negative cash; supply = 10,000 each company; 4 final standings |
| 5 | Action limits R1.SR1=5, R1.SR2/R2-9=3, R10/11=5 | PASS | `maxActions()` |
| 6-7 | Server GET/HEAD routes, 404 JSON, bad JSON, invalid room, bad token, host-only commands, malformed commands | PASS | HTTP status asserts |
| 8 | Two separate browser contexts: join, permissions, both trade, guest lock, host lock/reveal, identical state on both | PASS | JSON snapshot equality |
| 9 | Online timer expiry locks idle guest → REVIEW | PASS | |
| 10 | Guest refresh + host refresh mid-round, timer resumes, round completes | PASS | |
| 11 | Duplicate / out-of-order commands: one trade set, one settlement | PASS | |
| 12 | Invalid room join reported and recoverable | PASS | |
| 13 | Server restart → client reports lost room | PASS | |
| 14 | `/`, `/index.html`, `/?room=` load; every nav button works | PASS | no errors |
| 15-17 | D4, D5, D2 regressions | PASS | fail on baseline |
| 18 | ₹10,00,000 start; R1.SR1 2–5 distinct BUY, no SELL/SKIP, qty 200–500, duplicate company, action removal, 5-action cap | PASS | |
| 19 | 2,500 cap and insufficient cash | PASS | |
| 20 | SELL maturity (2 sub-rounds), 50% cap, <400 exception, min 200, action cap, proceeds credited | PASS | |
| 21 | Repeated confirm/resolve cannot double-settle | PASS | |
| 22 | Visible countdown, deterministic expiry → REVIEW → COMPLETE | PASS | |
| 23 | `simulateOneGame` engine smoke (weak: only asserts no exception) | PASS | |

NOT RUN: VITO and card-private-information behaviour were not given dedicated tests (the full game exercises the VITO prompt path only if a bankruptcy occurs); circuit limits are only covered indirectly by the price-bound invariants; live-URL smoke test (no push access from this session).
