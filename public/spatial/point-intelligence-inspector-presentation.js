/**
 * Inspector presentation — progressive disclosure drawer HTML.
 */
import { toSafeRawJson } from './point-intelligence-inspector-safe.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderField(label, value, copyId = null) {
  if (value == null || value === '') return '';
  const copy = copyId
    ? `<button type="button" class="lif-inspector__copy" data-pi-copy="${escapeHtml(copyId)}" title="Copy">Copy</button>`
    : '';
  return `
    <div class="lif-inspector__field">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(String(value))}${copy}</dd>
    </div>`;
}

function renderSection(title, fieldsHtml) {
  if (!fieldsHtml.trim()) return '';
  return `
    <section class="lif-inspector__section">
      <h5 class="lif-inspector__section-title">${escapeHtml(title)}</h5>
      <dl class="lif-inspector__fields">${fieldsHtml}</dl>
    </section>`;
}

function renderMeasurements(measurements = []) {
  if (!measurements.length) return '';
  return `
    <section class="lif-inspector__section">
      <h5 class="lif-inspector__section-title">Values</h5>
      <dl class="lif-inspector__fields">
        ${measurements.map((row) => renderField(row.label, row.value)).join('')}
      </dl>
    </section>`;
}

function renderTrace(trace = []) {
  if (!trace.length) return '';
  return `
    <section class="lif-inspector__section">
      <h5 class="lif-inspector__section-title">Source trace</h5>
      <div class="lif-inspector__trace">${trace.map((part) => escapeHtml(part)).join(' <span aria-hidden="true">→</span> ')}</div>
    </section>`;
}

function renderRaw(raw, label = 'Technical details') {
  if (!raw) return '';
  const json = toSafeRawJson(raw);
  return `
    <details class="lif-inspector__raw">
      <summary>${escapeHtml(label)}</summary>
      <pre class="lif-inspector__raw-body">${escapeHtml(json)}</pre>
    </details>`;
}

function renderActions(actions = []) {
  if (!actions.length) return '';
  return `
    <div class="lif-inspector__actions">
      ${actions.map((action) => (
        `<button type="button" class="lif-inspector__action" data-pi-inspector-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
      )).join('')}
    </div>`;
  }

export function renderEvidenceInspectorHtml(model) {
  if (!model) {
    return '<div class="lif-inspector__empty">Evidence is unavailable for this bundle.</div>';
  }

  const identity = [
    renderField('Observation ID', model.observationId, model.observationId),
    renderField('Information family', model.familyLabel),
    renderField('Result type', model.resultKind),
    renderField('Capability', model.capabilityId, model.capabilityId),
    renderField('Station / sensor', model.stationIdentity),
    renderField('Native record', model.nativeRecordId, model.nativeRecordId)
  ].join('');

  const spatial = model.spatial?.unavailable
    ? renderField('Spatial', model.spatial.message)
    : [
      renderField('Geometry', model.spatial?.geometryType),
      renderField('Coordinates', model.spatial?.coordinates),
      renderField('Distance from anchor', model.spatial?.distanceFromAnchor),
      renderField('Spatial precision', model.spatial?.spatialPrecision)
    ].join('');

  const temporal = [
    renderField('Observation time', model.temporal?.observationTime),
    renderField('Source / publication time', model.temporal?.sourcePublicationTime),
    renderField('Retrieval time', model.temporal?.retrievalTime),
    renderField('IQAI knowledge time', model.temporal?.knowledgeTime),
    renderField('Temporal class', model.temporal?.temporalClass)
  ].join('');

  const provider = [
    renderField('Provider', model.provider?.providerName),
    renderField('Protocol', model.provider?.protocolFamily),
    renderField('Source collection', model.provider?.sourceCollection),
    renderField('Source endpoint', model.provider?.sourceEndpoint)
  ].join('');

  const actions = [
    model.queryReceiptId ? { id: 'open-receipt', label: 'Query receipt' } : null,
    model.hasGeometry ? { id: 'focus-map', label: 'Focus on map' } : null,
    { id: 'back-lif', label: 'Back to Location Intelligence' }
  ].filter(Boolean);

  return `
    <div class="lif-inspector lif-inspector--evidence" data-inspector-level="OBSERVATION">
      <header class="lif-inspector__header">
        <button type="button" class="lif-inspector__back" data-pi-inspector-back>Back</button>
        <div>
          <h4 class="lif-inspector__title">Evidence inspector</h4>
          <div class="lif-inspector__subtitle">Observation</div>
        </div>
      </header>
      ${renderActions(actions)}
      ${renderSection('Identity', identity)}
      ${renderSection(model.aoiRelationship?.kind === 'EVIDENCE' ? 'Acquisition relationship' : 'AOI relationship', [
        renderField(model.aoiRelationship?.kind === 'EVIDENCE' ? 'Role' : 'Relationship', model.aoiRelationship?.label),
        renderField(model.aoiRelationship?.kind === 'EVIDENCE' ? 'Query origin distance' : 'Distance', model.aoiRelationship?.distanceLabel)
      ].join(''))}
      ${renderSection('Spatial', spatial)}
      ${renderSection('Temporal', temporal)}
      ${renderSection('Provider / source', provider)}
      ${renderMeasurements(model.measurements)}
      ${renderTrace(model.sourceTrace)}
      ${renderRaw(model.raw)}
    </div>`;
}

export function renderReceiptInspectorHtml(model) {
  if (!model) {
    return '<div class="lif-inspector__empty">Query receipt is unavailable for this family.</div>';
  }

  const identity = [
    renderField('Query receipt ID', model.queryReceiptId, model.queryReceiptId),
    renderField('Query request ID', model.queryRequestId, model.queryRequestId),
    renderField('Information family', model.familyLabel),
    renderField('Capability', model.capabilityId, model.capabilityId),
    renderField('Provider', model.providerName),
    renderField('Native capability', model.nativeId)
  ].join('');

  const query = [
    renderField('Query mode', model.queryMode),
    renderField('Temporal intent', model.temporalIntent),
    renderField('Requested mode', model.temporalRequest?.mode),
    renderField('AT timestamp', model.temporalRequest?.at),
    renderField('Range start', model.temporalRequest?.rangeStart),
    renderField('Range end', model.temporalRequest?.rangeEnd),
    renderField('Provider temporal support', model.temporalRequest?.providerTemporalSupport),
    renderField('Execution temporal parameters', model.temporalRequest?.executionTemporalParameters
      ? JSON.stringify(model.temporalRequest.executionTemporalParameters) : null),
    renderField('Result temporal coverage', model.temporalRequest?.resultTemporalCoverage),
    renderField('Retrieval / knowledge time', model.temporalRequest?.retrievalTime),
    renderField('Query anchor', model.queryAnchor),
    renderField('Requested radius', model.radiusLabel),
    renderField('Execution status', model.executionStatus),
    renderField('Result status', model.resultStatus),
    renderField('Result count', model.resultCount)
  ].join('');

  const timing = [
    renderField('Retrieved', model.timing?.retrievedAt),
    renderField('Temporal class', model.timing?.temporalClass),
    renderField('Newest observation', model.timing?.newestObservedAt)
  ].join('');

  const accounting = model.spatialAccounting ? [
    renderField('Provider candidates retrieved', model.spatialAccounting.providerResultsReceived),
    renderField('Excluded outside radius', model.spatialAccounting.excludedOutsideRadius),
    renderField('Excluded (no point geometry)', model.spatialAccounting.excludedNoPointGeometry),
    renderField('Returned evidence', model.spatialAccounting.resultsReturned),
    renderField('True-radius predicate', model.spatialAccounting.predicate)
  ].join('') : '';

  const bundle = [
    renderField('Bundle orchestration', model.orchestrationId),
    renderField('Bundle ID', model.bundleId)
  ].join('');

  const issue = model.error ? renderField('Issue detail', JSON.stringify(model.error)) : '';

  const actions = [
    { id: 'back-lif', label: 'Back to Location Intelligence' }
  ];

  return `
    <div class="lif-inspector lif-inspector--receipt" data-inspector-level="QUERY_RECEIPT">
      <header class="lif-inspector__header">
        <button type="button" class="lif-inspector__back" data-pi-inspector-back>Back</button>
        <div>
          <h4 class="lif-inspector__title">Query receipt</h4>
          <div class="lif-inspector__subtitle">${escapeHtml(model.familyLabel)}</div>
        </div>
      </header>
      ${renderActions(actions)}
      ${renderSection('Receipt identity', identity)}
      ${renderSection('Query execution', query)}
      ${renderSection('Timing', timing)}
      ${accounting ? renderSection('True-radius accounting', accounting) : ''}
      ${model.retrievalEnvelope ? renderSection('Retrieval envelope', renderField('Envelope', 'See technical details')) : ''}
      ${issue ? renderSection('Provider issue', issue) : ''}
      ${renderSection('Bundle context', bundle)}
      ${renderTrace(model.sourceTrace)}
      ${renderRaw(model.raw, 'Raw receipt')}
    </div>`;
}

export function renderInspectorHostHtml() {
  return '<div id="lif-inspector-host" class="lif-inspector-host" hidden></div>';
}
