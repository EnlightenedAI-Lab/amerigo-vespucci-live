# ArcGIS Web Map Configuration Guide

This guide configures a web map for the live Amerigo Vespucci tracker after the Node.js service is updating the hosted feature layer.

## 1. Add the ship layer

1. Open ArcGIS Online and sign in.
2. Open **Map Viewer**.
3. Choose **Add > Browse layers**.
4. Find the hosted feature layer item `fea75f4405ec44e8bf099ab2cb054a33`.
5. Add the current-position layer to the map.

## 2. Display the ship

1. Select the current-position layer.
2. Open **Styles**.
3. Use **Location (single symbol)**.
4. Pick a ship, arrow, triangle, or custom SVG symbol that points north/up by default.
5. Choose a clear color and size that remains visible at world and harbor scales.

## 3. Rotate the symbol by heading

1. With the layer selected, open **Style options**.
2. Find **Rotation by attribute**.
3. Set the rotation field to `Heading`.
4. Use geographic rotation if your symbol points north at 0 degrees.
5. If your symbol artwork points east/right by default, add a 90-degree symbol-angle correction if Map Viewer offers it, or edit the symbol so it points north.

## 4. Configure the popup

Recommended popup title:

```text
{VesselName} ({MMSI})
```

Recommended popup field list:

- `SpeedKnots` as **Speed: {SpeedKnots} kn**
- `Course` as **Course: {Course}°**
- `Heading` as **Heading: {Heading}°**
- `Destination` as **Destination: {Destination}**
- `NavStatus` as **Navigation status: {NavStatus}**
- `LastAIS` as **Last AIS update: {LastAIS}**
- `Latitude` and `Longitude` for troubleshooting

## 5. Automatically refresh

1. Open the current-position layer properties in the map.
2. Enable **Refresh interval**.
3. Set the interval to 30 seconds or 1 minute. AIS messages may not arrive continuously when reception is limited, so faster refreshes are usually unnecessary.
4. Save the web map.

## 6. Optional recent track history

If `ENABLE_HISTORY=true` and a separate history point layer exists:

1. Add the history layer to the same web map.
2. Style it as small semi-transparent dots or a thin track line if you later convert points to lines.
3. Filter the history layer to a recent window such as `LastAIS is within the last 24 hours`.
4. Put the history layer below the current-position layer.
5. Use a longer refresh interval, such as 5 minutes, to reduce map traffic.

## 7. Operational checks

- The ship layer should contain one current feature for MMSI `247999000`.
- The symbol should move as new AIS messages arrive.
- The popup `LastAIS` value should update after live messages are received.
- The service health URL should return HTTP 200 when the Node service is running; check `aisConnected`, `aisFresh`, `lastAIS`, and `lastArcGISUpdate` in the JSON for live data status.
