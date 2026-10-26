# Dalal Street — free friend-test deployment

## Recommended: Render Free Web Service

This package is a Node.js HTTP server plus a single-page HTML game. For a no-cost friend test, Render's Free Web Service is the closest fit because it can run a Node server. It is a preview/hobby tier, not a production guarantee.

### Deploy steps

1. Create/sign in to a GitHub account and create a **private** repository named `dalal-street-friend-test`.
2. Upload all files from this package to the repository root: `index.html`, `server.js`, `package.json`, and the test/report files.
3. In Render, choose **New → Web Service**, connect the repository, and select the Node runtime.
4. Use build command `npm install` and start command `npm start`. Node 20 or newer is specified in `package.json`.
5. Choose the **Free** instance and deploy.
6. Open the resulting HTTPS URL on your phone. Create a room, copy the invite link, and send it to one friend first.
7. Test with two devices on separate networks before inviting a larger group. Keep the host's tab open throughout the game.

### Free-tier limitations to know

- Render Free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake up. Active polling during a game should normally keep the service active, but this must be tested.
- Room data is in server memory. A restart, redeploy, or spin-down can erase active rooms.
- This MVP uses the host browser as the game engine authority. The host tab must remain open.
- Use trusted friends and fictional game data only. Do not use real money or sensitive personal information.
- Free tier terms and quotas can change; confirm the current limits in the provider dashboard before deployment.

## Other options

- **Railway:** can run the Node server, but its current Free plan provides $1 of credit per month after the trial; do not assume unlimited free hosting.
- **Vercel Hobby:** free for personal projects and excellent for static frontends/serverless functions, but the current MVP relies on an in-memory long-running room server and polling. It is not the simplest drop-in deployment target.
- **Firebase Hosting + Realtime Database/Firestore:** can support a more robust shared-state architecture with free quotas, but requires adapting the room backend and testing security rules. It is not a drop-in deployment of this current Node server.

## Before inviting friends

Run `node online_api_test.js` and `node run_online_smoke.js` from the project folder. Both should pass. Then deploy and run a real two-player game with separate devices. If either player sees a different round, balance, holding, action result or event, stop and report it before adding more testers.
