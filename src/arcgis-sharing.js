/**
 * Share ArcGIS Online items with Everyone (public).
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {string} itemId
 */
export async function publishArcGISItem(client, itemId) {
  const item = await client.get(`${client.config.arcgisPortalUrl}/sharing/rest/content/items/${itemId}?f=json`);
  if (item.error) throw new Error(item.error.message || JSON.stringify(item.error));

  const ownerPath = encodeURIComponent(item.owner);
  const updateBody = new URLSearchParams({
    f: 'json',
    token: client.token,
    access: 'public',
    listed: 'true',
    title: item.title
  });
  const update = await client.rawPost(
    `${client.config.arcgisPortalUrl}/sharing/rest/content/users/${ownerPath}/items/${itemId}/update`,
    updateBody
  );

  const shareBody = new URLSearchParams({
    f: 'json',
    token: client.token,
    everyone: 'true'
  });
  const share = await client.rawPost(
    `${client.config.arcgisPortalUrl}/sharing/rest/content/items/${itemId}/share`,
    shareBody
  );

  const after = await getItemAccess(client, itemId);
  return {
    itemId,
    update,
    share,
    access: after.access,
    public: after.access === 'public',
    everyoneShareBlocked: Boolean(share.error)
  };
}

/**
 * Read item access level (private / org / public).
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {string} itemId
 */
export async function getItemAccess(client, itemId) {
  const item = await client.get(`${client.config.arcgisPortalUrl}/sharing/rest/content/items/${itemId}?f=json`);
  if (item.error) throw new Error(item.error.message || JSON.stringify(item.error));
  return {
    id: itemId,
    title: item.title,
    type: item.type,
    access: item.access,
    url: item.url || null
  };
}

/**
 * Anonymous REST probe (no token).
 * @param {string} url
 */
export async function probeAnonymousArcGIS(url) {
  const res = await fetch(url);
  const data = await res.json();
  return {
    ok: res.ok && !data.error,
    status: res.status,
    error: data.error || null,
    count: data.count ?? null,
    name: data.name ?? null
  };
}

/** @deprecated use publishArcGISItem */
export async function shareItemsWithEveryone(client, itemIds) {
  const results = [];
  for (const itemId of itemIds) results.push(await publishArcGISItem(client, itemId));
  return { shared: true, results };
}
