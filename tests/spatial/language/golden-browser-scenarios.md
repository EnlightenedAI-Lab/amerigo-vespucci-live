# IQAI Spatial — Golden Browser Acceptance Scenarios

Scoped conversational zoom is **DEFERRED**. These scenarios do not require scoped zoom PASS.

## Source layer visibility

1. Turn on Cameras.
2. Turn off Cameras.
3. Turn on Cameras and EMS.
4. Turn Cameras and EMS off.
5. Turn all layers on.
6. Turn off all source layers.

## Multi-layer control

7. Show Cameras, EMS and Traffic.
8. Hide EMS, Cameras and Roads.
9. Zoom to Cameras and EMS.

## Radius query (WebMap)

10. Show Cameras within 3 km of 997 de la Commune.
11. How many Cameras are within 3 km of 997 de la Commune?
12. Show EMS within 2 km of 997 de la Commune.

## Radius refinement

13. Show Cameras within 3 km of 997 de la Commune → Make it 5 km.
14. Within 5 km instead (after prior scoped query).

## Scoped results visibility

15. Hide these results (after scoped query).
16. Show them again.
17. Turn off all layers (source + scoped results hidden).

## Conversation pronouns

18. Turn on Cameras and EMS → Turn them off → Turn them back on.
19. Hide them (ambiguous without context — expect clarification).

## Location reuse

20. Show Cameras within 3 km of 997 de la Commune → Show EMS there.

## Reset

21. Reset map after scoped query — original Montreal 1 restored, no AOI residue.
22. Start over after compound query.

## Compound GIS

23. Map the 3 nearest police stations and all fire stations within 4 km of 997 de la Commune.
24. Map the 5 nearest hospitals, the 3 nearest police stations, and all fire stations within 6 km of 6939 Décarie Boulevard.

## Verified datasets

25. Show the 5 nearest police stations to 997 de la Commune.
26. Count hospitals within 3 km of 997 de la Commune.

## Feature interaction

27. Click scoped camera feature — URL/attributes in detail panel.
28. Click second camera — selection updates.

## French (manual spot check)

29. Désactive les caméras.
30. Montre les caméras dans un rayon de 3 km de 997 de la Commune.

## Ambiguity (must clarify)

31. Show it.
32. Hide that.
33. Show important things.

## Layer list

34. What layers do I have?
35. What point layers do I have?

## Deferred (do not block release)

36. Zoom to these results (scoped zoom DEFERRED).
37. Zoom to them after scoped query (DEFERRED).
