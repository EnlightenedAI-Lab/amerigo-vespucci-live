# IQAI Cognitive Sandbox V1 — Read the World

Temporary, isolated R&D lab for reasoning over read-only IQAI-style
`WorldStateSnapshot` fixtures. This lab is not a WorldView, GIS, ObjectRef, or
SensorPose authority.

## Boundary

- Listens on `127.0.0.1:8772`.
- Imports no Spatial V2 production modules.
- Uses explicitly synthetic/test snapshots only.
- Exposes fixture read, health, and advisory reasoning endpoints only.
- Has no action execution, map/camera control, shell, autonomous loop, Portal,
  email, filesystem-write, production-read, or GIS-write API.
- Model output cannot create `KNOWN` facts. It may only select IDs from
  deterministic inference and action candidates.

The live-proof script writes its receipt only under this lab's `proof/`
directory. That script is operator-run code, not a model tool.

## Architecture

```text
synthetic WorldStateSnapshot (read-only)
  -> schema validation + deep freeze
  -> deterministic KNOWN / UNKNOWN extraction
  -> bounded inference/action candidates
  -> replaceable BrainModelAdapter candidate selection
  -> validated CognitiveResponse (advisory only)
```

`BrainModelAdapter` currently has:

- `DeterministicMockAdapter` for stable contract tests.
- `OllamaGemmaAdapter` for loopback-only local Gemma 4 inference.

The adapter request has a future `media` seam for image data. V1 sends no
media. Any future visual observation remains advisory and cannot override
deterministic spatial identity, geometry, authority, provenance, or time.
Audio is declared unsupported in V1.

## Run

Requires Node.js 20+ and, for live inference, Ollama with
`gemma4:e4b-it-qat` installed.

```powershell
cd C:\Users\nicol\IQAI-Spatial-Brain-Lab\labs\cognitive-sandbox-v1
npm test
npm start
```

Open <http://localhost:8772/>.

The console can explicitly switch to the deterministic mock adapter. The
default is local Ollama. Override the local model without changing Brain
architecture:

```powershell
$env:IQAI_BRAIN_MODEL = 'gemma4:e4b-it-qat'
npm run proof:gemma
```

## HTTP surface

- `GET /api/fixtures` — explicitly synthetic/read-only snapshots.
- `GET /api/health?provider=ollama|mock` — adapter health and isolation status.
- `POST /api/reason` — accepts a supplied snapshot and question; returns a
  `CognitiveResponse`.

There is intentionally no `/api/action`, `/api/execute`, `/api/write`,
map-control, or camera-control route.

## Contracts

`WorldStateSnapshot` keeps unavailable values as `null`. Its schema represents:
WorldView state, optional Street 360 and traversal state, optional focus/object
summaries with source provenance, target/displayed time, nullable SensorPose,
optional collection summaries, and available capabilities.

`CognitiveResponse` separates:

- `known[]`: deterministic statements supported directly by the snapshot.
- `inferred[]`: exact, pre-grounded interpretations selected by the adapter.
- `unknown[]`: deterministic missing evidence.
- `proposedActions[]`: capability-gated proposals with explicit truth/risk
  notes. Proposals are never execution receipts.

Synthetic fixtures cover Montréal map state, Street 360 traversal, an NRCan-
style building, target/displayed time mismatch, unresolved identity, and a
null future SensorPose placeholder.
