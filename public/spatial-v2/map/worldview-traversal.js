/**
 * WorldView Street 360 drive trace.
 *
 * Provider-neutral TraversalSession. Geographic panorama moves only.
 * Heading / pitch / zoom do not append points. Not ObjectRef. Not a
 * virtual sensor placement. Not MapView pan history. Not a planned route.
 */

import { offsetMeters } from './worldview-navigation.js';

export const WORLDVIEW_GEOMETRY_KIND = Object.freeze({
  POSITION: 'WORLDVIEW_POSITION',
  LOOK: 'WORLDVIEW_LOOK',
  TRAVERSAL: 'WORLDVIEW_TRAVERSAL',
  NORTH: 'WORLDVIEW_NORTH'
});

export const TRAVERSAL_SOURCE_VIEW = 'STREET 360';
export const TRAVERSAL_MIN_MOVE_METERS = 6;

let programmaticUntil = 0;

export function beginProgrammaticTraversal(ms = 3200) {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  programmaticUntil = Math.max(programmaticUntil, until);
}

export function isProgrammaticTraversal() {
  return Date.now() < programmaticUntil;
}

function clonePoint(point) {
  if (!point) return null;
  return {
    longitude: Number(point.longitude),
    latitude: Number(point.latitude),
    timestamp: point.timestamp,
    sourceView: TRAVERSAL_SOURCE_VIEW,
    panoId: point.panoId || null
  };
}

function cloneSession(session) {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    points: session.points.map(clonePoint),
    distanceMeters: session.distanceMeters,
    active: session.active,
    kind: WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
    currentHeading: Number.isFinite(Number(session.currentHeading))
      ? Number(session.currentHeading)
      : null,
    currentPitch: Number.isFinite(Number(session.currentPitch))
      ? Number(session.currentPitch)
      : null,
    currentZoom: Number.isFinite(Number(session.currentZoom))
      ? Number(session.currentZoom)
      : null
  };
}

export function createWorldviewTraversalController(options = {}) {
  const minMoveMeters = Number(options.minMoveMeters) > 0
    ? Number(options.minMoveMeters)
    : TRAVERSAL_MIN_MOVE_METERS;
  const now = options.now || (() => new Date().toISOString());
  const idFactory = options.idFactory || (() => `trv-${Date.now().toString(36)}`);
  const listeners = new Set();
  let session = emptySession();
  let sequence = 0;

  function emptySession() {
    return {
      sessionId: null,
      startedAt: null,
      points: [],
      distanceMeters: 0,
      active: false,
      kind: WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
      currentHeading: null,
      currentPitch: null,
      currentZoom: null
    };
  }

  function emit() {
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch (error) {
        console.warn('[IQAI V2] traversal listener failed', error);
      }
    }
  }

  function snapshot() {
    return cloneSession(session);
  }

  function rememberOrientation(pose) {
    if (Number.isFinite(Number(pose?.heading))) session.currentHeading = Number(pose.heading);
    if (Number.isFinite(Number(pose?.pitch))) session.currentPitch = Number(pose.pitch);
    if (Number.isFinite(Number(pose?.zoom))) session.currentZoom = Number(pose.zoom);
  }

  function appendPoint(pose) {
    const point = {
      longitude: Number(pose.longitude),
      latitude: Number(pose.latitude),
      timestamp: now(),
      sourceView: TRAVERSAL_SOURCE_VIEW,
      panoId: pose.panoId || null
    };
    const last = session.points.at(-1);
    const step = last ? offsetMeters(last, point) : 0;
    session.points.push(point);
    if (Number.isFinite(step) && session.points.length > 1) {
      session.distanceMeters = Number((session.distanceMeters + step).toFixed(3));
    }
    return { point, step: session.points.length > 1 ? step : 0 };
  }

  function observeStreetPose(pose = {}) {
    const longitude = Number(pose.longitude);
    const latitude = Number(pose.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return { accepted: false, reason: 'invalid', snapshot: snapshot() };
    }
    rememberOrientation(pose);
    if (pose.programmatic === true || isProgrammaticTraversal()) {
      if (!session.active || !session.sessionId) {
        sequence += 1;
        session = {
          sessionId: idFactory(sequence),
          startedAt: now(),
          points: [],
          distanceMeters: 0,
          active: true,
          kind: WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
          currentHeading: session.currentHeading,
          currentPitch: session.currentPitch,
          currentZoom: session.currentZoom
        };
        appendPoint(pose);
        emit();
        return { accepted: true, reason: 'start', snapshot: snapshot() };
      }
      emit();
      return { accepted: false, reason: 'programmatic', snapshot: snapshot() };
    }
    if (!session.active || !session.sessionId) {
      sequence += 1;
      session = {
        sessionId: idFactory(sequence),
        startedAt: now(),
        points: [],
        distanceMeters: 0,
        active: true,
        kind: WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
        currentHeading: session.currentHeading,
        currentPitch: session.currentPitch,
        currentZoom: session.currentZoom
      };
      appendPoint(pose);
      emit();
      return { accepted: true, reason: 'start', snapshot: snapshot() };
    }

    const last = session.points.at(-1);
    if (last?.panoId && pose.panoId && last.panoId === pose.panoId) {
      emit();
      return { accepted: false, reason: 'orientation', snapshot: snapshot() };
    }
    const moved = offsetMeters(last, pose);
    if (moved != null && moved < minMoveMeters) {
      emit();
      return { accepted: false, reason: 'jitter', snapshot: snapshot() };
    }
    appendPoint(pose);
    emit();
    return { accepted: true, reason: 'move', snapshot: snapshot() };
  }

  function clear() {
    session = emptySession();
    emit();
    return snapshot();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  return {
    snapshot,
    observeStreetPose,
    clear,
    subscribe,
    getMinMoveMeters: () => minMoveMeters
  };
}

const shared = createWorldviewTraversalController();

export function getWorldviewTraversal() {
  return shared.snapshot();
}

export function observeStreetTraversal(pose) {
  return shared.observeStreetPose(pose);
}

export function clearWorldviewTraversal() {
  return shared.clear();
}

export function subscribeWorldviewTraversal(listener) {
  return shared.subscribe(listener);
}

export function resetWorldviewTraversalForTests() {
  programmaticUntil = 0;
  shared.clear();
}
