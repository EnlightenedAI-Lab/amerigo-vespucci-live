# IQAI Spatial V2 — Living Blueprint V1

This branch is an isolated visual/product blueprint for IQAI Spatial V2. It does not modify the active product branch or runtime.

## Purpose

The blueprint is the human-readable companion to the Tool Builder Master architecture decomposition. It is intended to hold the stable product direction, system architecture, build order, and Command decisions in a form that can be reviewed visually before implementation.

## Governing product model

IQAI Spatial is a multi-view spatial operating environment. The operator chooses a place or object once and can move across 2D maps, Street 360, visual 3D, analytical 3D, imagery, time, GIS analysis, AI, simulation and future-world scenarios without losing spatial context.

The Central Cognitive Orchestrator operates over canonical World State and registered capabilities. LLMs may propose plans; deterministic software owns validation, authority, execution and write-back.

## Blueprint update rule

1. Command makes or adjudicates a product decision.
2. The written architecture/specification is updated first.
3. The visual blueprint is updated to match it.
4. Builders receive bounded missions derived from the frozen blueprint/spec.
5. Product code does not redefine architecture by accident.

## Current build gate

Before feature expansion, Spatial V2 requires a clean product checkpoint, runtime identity match, thin registry-driven shell, World State, ObjectRef/Selection, Policy, Job Manager, and Brain Phase 0.

## Site

`index.html` is a self-contained static visual blueprint. It can be served directly as a static site or through GitHub Pages after Pages is configured for this branch.

Branch: `blueprint/spatial-v2-v1`

Initial site commit: `2cbd98eaf812fb194bc42f6743f128fabe0c919d`
