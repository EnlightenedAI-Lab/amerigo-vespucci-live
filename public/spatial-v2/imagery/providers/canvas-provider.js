import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';

export const canvasProvider = {
  id: 'canvas',
  title: 'Canvas',
  kind: PROVIDER_KIND.CANVAS,

  describe() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      modes: [GROUND_MODE.PURE_BLACK, GROUND_MODE.PURE_WHITE]
    };
  },

  async probeEntitlement() {
    return ENTITLEMENT_STATE.READY;
  },

  observationFor(modeId) {
    const black = modeId === GROUND_MODE.PURE_BLACK;
    return emptyObservation({
      id: `canvas:${modeId}`,
      providerId: this.id,
      productName: black ? 'Pure black canvas' : 'Pure white canvas',
      dateKindUsed: DATE_KIND.NONE,
      rights: emptyRights({
        display: RIGHTS.PERMITTED,
        export: RIGHTS.PERMITTED,
        cache: RIGHTS.PERMITTED,
        analysis: RIGHTS.PROHIBITED
      }),
      limitation: 'Appearance only. Not imagery.',
      establishes: 'Map canvas appearance.',
      doesNotEstablish: 'Capture date, coverage, Situation time, or evidence geometry.',
      sourceIdentity: { kind: 'canvas', modeId }
    });
  }
};
