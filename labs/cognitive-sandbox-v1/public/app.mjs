const QUESTIONS = Object.freeze([
  'What am I looking at?',
  'What do we know about this object?',
  'What is unknown?',
  'What should I inspect next?',
  'How far have I travelled?',
  'What date am I actually looking at?',
  'Is this object authoritative or inferred?',
  'What capabilities are available from here?'
]);

const elements = {
  fixtureSelect: document.querySelector('#fixture-select'),
  snapshotJson: document.querySelector('#snapshot-json'),
  worldSummary: document.querySelector('#world-summary'),
  questionList: document.querySelector('#question-list'),
  questionInput: document.querySelector('#question-input'),
  providerSelect: document.querySelector('#provider-select'),
  askButton: document.querySelector('#ask-button'),
  requestState: document.querySelector('#request-state'),
  responseSummary: document.querySelector('#response-summary'),
  known: document.querySelector('#known-list'),
  inferred: document.querySelector('#inferred-list'),
  unknown: document.querySelector('#unknown-list'),
  actions: document.querySelector('#actions-list'),
  warnings: document.querySelector('#warnings-list'),
  modelName: document.querySelector('#model-name'),
  modelMode: document.querySelector('#model-mode'),
  modelRuntime: document.querySelector('#model-runtime'),
  modelLatency: document.querySelector('#model-latency'),
  modelStatus: document.querySelector('#model-status')
};

let fixtures = [];

function selectedSnapshot() {
  return fixtures.find((snapshot) => snapshot.snapshotId === elements.fixtureSelect.value) ?? fixtures[0];
}

function addDefinition(term, description) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = term;
  dd.textContent = description;
  elements.worldSummary.append(dt, dd);
}

function renderSnapshot() {
  const snapshot = selectedSnapshot();
  elements.snapshotJson.textContent = JSON.stringify(snapshot, null, 2);
  elements.worldSummary.replaceChildren();
  addDefinition('Snapshot', snapshot.snapshotId);
  addDefinition('View', snapshot.worldview.activeView ?? 'UNKNOWN');
  addDefinition(
    'Position',
    snapshot.worldview.position
      ? `${snapshot.worldview.position.latitude}, ${snapshot.worldview.position.longitude}`
      : 'UNKNOWN'
  );
  addDefinition('Object', snapshot.object?.sourceId ?? 'NONE / UNRESOLVED');
  addDefinition('Target time', snapshot.time.targetTime ?? 'UNKNOWN');
  addDefinition('Observation', snapshot.time.displayedObservation ?? 'UNKNOWN');
  addDefinition('SensorPose', snapshot.sensorPose === null ? 'NULL' : 'PRESENT');
  addDefinition('Capabilities', snapshot.availableCapabilities.join(', ') || 'NONE');
}

function renderStringList(target, values) {
  target.replaceChildren();
  if (values.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'None supported by this response.';
    target.append(item);
    return;
  }
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    target.append(item);
  }
}

function renderActions(actions) {
  elements.actions.replaceChildren();
  if (actions.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No action proposed.';
    elements.actions.append(empty);
    return;
  }
  for (const action of actions) {
    const card = document.createElement('article');
    card.className = 'action-card';
    const label = document.createElement('strong');
    const reason = document.createElement('span');
    const risk = document.createElement('small');
    label.textContent = `${action.actionType} — ${action.label}`;
    reason.textContent = action.reason;
    risk.textContent = `${action.requiredCapability} · ${action.riskTruthNotes}`;
    card.append(label, reason, risk);
    elements.actions.append(card);
  }
}

function renderMetadata(metadata) {
  elements.modelName.textContent = metadata.model ?? '—';
  elements.modelMode.textContent = metadata.mode ?? '—';
  elements.modelRuntime.textContent = metadata.runtime ?? '—';
  elements.modelLatency.textContent = Number.isFinite(metadata.latencyMs) ? `${metadata.latencyMs} ms` : '—';
  elements.modelStatus.textContent = metadata.status ?? 'UNKNOWN';
}

function renderResponse(response) {
  elements.responseSummary.textContent = response.summary;
  renderStringList(elements.known, response.known);
  renderStringList(elements.inferred, response.inferred);
  renderStringList(elements.unknown, response.unknown);
  renderActions(response.proposedActions);
  renderStringList(elements.warnings, response.warnings);
  renderMetadata(response.modelMetadata);
}

async function updateHealth() {
  elements.modelStatus.textContent = 'CHECKING';
  try {
    const response = await fetch(`/api/health?provider=${encodeURIComponent(elements.providerSelect.value)}`);
    const payload = await response.json();
    renderMetadata({
      ...payload.model,
      latencyMs: null
    });
  } catch {
    elements.modelStatus.textContent = 'UNAVAILABLE';
  }
}

async function askIqai() {
  const snapshot = selectedSnapshot();
  const question = elements.questionInput.value.trim();
  if (!snapshot || !question) return;
  elements.askButton.disabled = true;
  elements.requestState.textContent = 'REASONING';
  try {
    const response = await fetch('/api/reason', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        snapshot,
        question,
        provider: elements.providerSelect.value,
        media: []
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    renderResponse(payload);
    elements.requestState.textContent = payload.modelMetadata.status;
  } catch (error) {
    elements.responseSummary.textContent = `Request failed safely: ${error.message}`;
    elements.requestState.textContent = 'FAILED';
  } finally {
    elements.askButton.disabled = false;
  }
}

function renderQuestionButtons() {
  for (const question of QUESTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = question;
    button.addEventListener('click', () => {
      elements.questionInput.value = question;
    });
    elements.questionList.append(button);
  }
}

async function initialize() {
  renderQuestionButtons();
  const response = await fetch('/api/fixtures');
  const payload = await response.json();
  fixtures = payload.snapshots;
  for (const snapshot of fixtures) {
    const option = document.createElement('option');
    option.value = snapshot.snapshotId;
    option.textContent = snapshot.snapshotId;
    elements.fixtureSelect.append(option);
  }
  const parameters = new URLSearchParams(window.location.search);
  const requestedFixture = parameters.get('fixture');
  if (requestedFixture && fixtures.some((snapshot) => snapshot.snapshotId === requestedFixture)) {
    elements.fixtureSelect.value = requestedFixture;
  }
  const requestedProvider = parameters.get('provider');
  if (['ollama', 'mock'].includes(requestedProvider)) {
    elements.providerSelect.value = requestedProvider;
  }
  if (parameters.get('question')) {
    elements.questionInput.value = parameters.get('question').slice(0, 1000);
  }
  renderSnapshot();
  await updateHealth();
  if (parameters.get('proof') === '1') await askIqai();
}

elements.fixtureSelect.addEventListener('change', renderSnapshot);
elements.providerSelect.addEventListener('change', updateHealth);
elements.askButton.addEventListener('click', askIqai);

initialize().catch((error) => {
  elements.responseSummary.textContent = `Sandbox initialization failed: ${error.message}`;
  elements.requestState.textContent = 'FAILED';
});
