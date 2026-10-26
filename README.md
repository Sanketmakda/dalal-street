# Dalal Street — Online Friend-Test MVP

This package adds temporary room codes and invite links to the existing Dalal Street v34 game engine. The navy/gold stylesheet is preserved. It is a **private friend-test preview**, not a production-ready release.

## What works in this preview

- Create a room and share its URL/code.
- Up to 10 real browser sessions can join before the host starts.
- A single host browser runs the existing game engine; other players send BUY/SELL/SKIP, lock, IPO bid, quit and VITO decisions to it.
- The host publishes shared game snapshots; clients see synchronized rounds, prices, balances, holdings and standings.
- Private intel is removed from other players' snapshots.
- Duplicate display names are automatically made unique.
- Late joining is rejected after the game starts.
- Session token is retained for refresh reconnect while the browser tab session survives.
- Host is the only player who can start rounds, reveal decisions and advance the game.

## Important limitations

- The host's browser is the authority and must remain open. The server is a temporary room/message relay, not yet a server-authoritative game engine.
- Room data is in memory and is lost if the service restarts or sleeps/restarts.
- This is not security-certified and should only be used with trusted friends; do not use real money or sensitive personal data.
- Host refresh recovery is best-effort; reconnect, server-side timers, atomic concurrency, persistent accounts, and full production VITO/quit race testing still need QA.
- Live ticker/news remains demo/reference content.

## Run locally

Requires Node.js 20 or newer. No external npm dependencies are needed.

```bash
npm start
```

Open `http://localhost:3000`. To test with friends on separate networks, deploy the folder to a public Node host first; `localhost` is only reachable on your own device.

## Deploy for a friend test

For the lowest-friction no-cost trial, use Render Free Web Service. Read `DEPLOY_FREE_TEST.md` for full steps, alternatives and free-tier caveats. One straightforward route is a Node web service host such as Render:

1. Put the contents of this folder in a GitHub repository.
2. Create a new **Web Service** from that repository.
3. Select Node as the runtime; build command `npm install`; start command `npm start`.
4. Use the public HTTPS URL the host provides. Open it yourself, create a room, and send the invite link to friends.
5. Keep the host's tab open during the entire game. Friends open the same public URL and enter the room code (or open the invite link).

Hosting provider account setup and public deployment are not performed by this package. Never publish the room server as a production game until the remaining server-authority, security, persistence and race-condition work is complete.

## Tests

```bash
node online_api_test.js
```

The test covers room creation, duplicate-name handling, state publishing, private-card filtering, host-only controls, queued player actions, authenticated player attribution, late-join rejection, and invalid tokens.
