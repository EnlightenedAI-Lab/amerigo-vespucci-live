# Point Intelligence Visual Proof 1

**Status:** IMPLEMENTED  
**Date:** 2026-08-13  
**Application:** IQAI Spatial / Montréal (`http://localhost:3000/spatial/`)  
**Scope:** Hydrometric registry + hydrometric realtime + SWOB weather only

This record documents the first IQAI Spatial observation-object visualization proof. It does not authorize expanding the visual grammar to other sensor families.

Terminology note from the handler (does not change the accepted audit decision): heatmaps imply a continuous / interpolation-like field; **binning is aggregation, not interpolation**. Binning is still not used here because the current click-radius footprint is tens of stations and station identity is more valuable.

---

## Techniques used

| Concern | Implementation |
| --- | --- |
| Query origin | Runtime GraphicsLayer `iqai-point-intel-click` (unchanged orange cross) |
| Station objects | Runtime client-side FeatureLayer `iqai-point-intel-stations` (ArcGIS Maps SDK 5.1) |
| Selection ring | Runtime GraphicsLayer `iqai-point-intel-selection` (hollow acquisition ring, no pulse) |
| Other families | Existing GraphicsLayer `iqai-point-intel-results` (climate, citypage, AQHI unchanged) |
| Symbols | Static multilayer CIMPointSymbol via UniqueValueRenderer on `rendererKey` |
| Labels | Scale-aware LabelClass, `minScale` 1:45,000, preformatted `primaryDisplay` |
| Hover | View `pointer-move` hitTest, 40 ms debounce, overlay `.pi-station-hover` |
| Click | Existing LIF evidence inspector (`openEvidenceInspectorForObservation`) — no ArcGIS popup |
| Selection effect | FeatureEffect on the PI station layer only; unrelated PI stations `opacity(0.58)` |
| WebMap | Not modified. Layers are runtime-only (`listMode: 'hide'`) |

Station layer is reordered above leftover PI GraphicsLayer markers so SWOB/hydrometric objects are not buried under climate circles.

---

## Station collapse (station ≠ observation)

Asset keys:

- Hydrometric: `hydro:{STATION_NUMBER}`
- SWOB: `swob:{tc_id-value}` (never the native `*-swob.xml` record id)

Live Montréal click (2026-08-13, downtown, 3 km):

- 5 SWOB XML observations for McTavish → **1** object `swob:WTA`
- 5 hydrometric-realtime timestamps for 02OA016 → **1** object `hydro:02OA016`
- 5 other hydrometric registry stations → 5 registry objects (different physical stations)
- Climate daily / hourly / citypage are **not** proof objects

---

## Family symbols

**Hydrometric:** outer precision ring + vertical gauge stem + internal level ticks + small measure bar. Not a droplet, pin, or default circle.

**SWOB weather:** outer ring + square chassis + four-corner registration ticks + internal crosshair. Not a cloud, sun, thermometer, or emoji.

Same engineering language; different instrument geometry. Freshness changes ring weight and chassis opacity only (CURRENT / RECENT / STALE / REGISTRY). No animation.

---

## Primary measurement

- **Hydrometric:** WATER LEVEL (`LEVEL`, metres). Chosen because hydrometric-realtime for Greater Montréal consistently carries stage, while discharge is not always present. Discharge remains in the inspector when the source provides it. Units are never mixed.
- **SWOB:** TEMPERATURE (`air_temp` / `air_temp-value`, °C) when present. Other weather properties are inspector/hover-only.

---

## Freshness (near-real-time only)

| Family | CURRENT | RECENT | STALE |
| --- | --- | --- | --- |
| Hydrometric measurement | age ≤ 30 min | age ≤ 3 h | older |
| SWOB weather | age ≤ 15 min | age ≤ 60 min | older |

Registry-only hydrometric (no live LEVEL/DISCHARGE) uses **REGISTRY** (de-emphasized, not styled as live). Missing timestamps are STALE. Historical climate is not on this renderer.

---

## Interaction

**Hover** shows only values that exist, for example:

- `02OA016` / WATER LEVEL / UPDATED / TREND (when computed)
- `WTA` / TEMPERATURE / UPDATED / WIND (only if direction or speed exists)

No raw API property names. Overlay hides on pointer-leave and when the cursor leaves the feature.

**Click** focuses the existing evidence inspector (Identity / Spatial / Temporal / Values / Provider). Conceptual WHAT / WHERE / WHEN / CURRENT / SOURCE. HISTORY only if the inspector already has real history. No second details panel. No ArcGIS popup.

**Selection** is a thin light acquisition ring plus FeatureEffect. Not neon, not pulsing.

---

## Trend

Implemented for **hydrometric LEVEL** when the bundle contains ≥2 chronological same-property samples.

Live 02OA016 example: start 1.298 m at 18:55Z, end 1.29 m at 19:15Z, window 20 min, delta −0.008 m.

SWOB minute samples exist (≈4 min window) but are **not** shown as a glance trend: a four-minute 0.2 °C change would imply a misleading °C/h rate. Weather trend is deferred.

---

## Quality

Deferred. Provider PASS / NO DATA / UNAVAILABLE is not observation quality. No quality glyph is invented.

---

## Legend

Compact PI legend in the LIF map toolbar when proof families have evidence:

Hydrometric station · SWOB weather station · Current · Recent · Stale · Selected

---

## Performance (live downtown click)

| Metric | Observation |
| --- | --- |
| Bundle | PARTIAL_RESULTS, ~0.4–1.8 s (MSC GeoMet fallback; AQHI NO DATA) |
| Feature count | 7 station objects (from 10 hydro + 5 SWOB raw rows) |
| Renderer | `esri.renderers.UniqueValueRenderer` |
| Hover | 40 ms debounce, no render loop |
| PI OFF | click/result/station features clear to 0 |

No timers constantly redraw features. No CIM animation.

---

## Visual QA

Inspected on the live product (`http://localhost:3000/spatial/`) with ArcGIS preauth. Screenshots: `artifacts/pi-visual-proof-1/` (local, gitignored).

| Case | Result |
| --- | --- |
| Regional Montréal | Objects visible, restrained; labels off |
| Local neighbourhood | Engineered marks readable |
| Station scale | Hydro gauge + `1.29 m`; SWOB crosshair chassis |
| Multiple stations | 7 objects, no stacked timestamps |
| Selected hydro / SWOB | Acquisition ring + evidence inspector |
| Registry de-emphasis | Registry-only hydro not styled as live |
| Hover | Compact reading; hides cleanly |
| PI OFF | Map restored; no PI markers |
| Shell | Header, rails, MAP COMMAND, AI MAP unchanged |

---

## Known limitations

- Climate daily/hourly and citypage remain on the previous GraphicsLayer path (authorized leftover).
- At very small regional scales CIM objects read as small marks; that is intended restraint, not clustering.
- Source quality flags are still not first-class; quality is not drawn.
- SWOB glance trend is deferred.
- Existing inspector headings are Identity / Spatial / Temporal / Values / Source (not relabeled WHAT/WHERE/WHEN).
- Client-side FeatureLayer fields are created at first load in a session; a hard refresh picks up schema changes.

---

## Files

- `public/spatial/point-intelligence-station-model.js`
- `public/spatial/point-intelligence-station-symbols.js`
- `public/spatial/point-intelligence-station-layer.js`
- `public/spatial/point-intelligence-layer.js`
- `public/spatial/point-intelligence-presentation.js`
- `public/spatial/point-intelligence-focus-controller.js`
- `public/spatial/iqai-spatial-shell.css`
- `test/a1-point-intelligence-station-model.test.js`
- `scripts/pi-visual-proof-1.mjs`
