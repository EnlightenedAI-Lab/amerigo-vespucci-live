/** Official identities reused from Data Master Montréal family + Brain / live adapters. */

export const PORT = Number(process.env.SANDBOX_PORT || 8793);
export const HOST = '127.0.0.1';
export const USER_AGENT = 'IQAI-Spatial-V2-Operational-Layers/1.7';

export const MONTREAL_VIEW = { lat: 45.5088, lon: -73.5617, zoom: 11 };

export const MONTREAL_BBOX = {
  minLat: 45.41,
  maxLat: 45.7,
  minLon: -73.98,
  maxLon: -73.47
};

/** Slightly expanded box so Hydro / STM / road works near the island remain visible. */
export const MONTREAL_AREA_BBOX = {
  minLat: 45.35,
  maxLat: 45.75,
  minLon: -74.15,
  maxLon: -73.35
};

export const URLS = {
  fireGeojson:
    'https://donnees.montreal.ca/dataset/c69e78c6-e454-4bd9-9778-e4b0eaf8105b/resource/beff8ce0-7a61-4a82-95b5-96d89bafa671/download/casernes.geojson',
  fireCatalogue: 'https://donnees.montreal.ca/en/dataset/casernes-pompiers',
  pdqGeojson:
    'https://donnees.montreal.ca/fr/dataset/91f66001-b461-4f63-aff4-cddc0fe30ffe/resource/c9d0b8d6-c7a6-4766-a5cc-98e8b1392bbc/download/pdq.geojson',
  pdqCatalogue: 'https://donnees.montreal.ca/en/dataset/neighborhood-police-stations-on-montreal-island',
  odhfCsv:
    'https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv',
  odhfCatalogue: 'https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32',
  ecccCitypage:
    'https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&limit=100&bbox=-74.1,45.3,-73.4,45.7',
  ecccAlerts:
    'https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=100&bbox=-74.1,45.3,-73.4,45.7',
  geometWms: 'https://geo.weather.gc.ca/geomet',
  geometRadarLayer: 'RADAR_1KM_RRAI',
  hydroBase: 'https://pannes.hydroquebec.com/pannes/donnees/v3_0',
  hydroLicence: 'https://www.hydroquebec.com/documents-donnees/donnees-ouvertes/licence.html',
  stmGtfsRt: 'https://api.stm.info/pub/od/gtfs-rt/ic/v2/vehiclePositions',
  spatialV2Stm: 'http://127.0.0.1:3047/api/spatial/stm/live-buses',
  spatialV2SpvmGeojson: 'http://127.0.0.1:3047/api/spatial/spvm/crime-90d',
  spatialV2SpvmStatus: 'http://127.0.0.1:3047/api/spatial/spvm/status',
  infoTravauxCatalogue: 'https://donnees.montreal.ca/dataset/info-travaux',
  infoTravauxCsv:
    'https://donnees.montreal.ca/dataset/667342f7-f667-4c3c-9837-65e81312cd8d/resource/cc41b532-f12d-40fb-9f55-eb58c9a2b12b/download/entraves-travaux-en-cours.csv',
  spvmGeojson: 'https://enlightenedai-lab.github.io/iqai-spvm-data/spvm/spvm-crime-90d.geojson',
  spvmStatus: 'https://enlightenedai-lab.github.io/iqai-spvm-data/spvm/status.json',
  spvmOfficialCsv:
    'https://donnees.montreal.ca/dataset/5829b5b0-ea6f-476f-be94-bc2b8797769a/resource/c6f482bf-bf0f-4960-8b2f-9982c211addd/download/actes-criminels.csv',
  pdqLimitesGeojson:
    'https://donnees.montreal.ca/dataset/186892b8-bba5-426c-aa7e-9db8c43cbdfe/resource/e18f0da9-3a16-4ba4-b378-59f698b47261/download/limitespdq.geojson',
  pdqLimitesCatalogue: 'https://donnees.montreal.ca/dataset/limites-pdq',
  bixiGbfs: 'https://gbfs.velobixi.com/gbfs/gbfs.json',
  bixiStationInformation: 'https://gbfs.velobixi.com/gbfs/en/station_information.json',
  bixiStationStatus: 'https://gbfs.velobixi.com/gbfs/en/station_status.json',
  bixiCatalogue: 'https://donnees.montreal.ca/dataset/bixi-etat-des-stations',
  simInterventionsCatalogue: 'https://donnees.montreal.ca/dataset/2fc8a2b9-1556-410e-a118-c46e97e9f19e',
  simDatastore:
    'https://donnees.montreal.ca/api/3/action/datastore_search?resource_id=71e86320-e35c-4b4c-878a-e52124294355',
  qc511Wfs: 'https://ws.mapserver.transports.gouv.qc.ca/swtq',
  qc511Chantiers:
    'https://ws.mapserver.transports.gouv.qc.ca/swtq?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=ms:chantiers_mtmdet&OUTPUTFORMAT=geojson&SRSNAME=EPSG:4326&BBOX=-74.15,45.35,-73.35,45.75',
  qc511Cameras:
    'https://ws.mapserver.transports.gouv.qc.ca/swtq?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=ms:infos_cameras&OUTPUTFORMAT=geojson&SRSNAME=EPSG:4326&BBOX=-74.15,45.35,-73.35,45.75',
  qc511CamerasWfs2:
    'https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson',
  qc511CamerasPages: 'https://www.quebec511.info/en/Diffusion/EtatReseau/Camera.aspx?Id=13000&Type=1',
  arcgisVilleCameras:
    'https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/Montreal/FeatureServer/0/query?where=1%3D1',
  villeCirculation: 'https://ville.montreal.qc.ca/circulation/',
  villeStillPrefix: 'https://ville.montreal.qc.ca/Circulation-Cameras/',
  qc511ChantiersCatalogue: 'https://www.donneesquebec.ca/recherche/dataset/travaux-routiers',
  spatialV2Aircraft: 'http://127.0.0.1:3047/api/spatial/live/aircraft',
  exoOpenData: 'https://exo.quebec/en/about/open-data',
  exoStaticGtfs: 'https://exo.quebec/xdata/trains/google_transit.zip',
  remInfo: 'https://rem.info/',
  remService: 'https://rem.info/fr',
  exoRequestForm: 'https://exo.quebec/en/about/open-data/RequestAccessForm',
  exoGtfsRt: 'https://opendata.exo.quebec/ServiceGTFSR/VehiclePosition.pb',
  ckanDatastore: 'https://donnees.montreal.ca/api/3/action/datastore_search',
  ckanSql: 'https://donnees.montreal.ca/api/3/action/datastore_search_sql',
  rsqaCatalogue: 'https://donnees.montreal.ca/dataset/rsqa-indice-qualite-air',
  rsqaStationIqa:
    'https://donnees.montreal.ca/dataset/3e9f7b96-3f25-4404-a5ad-22d9a31060e6/resource/6554355e-63d1-4a01-a268-91e0763c3606/download/iqa-by-station.csv',
  rsqaStationIqaResource: '6554355e-63d1-4a01-a268-91e0763c3606',
  rsqaDetailResource: 'f4eca3bf-5ded-4d3c-a8dc-ed42486498f3',
  ecccHydrometric: 'https://api.weather.gc.ca/collections/hydrometric-realtime/items',
  bikeCatalogue: 'https://donnees.montreal.ca/dataset/cyclistes',
  bikeCount2026Resource: '8ebe0b09-be67-4deb-84b5-45b73c7a0acf',
  bikeSitesResource: '866218c3-dac9-4d8f-bad9-eb04f257206d',
  civic311Catalogue: 'https://donnees.montreal.ca/dataset/requete-311',
  civic311Resource: '2cfa0e06-9be4-49a6-b7f1-ee9f2363a872',
  intersectionCountCatalogue: 'https://donnees.montreal.ca/dataset/comptage-vehicules-pietons',
  intersectionCountResource: 'f82f00c0-baed-4fa1-8b01-6ed60146d102',
  snowOpsCatalogue: 'https://donnees.montreal.ca/dataset/deneigement',
  cwfisHome: 'https://cwfis.cfs.nrcan.gc.ca/',
  cwfisPlacemat: 'https://cwfis.cfs.nrcan.gc.ca/downloads/docs/en/references/cwfif/cwfis-data-placemat.pdf',
  cwfisHowTo: 'https://cwfis.cfs.nrcan.gc.ca/downloads/docs/en/how-tos/how-to-access-cwfis-data-services.pdf',
  cwfisCwfifWfs: 'https://geoserver.cwfif.nrcan.gc.ca/geoserver/ows',
  cwfisLegacyWfs: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows',
  cwfisLegacyWms: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/wms',
  statcanDa2021FeatureServer:
    'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Canadian_Population_and_Dwelling_Counts_2021/FeatureServer',
  statcanDa2021Layer:
    'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Canadian_Population_and_Dwelling_Counts_2021/FeatureServer/3'
};

export const PANEL_GROUPS = [
  { id: 'public-safety', title: 'PUBLIC SAFETY' },
  { id: 'wildfire', title: 'WILDFIRE' },
  { id: 'movement', title: 'MOVEMENT' },
  { id: 'infrastructure', title: 'INFRASTRUCTURE' },
  { id: 'environment', title: 'ENVIRONMENT' }
];

export const CRIME_TIME_WINDOWS = [
  { id: '1d', label: 'LATEST DAY' },
  { id: '3d', label: 'LAST 3 DAYS' },
  { id: '7d', label: 'LAST 7 DAYS' },
  { id: '30d', label: 'LAST 30 DAYS' },
  { id: '90d', label: 'LAST 90 DAYS' }
];

export const LAYERS = [
  {
    id: 'recent-crime',
    title: 'Recent Crime',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'RECENT',
    sourceId: 'vmtl.spvm.actes-criminels.recent',
    provider: 'SPVM / Ville de Montréal — IQAI calendar-day filter',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#dc2626',
    officialUrl: URLS.spvmOfficialCsv,
    catalogueUrl: 'https://donnees.montreal.ca/dataset/actes-criminels',
    adapter: 'Intelligence Lab DATE windows on /api/spatial/spvm/crime-90d (iqai-spvm-data GeoJSON).',
    timeWindows: {
      default: '1d',
      supported: CRIME_TIME_WINDOWS,
      unsupported: ['1h', '6h', '12h']
    },
    establishes: [
      'SPVM open-data criminal-act points whose published DATE falls in the selected calendar-day window (as-of latest DATE in the feed)',
      'Official French CATEGORIE values, DATE, QUART, PDQ, privacy-displaced coordinates'
    ],
    doesNotEstablish: [
      'Live CAD',
      'Exact incident clock time (no hour field exists)',
      'Assault / crimes-against-person as a separate source category (not published in this dataset)',
      'That LATEST DAY is a rolling 24-hour clock window or LIVE'
    ],
    limitations: [
      'RECENT or HISTORICAL open-data context — never live police CAD.',
      'Timestamp is calendar DATE (+ reporting shift QUART). 1H / 6H / 12H clock filters are unsupported and not shown.',
      'If the Pages/Brain cache lags today, the as-of date is the latest DATE in the GeoJSON.',
      'Locations displaced to intersection. Feature.id is an IQAI fingerprint, not an official incident id.',
      'English labels are UI only; the mapped category remains the official French CATEGORIE.'
    ]
  },
  {
    id: 'spvm-crime',
    title: 'Crime History',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'HISTORICAL',
    sourceId: 'vmtl.spvm.actes-criminels',
    provider: 'SPVM / Ville de Montréal — IQAI 90-day derivative',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#6d597a',
    officialUrl: URLS.spvmGeojson,
    catalogueUrl: 'https://donnees.montreal.ca/dataset/actes-criminels',
    adapter: 'iqai-spvm-data GitHub Pages 90d GeoJSON + Brain spvm-crime-client',
    establishes: [
      'Lagged open-data criminal-act points in the IQAI 90-day rolling window',
      'Category, DATE + QUART, PDQ, privacy-displaced coordinates'
    ],
    doesNotEstablish: [
      'Live CAD',
      'Exact incident address or exact time of day',
      'Official monthly bilan / StatCan crime severity'
    ],
    limitations: [
      'HISTORICAL CONTEXT ONLY — not live police CAD.',
      'Locations displaced to intersection. Feature.id is an IQAI fingerprint, not an official incident id.',
      'Pages cache may lag the official daily CSV.'
    ]
  },
  {
    id: 'pdq-territories',
    title: 'Police PDQ Territories',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'STATIC',
    sourceId: 'vmtl.spvm.pdq-limites',
    provider: 'Ville de Montréal / SPVM',
    licence: 'CC-BY 4.0',
    geometry: 'polygon',
    color: '#4cc9f0',
    officialUrl: URLS.pdqLimitesGeojson,
    catalogueUrl: URLS.pdqLimitesCatalogue,
    adapter: 'Official limitespdq.geojson reprojected EPSG:32188 → WGS84 with the iqai-spvm-data MTM zone 8 proj4 string. Not Voronoi. Not the Intelligence Lab harmonized composite.',
    establishes: ['Official PDQ territory polygons and PDQ numbers from Ville limitespdq.geojson'],
    doesNotEstablish: ['Live CAD, patrol assignment, or that a crime point is legally inside a PDQ'],
    limitations: ['Publisher CRS is NAD83 MTM zone 8 (EPSG:32188). Sandbox reprojects for map display only.']
  },
  {
    id: 'pdq',
    title: 'Police Stations',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'STATIC',
    sourceId: 'vmtl.spvm.pdq-stations',
    provider: 'Ville de Montréal / SPVM',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#3a86ff',
    officialUrl: URLS.pdqGeojson,
    catalogueUrl: URLS.pdqCatalogue,
    adapter: 'Brain dataset-registry POLICE_STATIONS official pdq.geojson',
    establishes: ['SPVM neighbourhood station (PDQ) facility points from the official GeoJSON'],
    doesNotEstablish: ['Live police CAD, RMS, or current incidents', 'Patrol locations', 'Service-territory polygons (see Police PDQ Territories)'],
    limitations: ['Facilities only. Optional sublayer; not a crime feed.']
  },
  {
    id: 'fire',
    title: 'Fire Stations',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'STATIC',
    sourceId: 'vmtl.sim.casernes',
    provider: 'Ville de Montréal / SIM',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#e85d04',
    officialUrl: URLS.fireGeojson,
    catalogueUrl: URLS.fireCatalogue,
    adapter: 'Brain fire-station-config + dataset-registry (read-only reuse of official GeoJSON)',
    establishes: [
      'Current municipal fire-station inventory points from the official Ville GeoJSON',
      'Station number, civic address, borough, DATE_DEBUT / DATE_FIN as published'
    ],
    doesNotEstablish: [
      'Live fire CAD / RAO incidents',
      'Apparatus status, staffing, or turnout'
    ],
    limitations: ['Inventory snapshot. Operational status uses DATE_DEBUT / DATE_FIN fields; it is not a live CAD flag.']
  },
  {
    id: 'fire-interventions',
    title: 'Fire / Interventions',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'RECENT',
    sourceId: 'vmtl.sim.interventions',
    provider: 'Ville de Montréal / SIM',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#9d0208',
    officialUrl: URLS.simDatastore,
    catalogueUrl: URLS.simInterventionsCatalogue,
    adapter: 'Official CKAN datastore on the current 2-year SIM interventions CSV (resource 71e86320-…). Last 7 published calendar days only.',
    establishes: [
      'Official SIM open-data intervention points for the latest 7 published CREATION_DATE_TIME days',
      'Incident number, type, group, caserne, borough, published coordinates'
    ],
    doesNotEstablish: ['Live fire CAD / RAO dispatch', 'That CREATION_DATE_TIME is the time of arrival on scene'],
    limitations: [
      'Periodic extract from RAO — not live CAD. Latest published day may lag the calendar day.',
      'Coordinates are publisher-obfuscated. Entire 2-year city extract is not sent to the browser.'
    ]
  },
  {
    id: 'hospitals',
    title: 'Hospitals',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'STATIC',
    sourceId: 'statcan.odhf.hospitals',
    provider: 'Statistics Canada — ODHF',
    licence: 'Open Government Licence – Canada',
    geometry: 'point',
    color: '#2a9d8f',
    officialUrl: URLS.odhfCsv,
    catalogueUrl: URLS.odhfCatalogue,
    adapter: 'Brain dataset-registry HOSPITALS + odhf_hospitals_only + Montréal bbox filter',
    establishes: [
      'ODHF rows where odhf_facility_type = Hospitals inside the Island of Montréal bbox used by Brain'
    ],
    doesNotEstablish: ['Live occupancy, ER wait, EMS CAD, or current diversion status', 'Clinics / pharmacies / nursing homes'],
    limitations: [
      'Static vintage inventory. Montréal bbox is IQAI query scope, not a publisher geography field.',
      'Bbox also returns some off-island ODHF hospitals (Laval, Kahnawake, Longueuil/Greenfield Park, Deux-Montagnes).',
      'At least one Chisasibi-labelled ODHF row is geocoded downtown; that is publisher coordinate quality, not an IQAI invention.'
    ]
  },
  {
    id: 'civic-311',
    title: '311 requests',
    group: 'public-safety',
    family: 'Public safety',
    defaultOn: false,
    expectedStatus: 'RECENT',
    sourceId: 'vmtl.requetes-311',
    provider: 'Ville de Montréal',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#c45c5c',
    officialUrl: URLS.civic311Catalogue,
    catalogueUrl: URLS.civic311Catalogue,
    adapter: 'Official CKAN datastore of requetes 311 current extract. Last 2 published days with coordinates only.',
    establishes: ['Geocoded civic 311 service-request points from the official daily extract'],
    doesNotEstablish: ['Live 311 CAD / dispatch', 'That a request means an intervention occurred'],
    limitations: ['PERIODIC daily extract. Many rows have no coordinates and are omitted. Not live.']
  },
  {
    id: 'stm',
    title: 'STM Buses',
    group: 'movement',
    family: 'Transit',
    defaultOn: false,
    expectedStatus: 'AUTH_REQUIRED',
    sourceId: 'stm.gtfs-rt.vehicle-positions',
    provider: 'STM',
    licence: 'STM Terms / catalogue CC-BY 4.0 claim',
    geometry: 'point',
    color: '#38b000',
    officialUrl: URLS.stmGtfsRt,
    catalogueUrl: 'https://www.stm.info/en/about/developers',
    adapter: 'Brain / Spatial V2 stm-gtfs-rt-client. Sandbox reuses Spatial V2 /api/spatial/stm/live-buses read-only when present; never copies the key.',
    establishes: ['GTFS-Realtime vehicle positions when an entitled adapter responds', 'Route id filter from those vehicle records'],
    doesNotEstablish: ['Passenger load, schedule adherence as truth, or metro i3 service API'],
    limitations: [
      'Requires STM_API_KEY on an entitled adapter. Sandbox does not store credentials.',
      'Default-off: live vehicles clutter the map.',
      'Route filter uses GTFS-RT routeId already present on the vehicle records.'
    ],
    authBlocker: 'STM_API_KEY'
  },
  {
    id: 'exo',
    title: 'EXO Trains',
    group: 'movement',
    family: 'Transit',
    defaultOn: false,
    expectedStatus: 'AUTH_REQUIRED',
    sourceId: 'exo.gtfs-rt.vehicle-positions',
    provider: 'exo',
    licence: 'CC-BY (exo open-data licence)',
    geometry: 'none until entitled',
    color: '#7b2cbf',
    officialUrl: URLS.exoRequestForm,
    catalogueUrl: URLS.exoOpenData,
    adapter: 'None. Official GTFS-RT for commuter trains requires developer signup / request-form token.',
    establishes: [
      'Official access path: https://exo.quebec/en/about/open-data/RequestAccessForm (Chrono SAEIV API / Azure APIM signup)',
      'Realtime documented for commuter trains only; GTFS-RT URL is token-gated: https://opendata.exo.quebec/ServiceGTFSR/VehiclePosition.pb',
      'Public static GTFS zip exists for schedules'
    ],
    doesNotEstablish: ['Live train positions in this sandbox', 'That the static GTFS zip is a live vehicle feed'],
    limitations: [
      'Fill the official request form / APIM signup. Sandbox does not store or guess a token. No trains drawn.',
      'Static GTFS https://exo.quebec/xdata/trains/google_transit.zip is schedule data only.'
    ],
    authBlocker: 'exo request-form / Chrono SAEIV API token'
  },
  {
    id: 'rem',
    title: 'REM',
    group: 'movement',
    family: 'Transit',
    defaultOn: false,
    expectedStatus: 'UNAVAILABLE',
    sourceId: 'rem.service-status.website',
    provider: 'REM / CDPQ Infra',
    licence: 'UNKNOWN for any unpublished vehicle feed',
    geometry: 'none',
    color: '#4895ef',
    officialUrl: URLS.remService,
    catalogueUrl: URLS.remInfo,
    adapter: 'None. Official rem.info publishes human service-status / interruption messages. No official developer vehicle-position path was found.',
    establishes: [
      'rem.info publishes public service-status and interruption notices for humans',
      'Chrono is a consumer app that may show REM positions; that is not a documented REM developer feed for IQAI'
    ],
    doesNotEstablish: [
      'Live REM train positions',
      'An official rem.info / ARTM developer-access token path for vehicle positions',
      'That Transitland or gtfs.gpmmom.ca is an official REM realtime identity'
    ],
    limitations: [
      'UNAVAILABLE for live vehicles. Not labelled AUTH REQUIRED: no official developer-access path was identified.',
      'Do not scrape rem.info or third-party aggregators. No trains drawn.'
    ]
  },
  {
    id: 'bixi',
    title: 'BIXI',
    group: 'movement',
    family: 'Transit',
    defaultOn: false,
    expectedStatus: 'NEAR-LIVE',
    sourceId: 'bixi.gbfs.station-status',
    provider: 'BIXI Montréal',
    licence: 'CC-BY 4.0 — attribution to BIXI Montréal',
    geometry: 'point',
    color: '#00b4d8',
    officialUrl: URLS.bixiGbfs,
    catalogueUrl: URLS.bixiCatalogue,
    adapter: 'Official GBFS auto-discovery gbfs.velobixi.com (no prior IQAI adapter). Station capacity, not individual bikes.',
    establishes: [
      'BIXI station locations with bikes available and docks available from official GBFS',
      'Feed last_updated unix timestamp and ttl'
    ],
    doesNotEstablish: ['Individual bicycle tracking or trip paths'],
    limitations: ['NEAR-LIVE station status (publisher ttl ~10s). Temporary/virtual stations are skipped. Credit BIXI Montréal.']
  },
  {
    id: 'bike-counters',
    title: 'Cyclist counters',
    group: 'movement',
    family: 'Transit',
    defaultOn: false,
    expectedStatus: 'RECENT',
    sourceId: 'vmtl.compteurs-cyclistes',
    provider: 'Ville de Montréal',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#9aa8b5',
    officialUrl: URLS.bikeCatalogue,
    catalogueUrl: URLS.bikeCatalogue,
    adapter: 'Official Eco-Compteur 2026 datastore; latest 15-minute interval per site.',
    establishes: ['Permanent bike-counter locations and the latest published 15-minute passage count'],
    doesNotEstablish: ['Live individual cyclist tracking', 'Citywide bicycle GPS'],
    limitations: ['RECENT 15-minute aggregation. Latest interval may lag the current clock hour.']
  },
  {
    id: 'road-traffic',
    title: 'Road Traffic',
    group: 'movement',
    family: 'Traffic',
    defaultOn: false,
    expectedStatus: 'UNAVAILABLE',
    sourceId: 'qc.live-traffic-speeds',
    provider: 'None proven for Québec live speeds',
    licence: 'n/a',
    geometry: 'none',
    color: '#adb5bd',
    officialUrl: URLS.qc511Wfs,
    catalogueUrl: URLS.qc511ChantiersCatalogue,
    adapter: 'None. Ontario 511 / DriveBC exist in IQAI and must not be labelled Québec.',
    establishes: ['That no official reusable live traffic-speed / congestion feed for Montréal was proven here'],
    doesNotEstablish: ['Live travel times, speeds, or congestion'],
    limitations: ['UNAVAILABLE. Do not reuse Ontario 511 or DriveBC as Québec 511. MTMD works and Ville info-travaux are separate layers.']
  },
  {
    id: 'intersection-counts',
    title: 'Traffic / pedestrian counts',
    group: 'movement',
    family: 'Traffic',
    defaultOn: false,
    expectedStatus: 'HISTORICAL',
    sourceId: 'vmtl.comptage-vehicules-pietons',
    provider: 'Ville de Montréal',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#6b6560',
    officialUrl: URLS.intersectionCountCatalogue,
    catalogueUrl: URLS.intersectionCountCatalogue,
    adapter: 'Official intersection survey extract (vehicles, pedestrians, cyclists at signals). Unique intersections, last survey date.',
    establishes: ['Locations of signalized-intersection counting surveys and the latest survey date per intersection'],
    doesNotEstablish: ['Live traffic volume', 'Live pedestrian volume', 'Live cyclist volume at signals'],
    limitations: ['HISTORICAL peak-period field surveys. Not a live counter network. Pedestrian and vehicle counts share this survey product.']
  },
  {
    id: 'road-works',
    title: 'Road Works',
    group: 'movement',
    family: 'Traffic',
    defaultOn: false,
    expectedStatus: 'LIVE',
    sourceId: 'vmtl.info-travaux.entraves',
    provider: 'Ville de Montréal',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#ca6702',
    officialUrl: URLS.infoTravauxCsv,
    catalogueUrl: URLS.infoTravauxCatalogue,
    adapter: 'amerigo-vespucci-live montreal-road-obstructions CSV (points). Legacy CIFS JSON is rejected (HTTP 404).',
    establishes: [
      'Official info-travaux entraves rows with published longitude/latitude',
      'Permit/request id, occupancy name, status, load_date'
    ],
    doesNotEstablish: ['Live CAD traffic events', 'CIFS real-time feed (404)', 'Exact work-zone polygons', 'Provincial MTMD works'],
    limitations: ['Daily CSV via load_date, not second-by-second. Points only in this sandbox (impact segments not drawn).']
  },
  {
    id: 'qc-511',
    title: 'Québec 511 / MTMD works',
    group: 'movement',
    family: 'Traffic',
    defaultOn: false,
    expectedStatus: 'LIVE',
    sourceId: 'mtmd.travaux-routiers',
    provider: 'Ministère des Transports et de la Mobilité durable',
    licence: 'CC-BY 4.0',
    geometry: 'line',
    color: '#f4a261',
    officialUrl: URLS.qc511Chantiers,
    catalogueUrl: URLS.qc511ChantiersCatalogue,
    adapter: 'Official MTMD WFS ms:chantiers_mtmdet GeoJSON, Montréal-area bbox. Not the 511 human viewer.',
    establishes: [
      'Current MTMD-managed road-work geometries in the Montréal-area bbox',
      'identifiant, route, work description, debut/fin/miseAJour as published'
    ],
    doesNotEstablish: [
      'Municipal street works (see Road Works)',
      'Live traffic speeds',
      'Avertissement / incident layer — WFS typename avertissement_routier does not exist on this server'
    ],
    limitations: [
      'MTMD-managed roads only. Incident/avertissement feed is BLOCKED on this WFS (typename not found).',
      'Camera inventory is a separate STATIC layer; not live video.'
    ]
  },
  {
    id: 'traffic-cameras',
    title: 'Traffic cameras',
    group: 'movement',
    family: 'Traffic',
    defaultOn: false,
    expectedStatus: 'STALE',
    sourceId: 'mtmd.cameras-circulation + vmtl.circulation-cameras',
    provider: 'Québec 511 / MTMD + Ville de Montréal Circulation stills',
    licence: 'MTMD locations CC-BY 4.0; Ville still reuse and commercial product rights unreviewed',
    geometry: 'point',
    color: '#9aa8b5',
    officialUrl: URLS.qc511CamerasPages,
    catalogueUrl: 'https://www.donneesquebec.ca/recherche/dataset/camera-de-circulation',
    adapter: 'Current MTMD WFS locations + 2022 ArcGIS Ville inventory; on-demand allowlisted GEN jpeg probe/proxy. No frame archive.',
    establishes: [
      'Current MTMD camera locations in the Montréal-area bbox from official WFS',
      'Ville Circulation-Cameras GEN jpeg identity from the 2022 ArcGIS index, validated per request',
      'Last-Modified on a GEN jpeg vs IQAI retrieval time'
    ],
    doesNotEstablish: [
      'That a 2022 ArcGIS point is a current live camera',
      'A reusable Québec 511 still-image URL (WFS publishes FenetreVideo.html only)',
      'Live video',
      'Directional live stills',
      'Commercial redistribution rights'
    ],
    limitations: [
      'ArcGIS FeatureServer/0 lastEditDate 2022-11-30. Validate stills; do not trust inventory URLs blindly.',
      'quebec511.info FenetreVideo.html is Cloudflare-restricted from this sandbox process. Thumbnails are not fabricated.',
      'RIGHTS REVIEW REQUIRED FOR COMMERCIAL PRODUCT. No CV. No historical archive.',
      'On-demand probe/proxy only for visible/selected stills (cap ~12). Refresh 45s while shown.'
    ],
    rightsBlocker: 'RIGHTS REVIEW REQUIRED FOR COMMERCIAL PRODUCT'
  },
  {
    id: 'aircraft',
    title: 'Aircraft',
    group: 'movement',
    family: 'Aviation',
    defaultOn: false,
    expectedStatus: 'LIVE',
    sourceId: 'adsb.lol.v2',
    provider: 'ADSB.lol (cooperative ADS-B) via Spatial V2 read-only adapter',
    licence: 'ODbL 1.0',
    geometry: 'point',
    color: '#c9a227',
    officialUrl: 'https://api.adsb.lol/v2',
    catalogueUrl: 'https://api.adsb.lol/docs',
    adapter: 'Spatial V2 /api/spatial/live/aircraft (Brain adsb-lol-client). Not NAV CANADA. Sandbox does not scrape NAV CANADA.',
    establishes: [
      'Cooperative ADS-B positions near Montréal when the Spatial V2 adapter responds',
      'Callsign/hex, altitude, speed, observedAt / feed timestamp'
    ],
    doesNotEstablish: [
      'Complete air picture',
      'NAV CANADA authoritative surveillance',
      'SAFE TO FLY / flight authorization'
    ],
    limitations: [
      'Cooperative/incomplete. ODbL share-alike. Default-off.',
      'If the Spatial V2 adapter is unreachable, this layer is AUTH REQUIRED / UNAVAILABLE and draws no aircraft.'
    ]
  },
  {
    id: 'hydro',
    title: 'Hydro-Québec Outages',
    group: 'infrastructure',
    family: 'Infrastructure',
    defaultOn: false,
    expectedStatus: 'LIVE',
    sourceId: 'hydroquebec.pannes.bis',
    provider: 'Hydro-Québec',
    licence: 'CC-BY-NC 4.0',
    geometry: 'point + polygon',
    color: '#9b2226',
    officialUrl: `${URLS.hydroBase}/bisversion.json`,
    catalogueUrl: URLS.hydroLicence,
    adapter: 'Brain hydro-quebec-outages-client + hydro-quebec-kmz-parse (official bispoly KMZ areas, linked by centroid).',
    establishes: [
      'Current outage marker points from the official BIS feed',
      'Approximate published outage area polygons from official bispoly KMZ where present',
      'Customers affected, crew/cause codes, feed version/timestamp as published'
    ],
    doesNotEstablish: [
      'Exact affected buildings or legal service-territory polygons',
      'Planned interruptions (AIP) — separate product, not loaded',
      'Permission for commercial IQAI product packaging'
    ],
    limitations: [
      'Locations/areas are approximate.',
      'Licence is CC-BY-NC 4.0. Commercial use remains fail-closed until a separate grant is recorded.',
      'Sandbox map applies a Montréal-area bbox filter; provincial remainder is counted, not fabricated.',
      'Polygons are Hydro-published approximate areas. Points without a matching KMZ placemark stay points; no polygons are inferred from markers.'
    ],
    rightsBlocker: 'CC-BY-NC 4.0 — commercial product use not established'
  },
  {
    id: 'snow-ops',
    title: 'Snow / road operations',
    group: 'infrastructure',
    family: 'Infrastructure',
    defaultOn: false,
    expectedStatus: 'AUTH_REQUIRED',
    sourceId: 'vmtl.planif-neige',
    provider: 'Ville de Montréal',
    licence: 'CC-BY 4.0 (dataset); API token required',
    geometry: 'none until entitled',
    color: '#9aa8b5',
    officialUrl: URLS.snowOpsCatalogue,
    catalogueUrl: URLS.snowOpsCatalogue,
    adapter: 'None. Official Planif-Neige API requires a token requested by email to donneesouvertes@montreal.ca.',
    establishes: ['That an official snow-loading planning API exists and is token-gated'],
    doesNotEstablish: ['Live plow positions', 'Current street-by-street snow-clearing state in this sandbox'],
    limitations: [
      'AUTH REQUIRED. Do not scrape the 311 snow map. Seasonal parking lots are a separate static inventory, not live ops.',
      'No fake plow tracks.'
    ],
    authBlocker: 'Planif-Neige API token via donneesouvertes@montreal.ca'
  },
  {
    id: 'weather',
    title: 'ECCC Weather / Alerts / Radar',
    group: 'environment',
    family: 'Weather',
    defaultOn: false,
    expectedStatus: 'LIVE',
    sourceId: 'eccc.msc.citypageweather-realtime + weather-alerts + geomet RADAR_1KM_RRAI',
    provider: 'ECCC / MSC GeoMet',
    licence: 'ECCC Data Server End-use Licence v2.1',
    geometry: 'point + polygon + raster',
    color: '#8ecae6',
    officialUrl: URLS.ecccCitypage,
    catalogueUrl: 'https://api.weather.gc.ca/',
    adapter: 'Ops lab MSC OGC API + GeoMet WMS; Brain MSC fallback identities. Not Spatial V2 IPMA radar.',
    establishes: [
      'MSC citypageweather-realtime items in the Montréal bbox',
      'MSC weather-alerts items in the same bbox (zero items is EMPTY_COVERAGE, not failure)',
      'GeoMet WMS layer RADAR_1KM_RRAI as live radar imagery'
    ],
    doesNotEstablish: [
      'Azores / IPMA radar',
      'Alert Ready CAP land feed (blocked/failed in Ops lab)',
      'That a quiet alerts collection means the endpoint failed'
    ],
    limitations: ['Do not alter alert text/intent. Open-Meteo is not used. Radar is pixel overlay, not a facility query.']
  },
  {
    id: 'air-quality',
    title: 'RSQA Air Quality',
    group: 'environment',
    family: 'Weather',
    defaultOn: false,
    expectedStatus: 'NEAR-LIVE',
    sourceId: 'vmtl.rsqa.iqa-horaire',
    provider: 'Ville de Montréal / RSQA',
    licence: 'CC-BY 4.0',
    geometry: 'point',
    color: '#6ea8d8',
    officialUrl: URLS.rsqaStationIqa,
    catalogueUrl: URLS.rsqaCatalogue,
    adapter: 'Official hourly IQA-by-station + detailed pollutant IQA CKAN datastore. Latest published hour only.',
    establishes: [
      'RSQA station locations with current hourly IQA',
      'IQA sub-indices for PM2.5, NO2, O3, SO2, CO where published for that hour',
      'Observation date/hour (Eastern Standard Time year-round) and retrieval time'
    ],
    doesNotEstablish: ['Continuous analyser milligram readings', 'Provincial IQA map (Montréal RSQA is separate)'],
    limitations: [
      'NEAR-LIVE: updated ~50 minutes after the hour. Always EST, not EDT.',
      'valeur is the published IQA (and sub-index), not a fabricated concentration.'
    ]
  },
  {
    id: 'hydrometric',
    title: 'Water levels',
    group: 'environment',
    family: 'Weather',
    defaultOn: false,
    expectedStatus: 'NEAR-LIVE',
    sourceId: 'eccc.msc.hydrometric-realtime',
    provider: 'ECCC MSC',
    licence: 'ECCC Data Server End-use Licence v2.1',
    geometry: 'point',
    color: '#6ea8d8',
    officialUrl: URLS.ecccHydrometric,
    catalogueUrl: 'https://api.weather.gc.ca/collections/hydrometric-realtime',
    adapter: 'MSC OGC API hydrometric-realtime, Montréal-area bbox, latest observation per station in a 3-hour window.',
    establishes: ['Official water level and/or discharge at hydrometric stations near Montréal'],
    doesNotEstablish: ['A flood-warning or ice-jam CAD product', 'Complete Québec hydrometric network'],
    limitations: ['NEAR-LIVE observations. Sparse in the island bbox. Not CEHQ viewer scrape.']
  },
  {
    id: 'sun-daylight',
    title: 'Sun / Daylight',
    group: 'environment',
    family: 'Weather',
    defaultOn: false,
    expectedStatus: 'COMPUTED',
    sourceId: 'iqai.computed.solar-position.noaa',
    provider: 'Computed — NOAA Solar Calculator equations',
    licence: 'NOAA solar equations are public scientific formulae; this layer is not a measured feed',
    geometry: 'polygon + line + point',
    color: '#d8c9a3',
    officialUrl: 'https://gml.noaa.gov/grad/solcalc/',
    catalogueUrl: 'https://gml.noaa.gov/grad/solcalc/solareqns.PDF',
    adapter: 'Local NOAA GML solar-position / equation-of-time calculation. 2021 Census DA population via DisseminationAreas_21 FeatureServer, centroid classification.',
    establishes: [
      'Current or simulated UTC and America/Toronto civil time',
      'Sun azimuth and elevation at a requested point',
      'Sunrise and sunset for the local calendar day at that point',
      'Geometric illumination bands: daylight (≥0°), civil (0 to −6), nautical (−6 to −12), astronomical (−12 to −18), night (< −18)',
      '0° solar terminator as the day/night horizon',
      '2021 Census usual-resident population by illumination class for the Montréal census division, using DA centroid classification'
    ],
    doesNotEstablish: [
      'Measured irradiance or ECCC weather',
      'Terrain shadows, building shadows, or camera pointing',
      'That night shading in a Montréal island view must be visible while the sun is up',
      'People physically present at the calculation instant',
      'Sub-DA population precision when a dissemination area straddles a solar boundary'
    ],
    limitations: [
      'COMPUTED / CURRENT, not a live sensor. Refresh ~60 s while the layer is on.',
      'Apparent elevation includes NOAA refraction. Civil twilight is geometric elevation −6°.',
      'Population is Statistics Canada 2021 Census usual residents (DisseminationAreas_21). DA centroid classification.',
      'Default off: night shading is global and can compete with operational marks if left on at city zoom.',
      'Optional in WEATHER IMPACT / POLICE PICTURE via CONFIGURE; not in those default scene lists.'
    ]
  },
  {
    id: 'wildfire-active',
    title: 'Active fires (CWFIS)',
    group: 'wildfire',
    family: 'Wildfire',
    defaultOn: false,
    expectedStatus: 'CURRENT',
    sourceId: 'nrcan.cwfis.activefires',
    provider: 'NRCan — Canadian Wildland Fire Information System',
    licence: 'Open Government Licence – Canada (CWFIS / NRCan)',
    geometry: 'point',
    color: '#ff6a2b',
    officialUrl: URLS.cwfisCwfifWfs,
    catalogueUrl: URLS.cwfisPlacemat,
    adapter: 'CWFIF WFS public:cwfif_national_activefires, agency_code=QC, WGS84. Newest 4000 by status_date if the service pages.',
    establishes: [
      'Agency-reported wildland fire locations that CWFIS currently publishes as active for Québec',
      'National fire id, agency fire id, stage_of_control_status, fire_size, status_date as published'
    ],
    doesNotEstablish: [
      'Real-time SOPFEU CAD',
      'That every record is still burning on the ground today',
      'U.S. InciWeb truth'
    ],
    limitations: [
      'REPORTED / CURRENT, not real-time. National products may lag the local agency.',
      'GeoServer may page; snapshot records matched vs loaded.'
    ]
  },
  {
    id: 'wildfire-hotspots',
    title: 'Satellite hotspots',
    group: 'wildfire',
    family: 'Wildfire',
    defaultOn: false,
    expectedStatus: 'SATELLITE DETECTION',
    sourceId: 'nrcan.cwfis.hotspots-24h',
    provider: 'NRCan — CWFIS Fire M3',
    licence: 'Open Government Licence – Canada (CWFIS / NRCan)',
    geometry: 'point',
    color: '#ffcf5a',
    officialUrl: URLS.cwfisLegacyWfs,
    catalogueUrl: URLS.cwfisHowTo,
    adapter: 'Legacy CWFIS WFS public:hotspots_last24hrs, Québec lat/lon window.',
    establishes: ['Satellite thermal detections in the Québec window for the last 24 hours, with sensor/time/FRP when published'],
    doesNotEstablish: ['A confirmed wildfire', 'Complete detection under cloud', 'Agency-reported incidents'],
    limitations: ['SATELLITE DETECTION only. A hotspot is not automatically a wildfire.']
  },
  {
    id: 'wildfire-perimeters',
    title: 'Perimeter estimates',
    group: 'wildfire',
    family: 'Wildfire',
    defaultOn: false,
    expectedStatus: 'SATELLITE-DERIVED ESTIMATE',
    sourceId: 'nrcan.cwfis.m3-polygons-current',
    provider: 'NRCan — CWFIS Fire M3',
    licence: 'Open Government Licence – Canada (CWFIS / NRCan)',
    geometry: 'polygon',
    color: '#e85d04',
    officialUrl: URLS.cwfisLegacyWfs,
    catalogueUrl: URLS.cwfisHowTo,
    adapter: 'Legacy CWFIS WFS public:m3_polygons_current in WGS84; sandbox keeps polygons that touch the Québec bbox.',
    establishes: ['Current CWFIS satellite-derived perimeter estimates intersecting Québec'],
    doesNotEstablish: ['Official final fire boundary', 'Legal fire perimeter used by SOPFEU'],
    limitations: ['SATELLITE-DERIVED ESTIMATE from buffered/hotspot mapping. Not a surveyed edge.']
  },
  {
    id: 'wildfire-fwi',
    title: 'Fire weather / FWI',
    group: 'wildfire',
    family: 'Wildfire',
    defaultOn: false,
    expectedStatus: 'CURRENT',
    sourceId: 'nrcan.cwfis.fwi',
    provider: 'NRCan — CWFIS CFFDRS',
    licence: 'Open Government Licence – Canada (CWFIS / NRCan)',
    geometry: 'raster+point',
    color: '#c4a36a',
    officialUrl: URLS.cwfisLegacyWms,
    catalogueUrl: URLS.cwfisHowTo,
    adapter: 'WMS public:fwi (contextual grid) plus WFS public:firewx_stns_current where prov=QC.',
    establishes: ['Current CWFIS Fire Weather Index grid and Québec fire-weather station FWI values as published'],
    doesNotEstablish: ['A fire occurrence forecast as an incident', 'Spot weather for a specific fireline'],
    limitations: ['Low-dominance context. Station FWI is point weather, not a fire perimeter.']
  }
];

export function layerMeta(id) {
  return LAYERS.find((layer) => layer.id === id) || null;
}

export function inBbox(lat, lon, bbox = MONTREAL_BBOX) {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}
