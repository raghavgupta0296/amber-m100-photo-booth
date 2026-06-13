# AGENTS.md

## Project

Small Node.js wedding photo booth app for the Amber/Liene M100 printer. Guests scan a QR code to open the hosted website on their own phones, take photos, choose Print, and the app turns that submission into a queued print job. A local Windows print station polls the hosted app and prints queued jobs to the USB printer.

## Structure

- `public/`: browser frontend served by the Node server.
- `src/server.js`: custom HTTP server, static file serving, health check, and print-job API.
- `src/jobStore.js`: JSON/file-backed job store and image upload handling.
- `scripts/print-station.js`: local Windows print worker.
- `render.yaml`: Render single-service deployment config.
- `test/`: Node test runner tests.

## Commands

- Start app: `npm start`
- Run print station: `npm run print-station`
- Run tests: `npm test`
- On Windows PowerShell with script policy issues, use `npm.cmd test`.

## Deployment

Deploy as one Render Node web service using `render.yaml`. Set `PRINT_STATION_TOKEN` in Render; do not commit real secrets. The Render app hosts the frontend/API, while the Windows laptop runs the print station with matching `PHOTOBOOTH_BASE_URL` and `PRINT_STATION_TOKEN`.

## Notes for Changes

- Keep frontend API calls same-origin unless intentionally adding split frontend/backend hosting.
- Phone camera access needs HTTPS, except on `localhost`.
- Uploaded images and `data/jobs.json` are runtime data and should stay ignored.
- Avoid committing photos, `.env`, `node_modules`, or print-station downloads.
- Current storage is temporary/file-backed; do not assume persistence across free-hosting restarts.
