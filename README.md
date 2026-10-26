
# Dalal Street — Friend Test

A Node.js server and single-page HTML game for private friend testing.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Open a terminal in this folder.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` in your browser.

## Deployment
Deploy as a Node.js web service. Set the start command to `npm start` and configure the service to use the port provided by the hosting platform.

## Important limitations
This is a friend-test build, not a production-ready multiplayer game. Room state may be lost when the server restarts. The host browser must remain open, and real two-player gameplay must be tested before inviting friends.
