# Amber/Liene M100 Wedding Photo Booth

This project is a small hosted photo-booth web app plus a Windows print-station worker for an Amber/Liene M100 4x6 photo printer.

Guests scan a QR code, open the HTTPS web app, take a photo, choose a print style, and tap print. The venue laptop polls for queued jobs and prints the rendered 4x6 image through the installed M100 USB printer driver.

## Run Locally

```powershell
node src/server.js
```

Open `http://localhost:3000`.

Phone camera access requires HTTPS except on `localhost`, so deploy the server to HTTPS hosting before using the QR code with guest phones.

## Deploy to Render

This repo is set up to deploy as one Render web service using `render.yaml`.

1. Push this project to a GitHub repository.
2. In Render, create a new Blueprint from the repository. Render will use `render.yaml` to create the web service.
3. Set `PRINT_STATION_TOKEN` in Render to a private shared token. Do not commit the real token.
4. After deploy, use the Render HTTPS URL as the guest QR code URL.
5. On the Windows print laptop, set `PHOTOBOOTH_BASE_URL` to the Render HTTPS URL and set `PRINT_STATION_TOKEN` to the same token, then run the print station.

Manual Render setup also works: create a Node Web Service, use `npm install` as the build command, `npm start` as the start command, and `/healthz` as the health check path.

Render's free web services can cold start after being idle, and this app currently stores uploaded images and jobs on the service filesystem. That storage is temporary on free hosting and can disappear after restarts or redeploys, so keep the print station running during the event and treat this as temporary hosting.

## Environment

Server:

```bat
set "PORT=3000"
set "PRINT_STATION_TOKEN=choose-a-private-token"
node src/server.js
```

Print station:

```bat
set "PHOTOBOOTH_BASE_URL=https://your-hosted-app.example.com"
set "PRINT_STATION_TOKEN=choose-a-private-token"
set "PRINTER_NAME=Liene Photo Printer"
node scripts/print-station.js
```

On Windows, the print station defaults to the built-in image print path through `rundll32 shimgvw.dll,ImageView_PrintTo`, so it can run from `cmd` without PowerShell.

After sending a photo, the print station watches the Windows print queue and keeps the guest status page on simple messages like "Waiting for the printer to accept your photo" and "Printing your photo now." It only marks the job printed after Windows reports the Liene queue has accepted and then cleared the job. You can tune this with `PRINT_QUEUE_POLL_MS`, `PRINT_QUEUE_ACCEPT_TIMEOUT_MS`, and `PRINT_QUEUE_DONE_TIMEOUT_MS`.

Use `DRY_RUN=1` for a rehearsal without printing:

```bat
set "DRY_RUN=1"
node scripts/print-station.js
```

If you prefer another print tool, set `PRINT_COMMAND` with `{file}` and `{printer}` placeholders instead of `SUMATRA_PATH`.

```bat
set PRINT_COMMAND=C:\path\to\printer.exe --printer "{printer}" "{file}"
```

SumatraPDF can still be used explicitly:

```bat
set "PRINT_BACKEND=sumatra"
set "SUMATRA_PATH=C:\Program Files\SumatraPDF\SumatraPDF.exe"
node scripts/print-station.js
```

## Guest Flow

- `/` opens the capture flow.
- Guests can choose `4x6` or `Strip`.
- `4x6` prints one full-bleed photo.
- `Strip` captures three photos and renders a 4x6 collage.
- `/print/:jobId` shows lightweight job status.

## API

- `POST /api/print-jobs`
  - Body: `guestName`, `layout`, `sourceImageDataUrl`, `renderedPrintDataUrl`
- `GET /api/print-jobs/:id`
  - Returns a job for guest status polling.
- `GET /api/print-jobs/next`
  - Requires `Authorization: Bearer <PRINT_STATION_TOKEN>`.
  - Claims the next queued job as `printing`.
- `POST /api/print-jobs/:id/status`
  - Requires print-station authorization.
  - Body: `status`, optional `errorMessage`.

## Wedding Rehearsal Checklist

1. Install the official M100/Liene printer driver on the Windows laptop.
2. Connect the printer by USB and print a normal 4x6 test photo.
3. Deploy this app to HTTPS hosting and set `PRINT_STATION_TOKEN`.
4. Start the print station on the laptop with the same token.
5. Submit test photos from iPhone Safari and Android Chrome.
6. Confirm multiple jobs print in order.
7. Test paper-out or printer-off behavior and confirm failed jobs are visible in status.
