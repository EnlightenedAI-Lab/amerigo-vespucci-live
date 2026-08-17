# Montréal Spatial V2 — Command Center Foundation V1

Design status: authorized Tool Builder direct build  
Starting product HEAD: `6f6ee310ef08c4b7c4224dafb978dff3af922af5`  
Archetype: **IQAI Command Center**

## Bound

This milestone adds application contracts and operator surfaces around the
released Spatial V2 ArcGIS subsystem. It does not alter MapView, WebMap,
Ground Controller, Time Engine, imagery providers, remote-sensing
computation, credentials, or Portal content.

The starting worktree contains unrelated tracked and untracked work. This
build changes only the files named in its final handoff and does not clean,
reset, stage, or commit any product work.

## Product composition

```text
ONE MAP
+ ONE ASK IQAI FRONT DOOR
+ CONTEXTUAL CAPABILITIES
+ SOURCE-GROUNDED EXPLANATION
+ NORMAL / EXPERT CONTROL DEPTH
```

The accepted shell geometry remains `rail | map | inspector` with the header
and Ask dock spanning the product. The primary MapView remains the sole map
runtime.

## Contracts applied

### Fail-closed Ask bus

Outcomes are `ROUTED | UNROUTED | UNAVAILABLE | FAILED`.

- Empty input invokes no capability and records `UNROUTED / EMPTY_INPUT`.
- Unknown text records `UNROUTED`; it never defaults to GIS.
- Recognized but unwired capabilities record `UNAVAILABLE`.
- Handler failure records `FAILED`.
- A routed result records the application action actually accepted. It does
  not invent an engine result or AI answer.
- Each submit replaces the durable last-Ask receipt with a monotonic receipt
  identity.

Routing authority is an explicit quick action or an exact declared alias owned
by a registered capability. Regex and a fallback GIS route are prohibited.

### Shared application state

Normal and Expert project one state:

- active capability;
- imagery view (`LATEST | HISTORY | ALL`);
- selected/requested imagery state from the existing Time Engine;
- last Ask receipt;
- one explanation projection.

Changing experience changes control depth only. It must not mutate map,
imagery, evidence, dates, or receipts.

### Operator imagery

Normal mode presents the existing imagery contract as:

- Latest / History / All Imagery;
- requested date;
- selected observation;
- capture and release dates kept separate;
- source;
- resolution/quality when known;
- Previous/Next only when actual observations exist.

Compare, Swipe, Play, and Acquire remain disabled and visibly labelled
`COMING LATER`, `NOT AVAILABLE`, or `ENTITLEMENT REQUIRED`. The existing
`ImageryPanel` remains unchanged as the Expert diagnostic harness.

### Explanation

`WHAT AM I LOOKING AT?` is a receipt/evidence projection with:

- Question;
- IQAI Selected;
- Why;
- What It Shows;
- What It Does Not Prove;
- Source;
- Date;
- Quality;
- Expert Details.

AI is not connected in this milestone. The surface says
`AI EXPLANATION — NOT CONNECTED` and never generates interpretation.

## Failure rules

- F-02: unmatched Ask must not become GIS.
- F-11: UI presence must not paint CONNECTED.
- F-15/F-17/F-19: requested, acquisition, release, online, and vintage clocks
  stay distinct.
- F-18: map presence is not evidence confirmation.
- F-20: source/date selection must not be silent.
- F-21: no permanent scientific control wall.
- No second MapView, popup inspector, Portal save/update, or V1 import.

## ArcGIS boundary

The following remain ArcGIS Master owned and are read-only for this build:

- `public/spatial-v2/map/*`
- `public/spatial-v2/imagery/ground-controller.js`
- `public/spatial-v2/imagery/time-engine.js`
- `public/spatial-v2/imagery/providers/*`
- `src/spatial-v2/*`
- shared WebMap/provider configuration.

Wayback/Nearmap pixel proof remains **PARTIAL**. Engine `READY`, layer
attachment, or map presence must not be presented as pixel proof.

## Acceptance

- Existing 32 Spatial V2 tests remain green.
- Tool Builder tests cover all Ask outcomes, receipt updates, experience
  parity, imagery clock honesty, future-control honesty, explanation headings,
  diagnostic preservation, V1 isolation, and one MapView.
- Live validation covers 1920×1080, 2560×1440, and 3840×2160.
- The map remains dominant, page overflow is absent, Ask is obvious, the
  inspector is readable, and the rail remains usable.
- Empty Ask invokes no capability; unmatched Ask is `UNROUTED`.
- Expert exposes the diagnostic harness without changing truth.
- `/spatial/` remains independent.

No product commit, push, deploy, or Portal write is authorized in this run.
