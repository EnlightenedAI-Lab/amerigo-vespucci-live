import { getLayerById } from './layer-catalog.js';

/**
 * Cost and licence gate for layer activation.
 */
export class CostPolicy {
  constructor(options = {}) {
    this.radarEnabled = options.radarEnabled === true;
    this.commercialEnabled = options.commercialEnabled === true;
    this.creditConsumingConfirmed = new Set(options.creditConsumingConfirmed || []);
    this.blockUnknownInProduction = options.blockUnknownInProduction !== false;
    this.isProduction = options.isProduction !== false;
  }

  evaluate(layer) {
    if (!layer?.enabled) return { allowed: false, reason: 'layer disabled in catalog' };
    if (layer.retired) return { allowed: false, reason: layer.retiredNote || 'layer retired' };

    switch (layer.costClass) {
      case 'FREE_PUBLIC':
        break;
      case 'FREE_WITH_ACCOUNT':
        break;
      case 'ARCGIS_SUBSCRIBER':
        break;
      case 'ARCGIS_CREDIT_CONSUMING':
        if (!this.creditConsumingConfirmed.has(layer.id)) {
          return {
            allowed: false,
            reason: 'ArcGIS credit-consuming layer requires explicit confirmation',
            requiresConfirmation: true,
            freeAlternative: 'copernicus-current'
          };
        }
        break;
      case 'COMMERCIAL':
        if (!this.commercialEnabled) {
          return { allowed: false, reason: 'Commercial contract flag not enabled' };
        }
        break;
      case 'UNKNOWN':
        if (this.blockUnknownInProduction && this.isProduction) {
          return { allowed: false, reason: 'UNKNOWN cost class blocked in production' };
        }
        break;
      default:
        return { allowed: false, reason: `unsupported costClass: ${layer.costClass}` };
    }

    if (layer.id === 'ipma-radar-azores' && !this.radarEnabled) {
      return {
        allowed: false,
        reason: 'Permission review required',
        blocked: true,
        uiLabel: 'Permission review required'
      };
    }

    return { allowed: true };
  }

  canActivate(layerId) {
    const layer = typeof layerId === 'string' ? getLayerById(layerId) : layerId;
    return this.evaluate(layer).allowed;
  }
}
