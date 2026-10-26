# Dalal Street online friend-test MVP — QA status

Date: 2026-10-26

## What was added

- Public Node HTTP server with temporary six-character room codes.
- Create-room and join-room flows, shareable invite URL, and up to 10 seats.
- Host-only control for starting/advancing rounds and revealing decisions.
- Remote-player BUY/SELL/SKIP, lock, IPO bid, quit and VITO request routing to the existing engine in the host browser.
- Shared state snapshots with per-player private-card filtering.
- Duplicate display-name handling, late-join rejection, basic session refresh recovery, and a host-online indicator.
- Existing navy/gold CSS is byte-for-byte unchanged from v34.

## UI refinements in this revision

- Updated the online lobby card to use the existing navy/gold theme with a clearer hierarchy, touch-sized controls, and a stacked mobile layout.
- Clarified room code/invite instructions and the host-tab limitation.
- Added uppercase/alphanumeric room-code input cleanup, Enter-to-join, and clearer invite-link status.
- Added loading states to prevent repeated Create/Join clicks during a pending request.
- Added accessible live status messaging and error/success/waiting visual states.
- Hid the QA / Game Brain navigation item in the friend-test build.
- Added reduced-motion handling for the scrolling news strip.
- The existing base stylesheet remains intact; changes are additive online-preview overrides.

## QA results

- Existing engine BUY/SELL edge tests: 39/39 passed.
- Existing corporate action, IPO, VITO, state, quit, timing and escrow tests: 105/105 passed.
- Existing local bot regression: 300/300 games passed across 2, 6 and 10 seats; 6,600 Sub-Rounds audited; zero audit failures.
- Online UI startup shim: no startup exception; online panel and room-code controls present. After the UI refinement, the shim reports 872 DOM nodes, 88 IDs, and no startup exception.
- Online command smoke checks: 4/4 passed (remote BUY seat routing, per-player locking, remote IPO escrow, host-only controls).
- Online HTTP API checks: 12/12 passed (health, room creation, duplicate names, state publishing, private-card filtering, host permissions, command queue attribution, late-join rejection, invalid token and 10-seat cap).
- Static checks: both inline scripts pass Node syntax checks; no duplicate IDs in static HTML; all literal original `$()` references resolve; CSS matches v34 exactly.

## What is not yet verified / remaining blocker

- This package has **not been deployed to a public URL** and has not yet completed a real two-device friend game. A real browser/network test is still required.
- The existing engine runs in the host browser. This is a private test relay, not a fully server-authoritative multiplayer engine. The host tab must stay open; host-side game logic is trusted.
- Server rooms and game state are in memory and reset on server restart/sleep/redeploy. Reconnect is best-effort only.
- Server-authoritative timers, durable accounts/game history, robust idempotency, atomic VITO/IPO/round transitions, security hardening, and concurrency/load testing remain required before public production release.
- Live ticker/news is still demo/reference content.
- The previously recorded Bonus Round 11 trigger frequency and three pending gameplay decisions remain unresolved. They were not silently changed in this online MVP.

## Free deployment guidance

`DEPLOY_FREE_TEST.md` documents Render Free Web Service as the recommended no-cost option for this Node-based preview, with its spin-down and in-memory-room limitations, plus Railway, Vercel and Firebase alternatives.

## Release decision

**Suitable as a first private friend-test candidate after deployment, but not yet proven ready for live friends.** The next gate is deploying this exact package, then running one complete 2-player real-browser game on separate devices and fixing every failure before expanding the test group.
