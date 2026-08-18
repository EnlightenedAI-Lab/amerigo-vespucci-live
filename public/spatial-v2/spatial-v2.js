import { bootSpatialV2 } from './bootstrap/spatial-v2-bootstrap.js';
export { mountCommandCenter } from './shell/operator-session.js';

const root = document.getElementById('iqai-spatial-v2');
bootSpatialV2(root);
