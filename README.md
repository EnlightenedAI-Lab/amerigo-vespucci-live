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
4. A permanent restricted ArcGIS runtime token, or an ArcGIS username and password that can generate a runtime token.
5. Only if the hosted feature layer is missing schema fields: a temporary owner-level ArcGIS token for one-time setup.

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
- `ARCGIS_ADMIN_TOKEN` only when `npm run setup:arcgis` reports that missing fields must be bootstrapped

Leave `TARGET_MMSI=247999000` and `ARCGIS_ITEM_ID=fea75f4405ec44e8bf099ab2cb054a33` unless you intentionally need to change them.

### 3. Configure ArcGIS fields automatically

Run this once after filling in `.env`:

```bash
npm run setup:arcgis
```

The script inspects the layer first and does nothing when all required fields already exist. It adds only missing fields: `MMSI`, `VesselName`, `SpeedKnots`, `Course`, `Heading`, `Latitude`, `Longitude`, `LastAIS`, `Destination`, and `NavStatus`.

Use `ARCGIS_TOKEN` as the permanent restricted runtime token. If fields are missing, temporarily set `ARCGIS_ADMIN_TOKEN` to an owner-level token and rerun `npm run setup:arcgis`; the setup script uses that admin token only for the `/arcgis/rest/admin/services/` `addToDefinition` schema request. Remove `ARCGIS_ADMIN_TOKEN` immediately after setup succeeds. Future deployments should then succeed with only `ARCGIS_TOKEN` because the schema already exists.

If you want breadcrumb/history support, create or identify a second point layer in the same hosted feature service, set `ENABLE_HISTORY=true`, set `ARCGIS_HISTORY_LAYER_ID`, and run the setup command again.

### 4. Start the live tracker

```bash
npm start
```

When AISStream sends a position report for MMSI `247999000`, the service updates ArcGIS. If `DATADOCKED_API_KEY` is configured, the service also fetches one Data Docked position immediately at startup so the map can show an initial point before AISStream delivers live data.

### 5. Check service health

Open this in a browser on the machine running the service:

```text
http://localhost:3000/health
```

The health endpoint returns HTTP 200 when the Node service is running. Its JSON reports AIS status separately with `aisConnected`, `aisFresh`, `lastAIS`, and `lastArcGISUpdate`, plus `lastDataDockedAttempt` and `lastDataDockedAccepted` when the optional Data Docked fallback is configured, so Render health checks do not fail just because AIS data is temporarily stale.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AISSTREAM_API_KEY` | Yes | AISStream.io API key. |
| `TARGET_MMSI` | No | Defaults to `247999000`. |
| `ARCGIS_ITEM_ID` | Yes | Existing hosted feature layer item ID. |
| `ARCGIS_TOKEN` | Yes, unless username/password are set | Permanent restricted ArcGIS runtime token used for normal item lookups, feature queries, additions, and updates. |
| `ARCGIS_ADMIN_TOKEN` | No | Temporary owner-level token used only by `npm run setup:arcgis` for `addToDefinition` when required fields are missing. Remove immediately after setup succeeds. |
| `ARCGIS_USERNAME` / `ARCGIS_PASSWORD` | Yes, unless token is set | Used to generate a server-to-server ArcGIS token automatically with `client=requestip`. |
| `ARCGIS_PORTAL_URL` | No | Defaults to `https://www.arcgis.com`. |
| `ARCGIS_CURRENT_LAYER_ID` | No | Defaults to layer `0`. |
| `ENABLE_HISTORY` | No | Set to `true` to add breadcrumb records to a separate layer. |
| `ARCGIS_HISTORY_LAYER_ID` | No | Defaults to layer `1`. |
| `HISTORY_MIN_INTERVAL_SECONDS` | No | Minimum seconds between breadcrumb writes. Defaults to `300`. |
| `PORT` | No | Health endpoint port. Defaults to `3000`. |
| `HEALTH_STALE_AFTER_SECONDS` | No | Health becomes stale after this many seconds without AIS. Defaults to `1800`. |
| `DATADOCKED_API_KEY` | No | Optional Data Docked API key. When absent, the service keeps AISStream-only behavior. |
| `DATADOCKED_BASE_URL` | No | Data Docked vessels operations API base URL. Defaults to `https://datadocked.com/api/vessels_operations`. |
| `DATADOCKED_POLL_INTERVAL_SECONDS` | No | Minimum seconds between Data Docked calls. Defaults to `1800`. |
| `DATADOCKED_AIS_STALE_SECONDS` | No | Data Docked is used after startup only when AISStream has not delivered a fresh position within this many seconds. Defaults to `300`. |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error`. |

## How it works

1. `src/aisstream.js` opens an AISStream WebSocket and subscribes with `FiltersShipMMSI` for only MMSI `247999000`.
2. Incoming AIS messages are parsed into a normalized position record.
3. If `DATADOCKED_API_KEY` is set, `src/datadocked.js` fetches `GET /get-vessel-location?imo_or_mmsi=247999000` immediately at startup, then polls no more often than `DATADOCKED_POLL_INTERVAL_SECONDS` and only accepts fallback positions when AISStream is stale and the Data Docked timestamp is newer than the last AISStream timestamp.
4. `src/arcgis.js` resolves the hosted feature layer URL from the ArcGIS item ID.
5. The service searches for an existing feature with the same MMSI and then updates that feature. If it does not exist, the service creates it once and updates it afterwards.
6. If history is enabled, the service writes breadcrumb points to the configured history layer at a controlled interval.
7. `src/server.js` exposes `/health` for monitoring.

## ArcGIS web map guide

See [docs/arcgis-web-map-guide.md](docs/arcgis-web-map-guide.md) for step-by-step instructions to display the ship, rotate the symbol using `Heading`, configure popups, auto-refresh the map, and optionally show recent track history.

## Deployment notes

- Use a process manager or platform that restarts the service if the process exits.
- Store `.env` values in deployment secrets, not in GitHub. Do not keep `ARCGIS_ADMIN_TOKEN` in deployment secrets after schema bootstrap succeeds; normal deployments should use only `ARCGIS_TOKEN` once the fields exist.
- The WebSocket client includes exponential reconnect logic up to 30 seconds between attempts.
- For continuous 24/7 operation, set `ARCGIS_USERNAME` and `ARCGIS_PASSWORD` so the service can renew ArcGIS tokens automatically. Because this service runs server-side on Render rather than in a browser, generated tokens use ArcGIS `client=requestip` server-to-server authentication instead of a referer-bound browser token. If ArcGIS returns token-expired or invalid-token errors, the service renews the token and safely retries the failed request. A static `ARCGIS_TOKEN` is supported, but automatic renewal requires credentials to be configured too.

## Developer checks

```bash
npm run check
```

## Build 1 voyage history and route layers

The hosted ArcGIS feature service now uses five sublayers while preserving the original current-position workflow:

| Layer | Name | Geometry | Purpose |
| --- | --- | --- | --- |
| 0 | Current Vessel Position | Point | One editable feature for the latest accepted Amerigo Vespucci position. |
| 1 | Vespucci Track History | Point | Deduplicated AIS/Data Docked observation history. |
| 2 | Vespucci Travelled Route | Polyline | One line built only from verified accepted history points, ordered by `LastAIS`. |
| 3 | Vespucci Destination | Point | Configured destination marker, currently Ponta Delgada (`PTPDL`). |
| 4 | Vespucci Estimated Route | Polyline | Two-vertex straight-line estimate from the current position to the configured destination. |

Run `npm run setup:arcgis` after configuring the layer IDs. The script first inspects the feature service and each existing layer. It never recreates Layer 0 and does not duplicate layers that already exist. If Layers 1-4 or required fields are missing, set a temporary owner-level `ARCGIS_ADMIN_TOKEN`, rerun the setup command, confirm success, and immediately remove `ARCGIS_ADMIN_TOKEN` from `.env` and from Render/deployment secrets. Once the layers and fields exist, future deployments only need the normal runtime ArcGIS credentials.

Add these sublayers in ArcGIS Map Viewer by opening the web map, choosing **Add layer from URL** or browsing to the hosted feature layer item, expanding the item, and adding Layers 0 through 4. Style Layer 0 as before. The setup script adds default renderers for small history points, a solid travelled-route line, a prominent destination point, and a dashed estimated-route line when ArcGIS accepts renderer definitions.

### Observed track vs. estimated route

The travelled route is the observed AIS track: it is generated only from accepted, timestamped observations that pass history deduplication. The estimated route is not an official voyage plan. It is labelled `Straight-line estimate` and stores the basis text `Straight-line geographic estimate; not an official navigational route.`

Distance remaining is calculated with a Haversine great-circle approximation and stored in nautical miles. Estimated ETA is calculated only when the reported vessel speed is finite and at least `ETA_MIN_SPEED_KNOTS`: `position timestamp + distanceNM / speedKnots hours`. The service does not use reported AIS destination ETA for this calculated ETA, and `EstimatedETA` is null when speed is missing, invalid, or below the threshold.

Additional configuration variables:

| Variable | Default | Description |
| --- | --- | --- |
| `ARCGIS_TRAVELLED_ROUTE_LAYER_ID` | `2` | Travelled route polyline layer. |
| `ARCGIS_DESTINATION_LAYER_ID` | `3` | Destination point layer. |
| `ARCGIS_ESTIMATED_ROUTE_LAYER_ID` | `4` | Estimated route polyline layer. |
| `ROUTE_MAX_HISTORY_POINTS` | `5000` | Maximum history points used to rebuild the observed route. |
| `ETA_MIN_SPEED_KNOTS` | `1` | Minimum reported speed for ETA calculation. |
| `DESTINATION_NAME` | `Ponta Delgada, Portugal` | Destination marker label. |
| `DESTINATION_PORT_CODE` | `PTPDL` | Destination port code used to upsert the marker. |
| `DESTINATION_LATITUDE` | `37.734722` | Destination latitude. |
| `DESTINATION_LONGITUDE` | `-25.664444` | Destination longitude. |

The `/health` endpoint includes optional-layer status fields: `historyEnabled`, `lastHistoryWrite`, `historyPointCount`, `lastTravelledRouteUpdate`, `lastDestinationUpdate`, `lastEstimatedRouteUpdate`, `distanceRemainingNM`, and `estimatedETA`. It remains HTTP 200 while the main service is running, even if an optional history, destination, or route update temporarily fails.
