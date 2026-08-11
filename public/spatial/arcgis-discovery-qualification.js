/**
 * Authority-aware ranking for ArcGIS portal discovery results.
 */

const AUTHORITY_OWNER_PATTERNS = [
  { pattern: /\bville[._-]?montreal\b/i, label: 'Ville de Montréal', weight: 100 },
  { pattern: /\bvillede\s*montreal\b/i, label: 'Ville de Montréal', weight: 100 },
  { pattern: /\bmontreal[_-]?open[_-]?data\b/i, label: 'Données ouvertes Montréal', weight: 95 },
  { pattern: /\bdonnees[._-]?montreal\b/i, label: 'Données ouvertes Montréal', weight: 95 },
  { pattern: /\bgouv\.qc\.ca\b/i, label: 'Gouvernement du Québec', weight: 90 },
  { pattern: /\bstatcan\b/i, label: 'Statistics Canada', weight: 85 },
  { pattern: /\besri[_-]?livingatlas\b/i, label: 'Esri Living Atlas', weight: 70 },
  { pattern: /\besri\b/i, label: 'Esri', weight: 70 },
  { pattern: /\bliving\s*atlas\b/i, label: 'Esri Living Atlas', weight: 65 }
];

function normalizeAscii(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * @param {object} item
 */
export function assessArcgisProvenanceAuthority(item = {}) {
  const title = String(item.title || '');
  const snippet = String(item.snippet || '');
  const description = String(item.description || '');
  const haystack = `${title} ${snippet} ${description}`.replace(/<[^>]+>/g, ' ');

  if (/donnees\.montreal\.ca|portail des données ouvertes de la ville de montréal|portail des donnees ouvertes de la ville de montreal/i.test(haystack)) {
    return {
      authorityLabel: 'Ville de Montréal open data (item provenance)',
      authorityWeight: 92,
      authorityBasis: 'item provenance cites donnees.montreal.ca'
    };
  }

  if (/minist[eè]re de l['’]?énergie|mern|minist[eè]re des transports du qu[eé]bec|gouvernement du qu[eé]bec/i.test(haystack)) {
    return {
      authorityLabel: 'Gouvernement du Québec (item provenance)',
      authorityWeight: 60,
      authorityBasis: 'item provenance cites Quebec government source'
    };
  }

  return null;
}

/**
 * @param {object} item
 */
export function assessArcgisItemAuthority(item = {}) {
  const owner = String(item.owner || item.username || '');
  const orgName = String(item.orgName || item.orgTitle || '');
  const title = String(item.title || '');
  const snippet = String(item.snippet || item.description || '');

  for (const entry of AUTHORITY_OWNER_PATTERNS) {
    if (entry.pattern.test(owner) || entry.pattern.test(orgName)) {
      return {
        authorityLabel: entry.label,
        authorityWeight: entry.weight,
        authorityBasis: `owner match: ${entry.label}`
      };
    }
  }

  const provenanceAuthority = assessArcgisProvenanceAuthority(item);
  if (provenanceAuthority) return provenanceAuthority;

  const haystack = `${title} ${snippet}`;
  if (/montreal|montréal/i.test(haystack)) {
    return {
      authorityLabel: 'Montreal-related publisher',
      authorityWeight: 40,
      authorityBasis: 'Montreal keyword in metadata (unverified publisher)'
    };
  }

  return {
    authorityLabel: null,
    authorityWeight: 0,
    authorityBasis: 'unverified publisher'
  };
}

/**
 * @param {object} item
 * @param {string} query
 */
export function scoreArcgisDiscoveryItem(item = {}, query = '', options = {}) {
  const normalizedQuery = normalizeAscii(query);
  const title = normalizeAscii(item.title);
  const snippet = normalizeAscii(item.snippet || item.description || '');
  const authority = assessArcgisItemAuthority(item);
  const requireAuthoritative = options.requireAuthoritative === true
    || /\bauthoritative\b/i.test(String(query));
  let score = authority.authorityWeight;

  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 2);
  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    else if (snippet.includes(token)) score += 4;
  }

  if (/\bborough|arrondissement|boundary|limites/.test(normalizedQuery)) {
    if (/\bborough|arrondissement|boundary|limites|administrative/.test(`${title} ${snippet}`)) {
      score += 20;
    }
  }
  const bikeQuery = /\bbike|cycl|piste|velo|vélo|cycleway/.test(normalizedQuery);
  const bikeTitleMatch = /\bbike|cycl|piste|sentier|velo|vélo|cycleway|reseau/.test(title);
  const bikeSnippetMatch = /\b(bike path|bike lane|cycling network|piste cyclable|pistes cyclables|reseau cyclable|réseau cyclable|sentier cyclable|cycleway)\b/.test(snippet);
  if (bikeQuery) {
    if (!bikeTitleMatch && !bikeSnippetMatch) {
      return {
        ...item,
        authorityLabel: authority.authorityLabel,
        authorityBasis: authority.authorityBasis,
        authorityWeight: authority.authorityWeight,
        qualificationScore: score,
        qualificationReason: 'SEMANTIC_MISMATCH'
      };
    }
    score += bikeTitleMatch ? 24 : 12;
  }
  if (/\bflood|inond/.test(normalizedQuery)) {
    if (/\bflood|inond/.test(`${title} ${snippet}`)) score += 20;
  }

  if (item.type === 'Feature Service' || item.type === 'Map Service') score += 8;
  if (item.geographicRelevance === 'in-map-extent') score += 6;

  let qualificationReason = score >= 50 ? 'QUALIFIED' : 'LOW_RELEVANCE';
  if (requireAuthoritative) {
    const publisherAuthoritative = authority.authorityWeight >= 65;
    qualificationReason = publisherAuthoritative && score >= 65
      ? 'QUALIFIED'
      : 'INSUFFICIENT_AUTHORITY';
  }

  return {
    ...item,
    authorityLabel: authority.authorityLabel,
    authorityBasis: authority.authorityBasis,
    authorityWeight: authority.authorityWeight,
    qualificationScore: score,
    qualificationReason
  };
}

/**
 * @param {object[]} results
 * @param {string} query
 */
export function rankArcgisDiscoveryResults(results = [], query = '', options = {}) {
  return results
    .map((item) => scoreArcgisDiscoveryItem(item, query, options))
    .filter((item) => item.qualificationReason === 'QUALIFIED')
    .sort((a, b) => b.qualificationScore - a.qualificationScore);
}
