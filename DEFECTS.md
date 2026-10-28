# Dalal Street – defect log (all verified by automated tests)

Baseline = `main` @ `fb71c84`. "Fails on baseline" = the regression test was run against the original `index.html`/`server.js` and failed; it passes on the fixed files.

| ID | Defect | Root cause (file / function) | Fix | Regression test |
|----|--------|------------------------------|-----|-----------------|
| D1 | Timer at 0s, bots "Thinking", LOCK dead, round never advances in every normal bot game | `index.html` online layer: the `startGame` wrapper marked every seat ≥1 `remoteHuman=true` even with no online room; `botDecisions()` skips remote humans, so bots never decided/locked and the round could never reach REVIEW | Only mark remote seats when an online room exists | `e2e_bots.test.js` ×3 (fail on baseline) |
| D2 | Online IPO: guest cash silently frozen and bids placed for real players | `startIPOWindow` auto-bid loop covered every seat ≥1 | Skip `remoteHuman` seats | `regressions.test.js` D2 |
| D3 | Stale duplicate `index .html` (space in name) beside `index.html` | Upload artefact | Deleted (only `index.html` is served) | `online.test.js` server test |
| D4 | After an invalid committed batch the game sat in DECISION with a stopped timer (nobody able to progress except the host) for remote players | `resolveRound` fell into the bot-regeneration branch for remote humans; timer was never restarted | New `reopenForCorrection()` unlocks the seat, restarts the timer; used for host, remote and R1.SR1 paths | `regressions.test.js` D4 (fails on baseline) |
| D5 | Host refresh while the phase was REVEAL (or IPO_BID) restored a state with no pending transition/timer → permanent stall | `onlinePoll` restore only restarted the DECISION timer | `onlineResumeAfterRestore()` resumes DECISION timer, IPO timer, or re-runs `resolveRound` for REVEAL | `regressions.test.js` D5 (fails on baseline) |
| D6 | Render "Not Found" on health checks / uptime pings | `server.js` answered only `GET` for `/`, `/index.html`, `/health`; `HEAD` fell through to the JSON 404 | HEAD handled for the same routes | `online.test.js` server test |
| D7 | Host commands (guest locks / trades) lost if a poll response was dropped | Server `splice`d commands out of the queue on delivery | Commands carry `seq`; server deletes only on host `ack`; host dedupes by `seq` and persists the ack across refresh | `online.test.js` duplicate/out-of-order |
| D8 | After server restart/room expiry clients showed "Reconnecting…" forever | Poll errors were never classified | `onlineRoomLost()` clears the session, re-enables Create/Join, tells the user to reload | `online.test.js` restart test |
| D9 | Guest lobby showed an enabled START button until first state arrived; guests/refreshed clients stayed on the Lobby page after the host started | Permissions/navigation only applied on state render | `onlineApplyPermissions()` on connect; `onlineEnsureGamePage()` on first started state | `online.test.js` two-context test |

## Ambiguities recorded, rules NOT changed
* Holdings can legitimately exceed 2,500 through documented bonus/event overflow (`bonusOverflow` / `eventOverflow`); the test allows only flagged overflow.
* Timer expiry outcome (documented): every unlocked active seat is locked with its current valid orders; in R1.SR1 missing compulsory BUYs are auto-filled with 200-share BUYs in distinct companies; if that is impossible decisions reopen for 30 s.

---
# Round 2 (base commit `810dffc`)

| ID | Defect | Root cause (file / function) | Fix | Regression test |
|----|--------|------------------------------|-----|-----------------|
| D10 | Contradictory controls after a settlement: header "Sub-Round 1/2", badge COMPLETE, **START R1·SR1 and NEXT ROUND both enabled**, counter "0 / 5" for a slot that already ran | `renderGame` derived each label/button from different conditions; `nextRound` advanced the sub-round on `COMPLETE` with no notion of "this slot already settled" | One authoritative `controlState()`; `S.settled` marks a resolved slot; START only for an unplayed slot, ADVANCE only for a settled one; every disabled button carries a reason (`title`); counter shows the limit of the slot it names | `state_machine.test.js` (7) |
| D11 | **"Private" Intel was only private in the UI.** Guests received `currentIntel` (every player's hand), `cardPool` (undealt cards), the RNG `seed`/`rngN`, other players' pending orders and sealed IPO bids; only `privateCards` was blanked | `server.js personalizedState` filtered a single field | Server removes all of the above for non-host members; identity comes only from the room token | `privacy.test.js` (5) – 3 fail on `810dffc` |
| D12 | In an online room the **host's** disabled START/NEXT lost their explanation | `onlineApplyPermissions` reset `title` | Host keeps the state-derived reason | `state_machine.test.js` online test |
| D13 | After a host refresh the RNG restarted from its seed → repeated shuffles/regimes/cards | `rand()` recreated `mulberry32(seed)` without skipping consumed draws | `S.rngN` counts draws and is replayed on restore | `state_machine.test.js` RNG test |
| D14 | `intelPressure`/formulas had undocumented magic numbers; help could drift from code | constants inline | Single constant block (`CARD_SIGNALS`, `INDEX_MIX`, `FX_BETA_BY_SECTOR`, …) used by both engine and help text | `cards_indices.test.js` |
| D15 | **Bug:** LT (Capital Goods) received IT's USD/INR beta (0.45 instead of 0.05) because sectors were matched by substring (`'capital goods'.includes('it')`) | `resolvePrices` | exact sector lookup `fxBetaFor()` | `cards_indices.test.js` USD/INR test (fails on `810dffc`) |
| D16 | My own round-1 D4 change silently truncated an over-limit human batch; the engine's built-in self-test caught it | `resolveRound` | Orders are kept; the player removes one | `accounting.test.js` built-in-suite test |
| D17 | Ticker is static demo HTML; nothing told the player which indices actually drive prices | UX | Strip "SIMULATED GAME INDICES" + How-to-Play §15/§16 + "? How to read Private Intel" dialog | `cards_indices.test.js` help UI test |

## Behaviour changes that need your approval (not silent)
1. **Banking index mapping (new):** HDFC Bank and ICICI Bank weight NIFTY/SENSEX/BANK NIFTY 0.20/0.15/0.65; every other company keeps 0.35/0.25/0.40. Before, there was *no* sector mapping (everyone used 0.35/0.25/0.40, so BANK NIFTY already moved every company). Revert: set `INDEX_MIX.Banking = INDEX_MIX.default`.
2. **FX beta fix (D15):** LT's USD/INR sensitivity drops from 0.45 (bug) to 0.05.

## Ambiguities recorded, rules NOT changed
* A stock split halves the price but doubles only **mature** lots (documented rule), so a holder with only immature shares loses ≈50% of that holding's value. Confirm this is intended.
* A neutral fallback card (signal 0, Low) still takes part in its index's confidence-weighted average and so dilutes the real clues for that index.
* Private clues from *all* committed players on one company are summed (cap ±60): your clue is not the only force on that stock.
* The room host's browser holds every hand (host-authoritative architecture). Only a server-authoritative engine removes this; it is not attempted here.
* Cash displayed in the Players table reveals a bidder's frozen IPO funds indirectly (cash falls while bids are sealed). Not changed.
* HOW §1 still says "real multiplayer is not implemented" (outdated). Not changed.


---
# Round 3 (base commit `74811f7`) — verification, gap-closing and live-deployment status

**Starting evidence.** Checkout clean, `main` = `origin/main` = `74811f7`. Only `index.html` is served (`server.js` streams it for `/` and `/index.html`); the stale `index .html` was deleted in Round 1. There is no `render.yaml`; the production URL cannot be derived from the repository.

## Confirmed defects (reproduced, not hypothesised)

| ID | Sev | Defect | Reproduction | Root cause | Status |
|----|-----|--------|--------------|-----------|--------|
| A | High | **Screenshot defect.** After R1.SR1 settles: header `Round 1 · Sub-Round 1/2`, badge `COMPLETE`, **`START R1 · SUB-ROUND 1` enabled and `NEXT ROUND` enabled**, counter `0 / 5`. Clicking START on the settled slot re-deals every bot and puts the game back in DECISION. | Real UI on the original `810dffc` build (script in the QA report): bot game, 2 BUYs, lock, reveal. Observed `startEnabled:true,nextEnabled:true`; forced START → `DECISION`, bots re-dealt (`[5,4]` actions). | `renderGame`/`startRound`/`nextRound` each derived availability from `S.phase` alone; nothing recorded that the slot had settled. | **Fixed in `85c3178`** (`controlState()`, `S.settled`). On current main: START disabled, label names the next slot, counter `0 / 3`, forced clicks are no-ops. Tests: `state_machine.test.js` ×7 (all fail on `810dffc`), `lifecycle.test.js` "Defect A". |
| B | – | Cash ₹3,15,000 / Portfolio ₹10,33,500 / 4,800 shares. | Cannot be reconstructed: no trade log or save-game for that session was supplied. | n/a | **UNVERIFIED for those exact numbers** (not called correct). The same arithmetic is independently reconstructed after every settlement of 14 seeded games (see report) and in the displayed UI. No discrepancy found. |
| C | – | Production deployment. | Sandbox network allowlist blocks `*.onrender.com` (curl 403, fetch tool "not on allowlist"); no Render API access. | n/a | **UNVERIFIED.** Screenshot (historical) showed `cfko` + `810dffc` Live. `74811f7` is on GitHub; whether Render built it is unknown. `tests/live_smoke.js` is ready to run against the URL. |
| E | Low | `personalizedState` forwarded a non-array `currentIntel` to guests unfiltered. | API test: host publishes `currentIntel` as an object; guest poll contained the secret. | Filter guarded by `Array.isArray`. | **Fixed in `74811f7`** (fail closed). Test: `privacy.test.js` last test (fails on `85c3178`). |
| F | Test-only | Intermittent suite failures (~1 in 3 full runs). | Looped full suite; captured: BUYBACK removed a holder's fresh shares; bankruptcy opened a VITO prompt that disabled NEXT. | Online flow tests used the UI default (events ON, random seed) but asserted exact balances. **Not an engine bug**: BUYBACK / BANKRUPTCY→VITO are agreed rules. | **Fixed in tests**: `H.createRoom` switches events OFF through the real host control (after room creation, which resets the checkbox); UI-driven bot tests decline the VITO prompt like a player. Event behaviour stays covered by the seeded games. |

## Gaps in earlier coverage that this round closed (no new defects found)

Seeded engine games at 2 / 6 / 10 players (events + both IPOs + VITO + bonus round), UI-driven bot games at 2 / 6 / 10 players, late join (409), 11th player (409), malformed room codes, guest quit mid-round, host disappearance, state-version/out-of-order polling, concurrent IPO bids with oversubscription, simultaneous VITO requests, rejected-order immutability, mobile 390×844 layout.

## Recovery guarantees actually implemented (do not over-claim)

* **Host-authoritative.** The host *browser* holds the complete game state, including every hand; the server is a room/message relay that filters what guests may see. Guests cannot read other hands, but the host's browser can.
* Guest refresh: restored from the server's published state. Host refresh: restored from the last published state; timers/transitions resume; RNG sequence resumes; processed command `seq` persisted.
* **Host leaves permanently: the game is paused for everyone.** There is no host transfer (verified: one host member, `hostOnline:false`). Smallest viable fix if wanted: persist the authoritative state server-side and let a guest take over — a rule/architecture decision, not done here.
* Server restart / room expiry (4 h TTL): rooms are in memory and are lost; clients now say so and allow a new room.
