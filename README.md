# Amerigo Vespucci Live AIS Tracker

This project runs a Node.js 20+ service that listens to AISStream.io for the Italian Navy training ship **Amerigo Vespucci** and updates an existing ArcGIS hosted feature layer with the latest position.

- Ship: **Amerigo Vespucci**
- MMSI: **247999000**
- ArcGIS hosted feature layer item: `fea75f4405ec44e8bf099ab2cb054a33`

The service updates one current-position feature instead of creating endless duplicates. Optional breadcrumb/history writes can be enabled for a separate layer.

## What you need

1. Node.js 20 or newer.
2. An AISStream.io API key.
3. ArcGIS Online access to edit the hosted feature layer.
4. Either an ArcGIS token, or an ArcGIS username and password that can generate a token.

No secrets are stored in this repository. Put secrets only in your local `.env` file or deployment platform secret manager.

## Quick start for non-developers

### 1. Download and install

```bash
npm install
```

### 2. Create your settings file

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in:

- `AISSTREAM_API_KEY`
- `ARCGIS_TOKEN`, or `ARCGIS_USERNAME` and `ARCGIS_PASSWORD`

Leave `TARGET_MMSI=247999000` and `ARCGIS_ITEM_ID=fea75f4405ec44e8bf099ab2cb054a33` unless you intentionally need to change them.

### 3. Configure ArcGIS fields automatically

Run this once after filling in `.env`:

```bash
npm run setup:arcgis
```

The script adds these fields to the current-position layer when they are missing: `MMSI`, `VesselName`, `SpeedKnots`, `Course`, `Heading`, `Latitude`, `Longitude`, `LastAIS`, `Destination`, and `NavStatus`.

If you want breadcrumb/history support, create or identify a second point layer in the same hosted feature service, set `ENABLE_HISTORY=true`, set `ARCGIS_HISTORY_LAYER_ID`, and run the setup command again.

### 4. Start the live tracker

```bash
npm start
```

When AISStream sends a position report for MMSI `247999000`, the service updates ArcGIS.

### 5. Check service health

Open this in a browser on the machine running the service:

```text
http://localhost:3000/health
```

The health endpoint returns HTTP 200 when the Node service is running. Its JSON reports AIS status separately with `aisConnected`, `aisFresh`, `lastAIS`, and `lastArcGISUpdate`, so Render health checks do not fail just because AIS data is temporarily stale.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AISSTREAM_API_KEY` | Yes | AISStream.io API key. |
| `TARGET_MMSI` | No | Defaults to `247999000`. |
| `ARCGIS_ITEM_ID` | Yes | Existing hosted feature layer item ID. |
| `ARCGIS_TOKEN` | Yes, unless username/password are set | ArcGIS token from a secret manager or manual generation. |
| `ARCGIS_USERNAME` / `ARCGIS_PASSWORD` | Yes, unless token is set | Used to generate a server-to-server ArcGIS token automatically with `client=requestip`. |
| `ARCGIS_PORTAL_URL` | No | Defaults to `https://www.arcgis.com`. |
| `ARCGIS_CURRENT_LAYER_ID` | No | Defaults to layer `0`. |
| `ENABLE_HISTORY` | No | Set to `true` to add breadcrumb records to a separate layer. |
| `ARCGIS_HISTORY_LAYER_ID` | No | Defaults to layer `1`. |
| `HISTORY_MIN_INTERVAL_SECONDS` | No | Minimum seconds between breadcrumb writes. Defaults to `300`. |
| `PORT` | No | Health endpoint port. Defaults to `3000`. |
| `HEALTH_STALE_AFTER_SECONDS` | No | Health becomes stale after this many seconds without AIS. Defaults to `1800`. |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error`. |

## How it works

1. `src/aisstream.js` opens an AISStream WebSocket and subscribes with `FiltersShipMMSI` for only MMSI `247999000`.
2. Incoming AIS messages are parsed into a normalized position record.
3. `src/arcgis.js` resolves the hosted feature layer URL from the ArcGIS item ID.
4. The service searches for an existing feature with the same MMSI and then updates that feature. If it does not exist, the service creates it once and updates it afterwards.
5. If history is enabled, the service writes breadcrumb points to the configured history layer at a controlled interval.
6. `src/server.js` exposes `/health` for monitoring.

## ArcGIS web map guide

See [docs/arcgis-web-map-guide.md](docs/arcgis-web-map-guide.md) for step-by-step instructions to display the ship, rotate the symbol using `Heading`, configure popups, auto-refresh the map, and optionally show recent track history.

## Deployment notes

- Use a process manager or platform that restarts the service if the process exits.
- Store `.env` values in deployment secrets, not in GitHub.
- The WebSocket client includes exponential reconnect logic up to 30 seconds between attempts.
- For continuous 24/7 operation, set `ARCGIS_USERNAME` and `ARCGIS_PASSWORD` so the service can renew ArcGIS tokens automatically. Because this service runs server-side on Render rather than in a browser, generated tokens use ArcGIS `client=requestip` server-to-server authentication instead of a referer-bound browser token. If ArcGIS returns token-expired or invalid-token errors, the service renews the token and safely retries the failed request. A static `ARCGIS_TOKEN` is supported, but automatic renewal requires credentials to be configured too.

## Developer checks

```bash
npm run check
```
