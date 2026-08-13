# Point Intelligence — Advanced Visualization Audit

**Status:** LEARNING / PLATFORM AUDIT ONLY  
**Date:** 2026-08-13  
**Application:** IQAI Spatial / Montréal (`http://localhost:3000/spatial/`)  
**SDK:** ArcGIS Maps SDK for JavaScript **5.1** (CDN `https://js.arcgis.com/5.1/`, June 2026)  
**Product changes in this milestone:** NONE

This document inspects the live Montréal Spatial implementation, then screens official Esri 5.1 capabilities against Point Intelligence data meaning. It does not authorize implementation.

---

## 1. Inspected application architecture

Inspected in this worktree. Not assumed from memory.

### 1.1 Installed ArcGIS version

| Fact | Evidence |
| --- | --- |
| Runtime | CDN, not npm `@arcgis/core` |
| Version | **5.1** |
| Load | `public/spatial/index.html` + `public/spatial/spatial-arcgis-runtime.js` (`ARCGIS_CDN_URL = 'https://js.arcgis.com/5.1/'`) |
| Import | `$arcgis.import('@arcgis/core/...')` |
| Confirmed | `src/spatial/orchestrator/esri-ai-feasibility.js` records the same 5.1 CDN runtime |

`package.json` does **not** pin `@arcgis/core`. The live product is the CDN Maps SDK.

### 1.2 Application architecture

Montréal Spatial is a single-page ArcGIS shell:

- One `WebMap` (Montréal operational item) + one `MapView`
- WebMap operational layers (city GIS) + runtime IQAI layers (`iqai-*`)
- Point Intelligence is a click-radius **bundle query**, not a persistent province-wide sensor network
- Results render in two runtime `GraphicsLayer`s and a right-rail Location Intelligence Focus (LIF) panel

### 1.3 MapView / SceneView

| Item | Current state |
| --- | --- |
| MapView | Yes — `new MapView({ container, map: webMap })` in `spatial-arcgis-runtime.js` |
| SceneView | **Not used** in the Spatial product runtime |
| Constraints | No PI-specific scale constraints |
| Resize | SDK 5.x auto-detects container size (`View.resize()` removed) |

Intelligence Lab (`public/spatial/intelligence-lab/`) is a separate MapView + TimeSlider sandbox. It is **not** the Point Intelligence product path.

### 1.4 Layer architecture

| Layer class | Where used | Point Intelligence? |
| --- | --- | --- |
| WebMap FeatureLayers | Montréal operational GIS | No |
| `GraphicsLayer` | PI click marker + PI evidence | **Yes — exclusive PI map path** |
| Client-side `FeatureLayer` (`source: []`) | Live aircraft | Precedent exists, **not used by PI** |
| `GeoJSONLayer` | SPVM crime | No |
| `GroupLayer` | Aircraft / outages | No |

PI layers:

- `iqai-point-intel-click` — orange cross at clicked point
- `iqai-point-intel-results` — family-colored circles; `popupEnabled: false`; `listMode: 'hide'`

### 1.5 Point Intelligence architecture

```
Map click (PI ON)
  → POST /api/spatial/point-intelligence/query-bundle
  → Agent 5 broker OR MSC GeoMet fallback (parallel per family)
  → adaptBundleResponse (families keyed independently)
  → LIF panel + deterministic prose summary
  → map thinning model → GraphicsLayer markers
```

Click contract (`spatial-map-command.js`):

1. If an existing PI evidence graphic is hit → focus inspector (does not start a new query)
2. Else if PI mode ON → capture WGS84 lat/lon → run bundle query
3. Else → normal ArcGIS `fetchPopupFeatures` / feature selection

There is **no** `pointer-move` hover path for Point Intelligence.

### 1.6 Observation families (verified)

| Family | MSC collection | Kind | Temporal class |
| --- | --- | --- | --- |
| `weather` | `swob-realtime` | DIRECT_MEASUREMENT | NEAR_REAL_TIME |
| `weather-current` | `citypageweather-realtime` | DIRECT_MEASUREMENT | NEAR_REAL_TIME |
| `climate` | `climate-daily` | CLIMATE_DAILY_RECORD | HISTORICAL |
| `climate-hourly` | `climate-hourly` | DIRECT_MEASUREMENT | RECENT |
| `air-quality` | `aqhi-observations-realtime` | DIRECT_MEASUREMENT | NEAR_REAL_TIME |
| `hydrometric` | `hydrometric-stations` | STATION_REGISTRY | STATIC |
| `hydrometric-measurement` | `hydrometric-realtime` | DIRECT_MEASUREMENT | NEAR_REAL_TIME |

UI groups these into Weather / Current Weather / Climate / Air Quality / Hydrometric.

### 1.7 Station vs observation (already partly modelled)

`point-intelligence-map-presentation.js` already groups spatial results by **authoritative asset key**:

`STATION_NUMBER | IDENTIFIER | CLIMATE_IDENTIFIER | station_id | location_id | geometry`

One map marker can represent multiple observation IDs (`observationIds` joined on the graphic).

This is the correct architectural seed:

- **Station / place** owns persistent geometry
- **Observation** owns measurement, time, freshness, quality, provenance

Current gap: the marker still looks like “another colored dot.” History, trend, freshness, and quality are panel-only.

### 1.8 Station schema (as returned today)

Not a single table. Identity is reconstructed from MSC properties + IQAI envelope:

| Family | Station identity fields observed in code |
| --- | --- |
| Hydrometric | `STATION_NUMBER`, `STATION_NAME`, waterbody (`WATERBODY_EN` / `WATERBODY_FR`) |
| Climate / hourly | `CLIMATE_IDENTIFIER`, `STATION_NAME` |
| SWOB weather | `stn_nam` / `stn_nam-value`, native SWOB record id |
| Citypage | `name.en`, ident (`qc-147`), citypage point |
| AQHI | station/location properties when present (often no nearby feature in Greater Montréal) |

Station coordinates come from feature geometry (or first vertex of nested coordinates). Distance is haversine from **clicked point**, not implied coincidence.

### 1.9 Observation schema (IQAI envelope)

Each result typically carries:

- `resultId`, `nativeRecordId`, `nativeCollectionId`
- `providerName` (`MSC GeoMet`), `protocolFamily` (`OGC_API`)
- `resultKind`, `temporalClassification`
- `geometry`, `clickDistanceMeters`
- `observation`: `{ property, value, unit, observedAt }`
- `temporal`: family-specific timestamp keys
- `properties`: raw MSC attributes (not fabricated)
- `provenance`: provider, dataset, source URL, clicked lat/lon, station lat/lon, distance, retrieval timestamp, observation timestamp
- `retrievedAt`

Quality/status flags exist in some MSC payloads (e.g. climate `*_FLAG`, citypage `qaValue`) but are **not first-class IQAI observation fields** today.

### 1.10 Time fields

| Family | Time fields used |
| --- | --- |
| weather | `date_tm-value` |
| weather-current | `currentConditions.timestamp`, `lastUpdated` |
| climate | `LOCAL_DATE`, `CLIMATE_DATE` |
| climate-hourly | `LOCAL_DATE`, `UTC_DATE` |
| air-quality | `observation_datetime` |
| hydrometric registry | `STATION_FIRST_DATE` (record start, not a live observation) |
| hydrometric-measurement | `DATETIME`, `DATETIME_LST` |

Product temporal modes (`point-intelligence-temporal-support.js`):

- `LATEST` — **SUPPORTED_NOW** (only executable mode)
- `AT` / `RANGE` — **FUTURE_READY** (Time Lens UI exists; execution is gated)

There is **no** ArcGIS `timeInfo` / `view.timeExtent` / TimeSlider on PI layers.

### 1.11 Measurements and units

| Family | Primary measurements (when present) | Units |
| --- | --- | --- |
| weather | air temperature; wind speed/direction; humidity; pressure from SWOB properties | °C, km/h, °, %, hPa |
| weather-current | temperature | °C |
| climate | MEAN / MIN / MAX temperature, precipitation | °C, mm — **historical daily**, not live |
| climate-hourly | TEMP | °C |
| air-quality | AQHI | AQHI index (not µg/m³) |
| hydrometric-measurement | LEVEL and/or DISCHARGE | m, m³/s |
| hydrometric registry | none (station metadata only) | — |

Do not mix these into a generic “intensity.”

### 1.12 Quality / status

Independent **family operator statuses** already exist: PASS / NO DATA / UNAVAILABLE / TIMEOUT / ERROR.

Source quality flags are not yet a visualization dimension. Missing value ≠ unavailable sensor ≠ provider error. Those three must remain distinct.

### 1.13 Provenance

Retained per observation: provider, dataset/collection, station id, observation time, retrieval time, clicked coordinates, station coordinates, distance, source URL.

### 1.14 Refresh behavior

Query-on-click snapshot. No PI layer refresh interval. `retrievedAt` is the knowledge time. Stale must be computed from observation time vs retrieval time, not from map animation.

### 1.15 Current map rendering

Family-colored `SimpleMarkerSymbol` circles:

- size 10 default / 14 emphasized / 8 deemphasized
- alpha 0.82 / 1.0 / 0.28
- white outline; thicker when focused

Click location: orange `cross` marker.

Thinning: 1 representative asset per family by default; up to 3 when spatial count is small or a family is focused. Multiple observations at one station collapse to one marker.

### 1.16 Hover / hitTest

- `view.hitTest` is used on **click** against `iqai-point-intel-results`
- No PI hover card / pointer-move handler
- Intelligence Lab has a hover card pattern; PI does not reuse it

### 1.17 Popup / inspector

PI layers disable ArcGIS popups. Click-to-inspect uses the LIF evidence inspector:

- WHAT / WHERE / WHEN / values / provider / source trace
- Technical JSON behind a disclosure
- No sparkline / trend series yet (bundle returns ≤5 latest features per family, not a station time series)

### 1.18 Scale-dependent behavior

None in ArcGIS (`minScale`/`maxScale` unused on PI layers). Thinning is application logic, not scale. SPVM/OSM clustering is a **different** product surface.

### 1.19 Clustering / binning already used?

| Surface | Clustering | Binning |
| --- | --- | --- |
| Point Intelligence | **No** | **No** |
| SPVM crime | Yes (`featureReduction.type = 'cluster'`) + optional heatmap | No |
| OSM amenities | Yes | No |
| Aircraft | No (rotation UniqueValue + picture marker) | No |

### 1.20 Station-vs-observation — current honesty gap

Hydrometric registry and hydrometric-measurement can plot as **two nearby dots** for related water context if they do not share the same station id in the thinning key. Climate daily vs hourly can do the same at McTavish.

Visualization must treat those as **one station object with multiple observation channels**, not two independent geographic events.

---

## 2. Official Esri sources reviewed (5.1)

Primary:

- [Release notes 5.1](https://developers.arcgis.com/javascript/latest/release-notes/) (June 2026)
- [FeatureLayer](https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/)
- [CIMSymbol](https://developers.arcgis.com/javascript/latest/references/core/symbols/CIMSymbol/)
- [FeatureEffect](https://developers.arcgis.com/javascript/latest/references/core/layers/support/FeatureEffect/)
- [TimeSlider](https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-TimeSlider.html)
- [Clustering guide](https://developers.arcgis.com/javascript/latest/visualization/high-density-data/clustering/)

In-product precedents (not Esri docs, but relevant platform usage):

- Client-side FeatureLayer + rotation visual variable: `aircraft-live.js` / `aircraft-live-symbols.js`
- Clustering + heatmap: `spvm-crime-render.js`
- TimeSlider + FeatureEffect: Intelligence Lab only

---

## 3. Architectural constraint that governs every technique

**GraphicsLayer cannot use** FeatureLayer-only capabilities:

- `renderer` + `visualVariables` as a layer contract
- `featureReduction` (cluster / bin)
- `featureEffect` / `FeatureFilter`
- `timeInfo` bound to `view.timeExtent`
- native Legend from renderer
- `FeatureLayerView.highlight()` in the FeatureLayer sense

GraphicsLayer **can** use:

- Per-graphic `CIMSymbol` / `SimpleMarkerSymbol`
- `view.hitTest`
- Manual emphasize/deemphasize (already done)
- Custom HTML overlay for hover

IQAI already has a client-side FeatureLayer pattern (aircraft). Migrating PI evidence to a **client-side FeatureLayer of stations** (not a FeatureLayer of raw observation rows) is the platform prerequisite for most high-value techniques.

Do **not** put one graphic per timestamp. Put one feature per station/place. Observation history lives in attributes + inspector.

---

## 4. Technique audit

For each technique: Esri support → IQAI meaning → decision.

### 4.1 CIMSymbol (multilayer)

**Official:** [CIMSymbol](https://developers.arcgis.com/javascript/latest/references/core/symbols/CIMSymbol/) — since 4.12; animations since 4.31; `CIMSymbolAnimationMoveAlongLine` beta in 5.1.  
**SDK support:** Yes on MapView graphics and FeatureLayer. Not everything in the CIM spec is implemented. Primitive overrides + Arcade. Legend does not support primitive overrides or animations.  
**What it does:** Vector multilayer point objects (rings, markers, strokes) with attribute-driven overrides.  
**IQAI families:** All station/place families.  
**Use:** Encode family in geometry language; measurement as an inner element; freshness as an outer ring.  
**Visual value:** High — this is the path off “dots.”  
**Semantic risk:** Over-encoding; cartoon pictograms; animating stationary sensors as motion.  
**Performance:** Fine at PI click-query counts (tens of stations). Poor if thousands of unique animated CIM symbols.  
**Complexity:** Medium–high (symbol grammar + overrides).  
**Decision: USE NOW** (static multilayer objects). Animations: REJECT as default.

### 4.2 CIM symbol effects / animations

**Official:** CIMSymbol animations; 5.1 line-follow animation is for **movement along lines**.  
**SDK support:** 2D only; not in Legend.  
**IQAI use:** Esri itself suggests animations for freshness — but pulsing a hydrometric station implies a trajectory or alarm.  
**Semantic risk:** Stationary sensors must not look like tracks. Line-follow animation has no PI geometry.  
**Decision: REJECT** as product default. Optional later: one-shot, selection-only, non-looping emphasis. Never on the whole network.

### 4.3 VisualVariables — color

**Official:** FeatureLayer renderer visual variables.  
**IQAI use:** Color = **sensor family / channel**, not magnitude, unless a single-family quantitative map is explicitly in view (e.g. AQHI-only).  
**Semantic risk:** Color-as-intensity across mixed units.  
**Decision: USE NOW** for family identity. Quantitative color: USE LATER, family-isolated.

### 4.4 VisualVariables — size

**Official:** Size visual variable.  
**IQAI use:** Size ≠ importance. Water level in metres and AQHI and °C are incomparable. Cluster count size is a different (aggregate) meaning.  
**Decision: REJECT** for mixed-family PI. USE LATER only inside a single-family quantitative mode with a documented scale.

### 4.5 VisualVariables — opacity

**Official:** Opacity visual variable / CIM transparency override.  
**IQAI use:** Freshness decay for NEAR_REAL_TIME families only. Historical climate must not “fade like a dead sensor.” Registry stations are STATIC — opacity is identity, not age.  
**Decision: USE NOW** with family-specific freshness rules.

### 4.6 VisualVariables — rotation

**Official:** Rotation visual variable. In-app precedent: aircraft `headingDegrees` geographic rotation.  
**IQAI use:** Only when a **measured direction** exists (SWOB `wind_dir_10_min-value` / `wind_dir-value`). Hydrometric, climate, AQHI, citypage temperature have no direction.  
**Decision: USE LATER** as an optional inner wind barb/vane on SWOB only. Never rotate the whole station object.

### 4.7 FeatureEffect / FeatureFilter

**Official:** [FeatureEffect](https://developers.arcgis.com/javascript/latest/references/core/layers/support/FeatureEffect/) — 2D MapView; CSS-like `bloom`, `drop-shadow`, `opacity`, `grayscale`, etc. **Not** supported with clustering enabled; **not** in SceneView.  
**IQAI use:** Selected station crisp; related channels readable; unrelated stations slightly de-emphasized.  
**Semantic risk:** Darkening the whole Montréal GIS map; bloom-as-default “live.”  
**Performance:** Good at PI counts; requires FeatureLayer.  
**Decision: USE NOW** after client-side FeatureLayer. Excluded effect must be restrained (`opacity` / slight `grayscale`), not a blackout.

### 4.8 LayerView.highlight / View.highlights

**Official:** FeatureLayer highlight on click/popup; `highlight()` on layer view. 5.x also documents view-level highlight collections.  
**IQAI use:** Acquisition ring for selected station; keep custom inspector (do not re-enable ArcGIS popup as the evidence UI).  
**Decision: USE NOW** (selection). Do not rely on default popup highlight as the product language.

### 4.9 hitTest

**Official:** MapView.hitTest. Already used.  
**IQAI use:** Click focus exists. Hover micro-reading does not.  
**Decision: USE NOW** — add `pointer-move` + hitTest → HTML micro-reading. Do not dump raw field names.

### 4.10 reactiveUtils

**Official:** `@arcgis/core/core/reactiveUtils.js`. Already used for map scale/extent watches in `spatial-map-command.js`.  
**IQAI use:** Watch scale for label density; watch pointer for hover; watch timeExtent later.  
**Decision: USE NOW** (hover + scale hooks). Not a visual language by itself.

### 4.11 Scale-aware labels

**Official:** `labelingInfo` + `minScale`/`maxScale`; CIM `minScale`/`maxScale`; 5.1 `alternateSymbols` on UniqueValue/ClassBreaks for scale-based CIM.  
**IQAI use:** Local: station name + current measurement. Region: family tick only. Province: labels off.  
**Decision: USE LATER** for a persistent network. For click-radius PI (typically <20 markers), a single local label style is enough in the first proof.

### 4.12 Arcade

**Official:** Label expressions, renderer expressions, CIM primitive overrides.  
**IQAI use:** Freshness class, measurement text, cluster summaries.  
**Semantic risk:** Arcade that interpolates or invents trend.  
**Decision: USE NOW** for deterministic labels/overrides from attributes already on the feature.

### 4.13 Clustering (`featureReduction: cluster`)

**Official:** [Clustering](https://developers.arcgis.com/javascript/latest/visualization/high-density-data/clustering/) — FeatureLayer, MapView; `cluster_count`; renderer-aware summaries; pie-chart clusters; aggregate fields. **Incompatible with FeatureEffect.**  
**IQAI use:** Only if a **network** of stations is shown at region/province scale. Current PI is a **local query footprint**. Clustering 12 McTavish/LaSalle dots is worse than thinning.  
**Semantic risk:** “37” bubble that hides mixed families/units; pie charts that look like composition of one phenomenon.  
**Decision: USE LATER** — network scale only, with family counts + latest update, never a single intensity number.

### 4.14 Binning

**Official:** `featureReduction.type = 'binning'` — map-space polygons.  
**IQAI use:** Bins imply a spatial field. Sensor stations are discrete instruments.  
**Decision: REJECT** for Point Intelligence stations. (SPVM density is a different phenomenon.)

### 4.15 Cluster summary / aggregate fields / cluster popups

**Official:** `cluster_count`, custom aggregate fields, cluster popupTemplate, pieChart clustering helper.  
**IQAI use:** If clustering is enabled later: `n stations`, family mix, `max(freshness)`, not mean(temperature+level).  
**Decision: USE LATER** with clustering. Cluster UI should stay IQAI inspector-style, not Esri field-name popups.

### 4.16 Time-aware FeatureLayer / timeInfo / timeExtent / TimeSlider

**Official:** Layer `timeInfo`; `view.timeExtent`; [TimeSlider](https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-TimeSlider.html). Client-side layers can use FeatureFilter.timeExtent **or** view.timeExtent — not both carelessly (Esri warning: excluded features vanish).  
**IQAI use:** AT/RANGE are not executable. Replay of a **station’s measurements** is an inspector series, not a moving point.  
**Decision: USE LATER** when historical query is real. Do not bind TimeSlider to PI until Agent 5/MSC can return AT/RANGE. Do not fake tracks.

### 4.17 Temporal filtering / fading

**Official:** FeatureFilter.timeExtent + FeatureEffect excluded grayscale/opacity (Esri TimeSlider filter sample).  
**IQAI use:** CURRENT vs RECENT vs STALE on live families; HISTORICAL climate as a distinct class, not a faded live sensor.  
**Decision: USE NOW** as **attribute-driven** freshness classes (no TimeSlider). TimeExtent filtering: USE LATER.

### 4.18 Charts / custom inspection

**Official:** ArcGIS Charts components exist in 5.1 (many 5.1 deprecations around chart config). IQAI already has a custom inspector.  
**IQAI use:** Sparkline of a **single station, single quantity** when a real series exists. Bundle `limit=5` is not a hydrograph.  
**Decision: USE LATER** after a station-history query. First proof: inspector values + timestamps, no fake series.

### 4.19 Layer / view effects (bloom, contrast, brightness, grayscale, drop-shadow)

**Official:** FeatureEffect / layer `effect`.  
**IQAI use:** Selected: restrained drop-shadow or crisp outline. Stale: opacity/grayscale. Live: **no** bloom-all.  
**Decision: USE NOW** only as FeatureEffect on selected/unrelated. **REJECT** bloom/brightness as a global PI look.

### 4.20 blendMode

**Official:** Layer blend modes.  
**IQAI use:** Easy to destroy cartographic honesty of the Montréal basemap.  
**Decision: REJECT** for PI.

### 4.21 DictionaryRenderer

**Official:** Dictionary of CIM symbols keyed by attributes (utilities/defense).  
**IQAI use:** Could later catalog family objects. Premature vs a small explicit CIM grammar.  
**Decision: USE LATER** if the family set grows into a true symbol dictionary.

### 4.22 UniqueValueRenderer

**Official:** Category renderer; 5.1 `alternateSymbols` for scale. In-app: aircraft unique values + rotation.  
**IQAI use:** Family / channel identity.  
**Decision: USE NOW** (or CIM unique-by-family, same idea).

### 4.23 ClassBreaksRenderer / continuous renderers

**Official:** Numeric class breaks / color ramps.  
**IQAI use:** AQHI classes or water-level classes **within one family**. Never a cross-family ramp.  
**Decision: USE LATER** in single-family focus mode only.

### 4.24 3D / SceneView

**Official:** SceneView; FeatureEffect unsupported; CIM line/polygon limited.  
**IQAI use:** Aircraft altitude is the only current in-app vertical signal — and it is a different module. Hydrometric level is **not** extrusion height. Climate is not a 3D volume.  
**Decision: REJECT** for Point Intelligence station objects. Revisit only for genuine altitude/atmospheric vertical profiles.

### 4.25 FlowRenderer

**Official:** Vector-field / raster flow.  
**IQAI use:** No vector field in MSC station points. Wind at a station is a single direction, not flow.  
**Decision: REJECT.**

### 4.26 Heatmap (`featureReduction` heatmap)

**Official:** Used by SPVM density mode.  
**IQAI use:** Heatmap interpolates event density. Stations are instruments, not a continuous field.  
**Decision: REJECT** for PI.

### 4.27 Modern ArcGIS components / popups

**Official:** 5.1 deprecates several MapView popup helpers in favor of map/scene **web components** (`fetchPopupFeatures` on components). IQAI Spatial is **Core API MapView**, not `arcgis-map`. Feasibility note already records this.  
**IQAI use:** Keep custom LIF inspector. Do not migrate PI onto Esri popup chrome.  
**Decision: REJECT** Esri popup as the evidence UI. USE NOW: custom inspector + hover overlay.

### 4.28 Client-side FeatureLayer (prerequisite)

**Official:** `FeatureLayer({ source, fields, objectIdField, geometryType })`.  
**IQAI use:** One feature per station/place; attributes hold latest measurement, times, family, freshness class, observation id list.  
**Decision: USE NOW** as the implementation substrate for renderer/effect/legend. First proof may still CIM-on-GraphicsLayer if scope must stay tiny — but FeatureLayer is the durable path (already proven by aircraft).

---

## 5. Ranked techniques (only the strongest)

Select **seven**. Not everything.

### 1. Station-object CIMSymbol (multilayer, static)

**Why:** Replaces dots with an engineered observation object.  
**Data:** Hydrometric, SWOB, citypage, climate, AQHI.  
**Understanding:** User sees *instrument family*, not a pin.  
**Rule:** Geometry = family. Do not encode every dimension. No emoji, no giant weather icons.

### 2. Client-side FeatureLayer of stations (not observations)

**Why:** Unlocks renderer, legend, FeatureEffect, later clustering/time.  
**Data:** All PI families, collapsed by station id.  
**Understanding:** Persistent place vs time-varying measurement.  
**Rule:** One feature per station. Observation history is attributes/inspector, never stacked points.

### 3. UniqueValue (family/channel) + opacity/freshness class

**Why:** Identity + time honesty without quantitative lying.  
**Data:** Freshness only for NEAR_REAL_TIME; climate stays HISTORICAL; registry stays STATIC.  
**Understanding:** Live vs recent vs stale vs historical at a glance.  
**Rule:** Do not fade climate as a dead sensor. Do not mix units into opacity.

### 4. hitTest + reactiveUtils hover micro-reading

**Why:** Immediate intelligence without opening the drawer.  
**Data:** Station id, one measurement+unit, age, family.  
**Understanding:** “What is this object?” in <1s.  
**Rule:** Human labels only. No raw MSC keys. No invented trend.

### 5. FeatureEffect + highlight for selection / related context

**Why:** Acquisition without blacking out Montréal.  
**Data:** Selected station vs other PI stations (not the whole WebMap).  
**Understanding:** Focus vs context.  
**Rule:** Effect applies to the PI layer, not city GIS. No bloom-all. FeatureEffect off if clustering is on.

### 6. Arcade labels (local scale)

**Why:** Measurement on the map when there are few stations.  
**Data:** Latest value+unit for the representative channel.  
**Understanding:** Map readable without the panel.  
**Rule:** One quantity per object. Hide labels when markers collide.

### 7. Custom evidence inspector (keep, extend later)

**Why:** Click is already the right full-reading surface.  
**Data:** Provenance, times, distances, values.  
**Understanding:** Audit-grade evidence.  
**Rule:** Trend/sparkline only from a real station series. Do not switch to Esri popups.

---

## 6. Proposed IQAI visual grammar

Related across families. Aerospace / instrumentation / cartography. Not pins.

| State | Visual intent |
| --- | --- |
| **Station** | Precise registration object: small geometric chassis + family glyph (CIM). Persistent even if latest measurement is missing. |
| **Live observation** | Inner measurement mark at full opacity. Outer ring “fresh” (age below family SLA, e.g. SWOB minutes, hydro <1–2 h). No pulse. |
| **Recent observation** | Same object; ring thinner / slightly lower opacity. Still clearly an instrument, not a ghost. |
| **Stale observation** | Reduced opacity; ring broken or dim. Still selectable. Never looks “off the network” unless UNAVAILABLE. |
| **Historical** | Distinct climate mark (e.g. square/hash chassis). Label “daily / hourly record” — not a live LED. |
| **Selected** | Acquisition ring (white/thin CIM stroke or highlight). Related channels at same station stay crisp. |
| **Alert** | Reserved for **source-backed** quality/threshold flags only. Do not invent alerts from color ramps. |
| **Aggregate** | Later, region scale: compact cluster with count + family ticks. Never a heatmap blob. |
| **Missing value** | Station chassis present; inner mark empty. Honest “no measurement in this snapshot.” |
| **Unavailable** | Chassis + muted hatch; operator status UNAVAILABLE/TIMEOUT. Not the same as NO DATA. |
| **Quality flagged** | Micro-indicator only if MSC/IQAI exposes a flag. Otherwise omit. |
| **Multi-sensor location** | One chassis, stacked channel ticks (hydro level + discharge; climate daily + hourly). One geometry. |

Wind: directional inner mark **only** if `wind_dir_*` is present on that observation.

---

## 7. Scale strategy

Today PI is a **click radius** (3–25 km family-dependent), typically handfuls of stations. Do not build province clustering for that.

| Scale | Experience |
| --- | --- |
| **Province** | Only if a future persistent network layer exists → cluster/aggregate. Not current PI. |
| **Region** | If many stations in footprint → thin to nearest-per-family (already exists) or light clustering. |
| **Local** | Engineered station objects + optional one-line labels. |
| **Point** | Selected station: inspector + measurement/time. No extra dots for timestamps. |

---

## 8. Time strategy

| State | How to represent |
| --- | --- |
| **Current** | Latest observation age within family SLA; full opacity. |
| **Recent** | Age beyond SLA but still the latest available; reduced ring. |
| **Stale** | Latest observation old relative to retrieval; de-emphasize. |
| **Historical** | Climate daily/hourly class — different object language. |
| **Replay** | Inspector series or future TimeSlider on a **history table**, never moving the station. |

Time Lens AT/RANGE remains UI-only until the query pipeline executes those modes.

---

## 9. Interaction strategy

| Action | Behavior |
| --- | --- |
| **Hover** | Micro-reading overlay (station, value+unit, age). No map pan. |
| **Click (empty map, PI ON)** | New bundle query (unchanged contract). |
| **Click (PI marker)** | Select station object; LIF inspector; do not requery. |
| **Selection** | Highlight + FeatureEffect on PI layer only. |
| **Related context** | Other channels at same `assetKey` stay emphasized. |
| **Evidence inspector** | WHAT / WHERE / WHEN / CURRENT / SOURCE / QUALITY (if any) / HISTORY when real. |

PI OFF: existing ArcGIS feature picking unchanged.

---

## 10. Performance

| Constraint | Assessment |
| --- | --- |
| Current feature count | ~5–35 graphics per click. CIM + hover is cheap. |
| Threshold for aggregation | Roughly >80 overlapping station features in view. Not today’s query. |
| Refresh | Snapshot; no 1 Hz redraw. Re-query is user-initiated. |
| GPU | Avoid animated CIM on every station. Avoid bloom. |
| Mobile | Keep hitTest hover with a click fallback (no hover on touch). |
| Clustering vs FeatureEffect | Mutually exclusive per Esri. Choose effect for local proof; clustering later at network scale. |

---

## 11. Proposed first proof (DO NOT BUILD IN THIS MILESTONE)

**Data families:** Hydrometric (registry + measurement collapsed to one station object) + Weather (SWOB). Optional: climate-hourly as HISTORICAL/RECENT companion at the same climate id — only if identity matches.

**Why:** Real geometry, real units, real timestamps, two families, freshness vs historical distinction, water vs atmosphere.

**Techniques:**

1. CIM multilayer station objects (hydro vs weather)
2. Collapse measurement rows onto station geometry
3. Freshness class → opacity/ring
4. Hover micro-reading
5. Click → existing inspector (no Esri popup)
6. Selection highlight + restrained FeatureEffect **if** evidence is a client-side FeatureLayer; else symbol-swap (already in code)
7. Premium legend: family objects + freshness states (not a color ramp of mixed units)

**Out of scope for the proof:** clustering, TimeSlider, SceneView, wind rotation, AQHI (often NO DATA in Montréal), bloom, charts.

**Acceptance criteria:**

- One hydrometric station is one map object even if registry + realtime both returned
- McTavish (or equivalent) is one weather object, not five stacked SWOB dots
- Hover shows station name, value+unit, age, distance — no raw keys
- Click still opens LIF inspector with provenance
- Stale vs live is visible without animation
- Climate, if shown, cannot be mistaken for live SWOB
- PI OFF map picking unchanged
- No Visual redesign of the IQAI shell

---

## 12. Decision rollup

### USE NOW

1. CIMSymbol multilayer station objects (static)
2. Station-not-observation FeatureLayer (or GraphicsLayer CIM for a thinner first proof)
3. UniqueValue / family identity
4. Opacity / ring freshness classes (live families only)
5. hitTest + pointer-move hover micro-reading
6. Selection highlight + restrained FeatureEffect (PI layer only)
7. Arcade labels at local scale
8. Keep custom evidence inspector

### USE LATER

- Clustering + aggregate fields + intelligent cluster summary (persistent network / high count)
- Scale-based `alternateSymbols` / label density
- TimeSlider + timeInfo when AT/RANGE queries exist
- Rotation for SWOB wind direction only
- ClassBreaks for single-family quantitative mode (AQHI or water level)
- Inspector sparkline from a real station history query
- DictionaryRenderer if the object catalog grows
- Restrained selection-only (non-looping) CIM animation

### REJECT

| Technique | Reason |
| --- | --- |
| FlowRenderer | No vector field |
| Heatmap / binning | Interpolates discrete instruments into a false continuous field |
| Size visual variable across families | Incompatible units / false magnitude |
| SceneView as PI default | No legitimate vertical structure for these families |
| Bloom / brightness / blendMode as look | Video-game live; destroys basemap honesty |
| CIM motion / line-follow animation | Stations are not trajectories |
| Esri popup as evidence UI | Raw fields; fights LIF inspector |
| Relationship / pie-cluster as causality | Proximity ≠ operational dependency |
| Color ramp mixing °C, m, AQHI | False intensity |
| Duplicate points per timestamp | Violates station ≠ observation |

---

## 13. Product changes

NONE. Training milestone only.
