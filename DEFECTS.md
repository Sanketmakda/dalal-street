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
