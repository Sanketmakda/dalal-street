
# Dalal Street — Free Friend-Test Deployment

## Render deployment

1. Push the project files to your GitHub repository.
2. In Render, create a new Web Service and connect the repository.
3. Select the Node runtime.
4. Build command: `npm install`
5. Start command: `npm start`
6. Deploy and open the HTTPS URL.
7. Test with two separate devices before inviting more players.

## Requirements

The project root must contain:
- `index.html`
- `server.js`
- `package.json`

## Limitations

- Room data may be lost when the server restarts.
- The host browser must remain open.
- Real two-player gameplay must be tested.
- Do not use real money or sensitive personal information.
- This deployment guide does not guarantee that gameplay controls are working.
