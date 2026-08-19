# Focus Instrument Lab V4 — handoff

This file is a lab handoff only. It does not modify Spatial V2, production ObjectRef, or Street 360.

## Frozen operator states

IDLE → HOVER → TARGETED → ACQUIRED → INSPECTING → CLEARED

Source geometry may be building-specific. Interaction state is generic.

## Shared lab ObjectRef

Contract id: `iqai.lab.objectref.v1`

```
ObjectRef
  objectKey        provider:class:sourceId
  objectClass      e.g. building
  authority        provider, dataset, datasetUuid, layer
  sourceId         provider native id (NRCan feature_id)
  geometry         authoritative vector when available
  anchor           centroid
  attributesRef    pointer to authority record, not a copy of inference
  provenance       method=vector-selection, inference=false
  measurements     optional bearing/range attachment

SelectionState
  objectRef
  acquiredAt
  activeView       MAP | STREET_360 | SCENE_3D
```

Visual class inference is not equivalent to authoritative identity.

Restore uses `sourceId` lookup only. It must not re-run nearest-object hit-testing because the view changed.

## Authority providers vs views

Municipal / NRCan / global datasets are **authority providers beneath ObjectRef**.

They are not separate databases belonging to MAP, STREET 360, or 3D.

Intended flow:

VIEW → candidate/acquisition → OBJECT RESOLVER → AUTHORITY PROVIDER → OBJECTREF → synchronized views

For synthetic or un-georeferenced Street 360 imagery:

visual class inference ≠ authoritative GIS identity.
