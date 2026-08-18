import { EXPERIENCE_MODE, IMAGERY_VIEW } from './command-center-state.js';

export const GUIDED_WORKFLOW = Object.freeze({
  NONE: 'NONE',
  MAP: 'MAP',
  IMAGERY_LATEST: 'IMAGERY_LATEST',
  IMAGERY_HISTORY: 'IMAGERY_HISTORY',
  IMAGERY_ALL: 'IMAGERY_ALL'
});

export const GUIDED_STEP = Object.freeze({
  ASK: 'ASK',
  LATEST: 'LATEST',
  HISTORY: 'HISTORY',
  ALL_IMAGERY: 'ALL_IMAGERY',
  CHOOSE_DATE: 'CHOOSE_DATE',
  SHOW_BEST_IMAGE: 'SHOW_BEST_IMAGE',
  REVIEW_OBSERVATIONS: 'REVIEW_OBSERVATIONS'
});

export const GUIDED_ACTION = Object.freeze({
  ASK: 'ASK',
  CHOOSE_DATE: 'CHOOSE_DATE',
  SHOW_BEST_IMAGE: 'SHOW_BEST_IMAGE',
  PREVIOUS: 'PREVIOUS',
  NEXT: 'NEXT',
  COMPARE: 'COMPARE'
});

const HISTORY_SEQUENCE = Object.freeze([
  GUIDED_STEP.HISTORY,
  GUIDED_STEP.CHOOSE_DATE,
  GUIDED_STEP.SHOW_BEST_IMAGE,
  GUIDED_STEP.REVIEW_OBSERVATIONS
]);

const LATEST_SEQUENCE = Object.freeze([
  GUIDED_STEP.LATEST,
  GUIDED_STEP.SHOW_BEST_IMAGE,
  GUIDED_STEP.REVIEW_OBSERVATIONS
]);

const ALL_SEQUENCE = Object.freeze([
  GUIDED_STEP.ALL_IMAGERY,
  GUIDED_STEP.SHOW_BEST_IMAGE,
  GUIDED_STEP.REVIEW_OBSERVATIONS
]);

const STEP_LABEL = Object.freeze({
  [GUIDED_STEP.ASK]: 'ASK IQAI',
  [GUIDED_STEP.LATEST]: 'LATEST',
  [GUIDED_STEP.HISTORY]: 'HISTORY',
  [GUIDED_STEP.ALL_IMAGERY]: 'ALL IMAGERY',
  [GUIDED_STEP.CHOOSE_DATE]: 'CHOOSE DATE',
  [GUIDED_STEP.SHOW_BEST_IMAGE]: 'SHOW BEST IMAGE',
  [GUIDED_STEP.REVIEW_OBSERVATIONS]: 'PREVIOUS / NEXT / COMPARE'
});

function firstIncomplete(sequence, completedSteps) {
  return sequence.find((step) => !completedSteps.includes(step)) || sequence[sequence.length - 1];
}

function actionsFor(currentStep) {
  if (currentStep === GUIDED_STEP.ASK) return [GUIDED_ACTION.ASK];
  if (currentStep === GUIDED_STEP.CHOOSE_DATE || currentStep === GUIDED_STEP.HISTORY) {
    return [GUIDED_ACTION.CHOOSE_DATE];
  }
  if (
    currentStep === GUIDED_STEP.SHOW_BEST_IMAGE
    || currentStep === GUIDED_STEP.LATEST
    || currentStep === GUIDED_STEP.ALL_IMAGERY
  ) {
    return [GUIDED_ACTION.SHOW_BEST_IMAGE];
  }
  if (currentStep === GUIDED_STEP.REVIEW_OBSERVATIONS) {
    return [GUIDED_ACTION.PREVIOUS, GUIDED_ACTION.NEXT, GUIDED_ACTION.COMPARE];
  }
  return [];
}

function recommendedFor(currentStep) {
  if (currentStep === GUIDED_STEP.REVIEW_OBSERVATIONS) return GUIDED_ACTION.PREVIOUS;
  return actionsFor(currentStep)[0] || null;
}

function bestImageShown(displayConfirmed) {
  return displayConfirmed === true;
}

export function deriveGuidedNextAction({
  activeCapability,
  imageryView,
  observationCount = 0,
  displayConfirmed = false,
  historyDateCommitted = false
} = {}) {
  if (activeCapability !== 'imagery') {
    return {
      workflowId: GUIDED_WORKFLOW.MAP,
      currentStep: GUIDED_STEP.ASK,
      completedSteps: [],
      validNextActions: [GUIDED_ACTION.ASK],
      recommendedAction: GUIDED_ACTION.ASK,
      sequence: [GUIDED_STEP.ASK]
    };
  }

  if (imageryView === IMAGERY_VIEW.HISTORY) {
    const completedSteps = [GUIDED_STEP.HISTORY];
    if (historyDateCommitted || observationCount > 0) {
      completedSteps.push(GUIDED_STEP.CHOOSE_DATE);
    }
    if (bestImageShown(displayConfirmed)) completedSteps.push(GUIDED_STEP.SHOW_BEST_IMAGE);
    const currentStep = firstIncomplete(HISTORY_SEQUENCE, completedSteps);
    return {
      workflowId: GUIDED_WORKFLOW.IMAGERY_HISTORY,
      currentStep,
      completedSteps,
      validNextActions: actionsFor(currentStep),
      recommendedAction: recommendedFor(currentStep),
      sequence: [...HISTORY_SEQUENCE]
    };
  }

  if (imageryView === IMAGERY_VIEW.ALL) {
    const completedSteps = [GUIDED_STEP.ALL_IMAGERY];
    if (bestImageShown(displayConfirmed)) completedSteps.push(GUIDED_STEP.SHOW_BEST_IMAGE);
    const currentStep = firstIncomplete(ALL_SEQUENCE, completedSteps);
    return {
      workflowId: GUIDED_WORKFLOW.IMAGERY_ALL,
      currentStep,
      completedSteps,
      validNextActions: actionsFor(currentStep),
      recommendedAction: recommendedFor(currentStep),
      sequence: [...ALL_SEQUENCE]
    };
  }

  const completedSteps = [GUIDED_STEP.LATEST];
  if (bestImageShown(displayConfirmed)) completedSteps.push(GUIDED_STEP.SHOW_BEST_IMAGE);
  const currentStep = firstIncomplete(LATEST_SEQUENCE, completedSteps);
  return {
    workflowId: GUIDED_WORKFLOW.IMAGERY_LATEST,
    currentStep,
    completedSteps,
    validNextActions: actionsFor(currentStep),
    recommendedAction: recommendedFor(currentStep),
    sequence: [...LATEST_SEQUENCE]
  };
}

export function guidedNextActionCopy(projection, experience = EXPERIENCE_MODE.NORMAL) {
  const expert = experience === EXPERIENCE_MODE.EXPERT;
  const currentLabel = projection.currentStep ? STEP_LABEL[projection.currentStep] : 'NONE';
  const recommended = {
    [GUIDED_ACTION.ASK]: expert
      ? 'Ask IQAI. Routing remains fail-closed; unmatched language does not become GIS.'
      : 'Ask IQAI what you want to know or do.',
    [GUIDED_ACTION.CHOOSE_DATE]: expert
      ? 'Set requestedDate, then show the best available image. Capture and release stay separate.'
      : 'Choose a date, then show the best available image.',
    [GUIDED_ACTION.SHOW_BEST_IMAGE]: expert
      ? 'Show the best available image using the existing nearest/latest contract. DISCOVER is the same action.'
      : 'Show the best available image for this request.',
    [GUIDED_ACTION.PREVIOUS]: expert
      ? 'Step Previous / Next. COMPARE remains unavailable. ACTIVATE is Expert depth, not a new sequence.'
      : 'Go to the previous or next image, or compare when that becomes available.'
  }[projection.recommendedAction] || 'No guided action.';

  return {
    nowLabel: currentLabel,
    sequenceLabels: projection.sequence.map((step) => STEP_LABEL[step]),
    recommendedLabel: recommended,
    recommendedAction: projection.recommendedAction
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderGuidedNextAction(projection, experience, surface = 'stage') {
  const copy = guidedNextActionCopy(projection, experience);
  const sequence = copy.sequenceLabels.length
    ? copy.sequenceLabels.join(' → ')
    : 'Ask IQAI to begin.';
  return `
    <section
      class="iqai-v2-guided"
      data-iqai-guided-next-action="${escapeHtml(surface)}"
      data-iqai-guided-workflow="${escapeHtml(projection.workflowId)}"
      data-iqai-guided-step="${escapeHtml(projection.currentStep || 'NONE')}"
      data-iqai-guided-recommended="${escapeHtml(projection.recommendedAction || 'NONE')}"
      aria-label="Guided next action"
    >
      <p class="iqai-v2-guided__now">NOW <span>${escapeHtml(copy.nowLabel)}</span></p>
      <p class="iqai-v2-guided__sequence">${escapeHtml(sequence)}</p>
      <p class="iqai-v2-guided__next"><span>NEXT</span> ${escapeHtml(copy.recommendedLabel)}</p>
    </section>
  `;
}

export function paintGuidedNextAction(root, projection, experience) {
  const host = root.querySelector('[data-iqai-guided-cue]');
  if (host) {
    host.hidden = true;
    host.innerHTML = '';
  }

  root.querySelectorAll('[data-iqai-next]').forEach((node) => {
    node.removeAttribute('data-iqai-next');
  });
  const nextMap = {
    [GUIDED_ACTION.ASK]: '[data-iqai-guided-action="ASK"]',
    [GUIDED_ACTION.CHOOSE_DATE]: '[data-iqai-operator-imagery-date]',
    [GUIDED_ACTION.SHOW_BEST_IMAGE]: '[data-iqai-operator-imagery-action="discover"]',
    [GUIDED_ACTION.PREVIOUS]: '[data-iqai-operator-imagery-action="previous"]',
    [GUIDED_ACTION.NEXT]: '[data-iqai-operator-imagery-action="next"]',
    [GUIDED_ACTION.COMPARE]: '[data-iqai-future-imagery-action="COMPARE"]'
  };
  const selector = nextMap[projection.recommendedAction];
  if (selector) {
    root.querySelector(selector)?.setAttribute('data-iqai-next', 'true');
  }
}

export function identityOfGuided(projection) {
  return {
    workflowId: projection.workflowId,
    currentStep: projection.currentStep,
    completedSteps: [...projection.completedSteps],
    validNextActions: [...projection.validNextActions],
    recommendedAction: projection.recommendedAction
  };
}
