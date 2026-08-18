import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATUS,
  JOB_TARGET
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createJobManager } from '../../public/spatial-v2/jobs/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function clock() {
  let n = 0;
  return () => new Date(Date.parse('2026-08-18T16:00:00.000Z') + n++ * 1000).toISOString();
}

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function manager() {
  return createJobManager({ now: clock(), idFactory: ids('job') });
}

function spec() {
  return {
    capabilityId: 'chassis.job-sum',
    actorRef: 'operator:session',
    worldId: 'world-1',
    baseWorldRevision: 1,
    target: JOB_TARGET.LOCAL_CPU
  };
}

test('jobs follow QUEUED to RUNNING to COMPLETE and keep PROGRESS off the status enum', () => {
  const jobs = manager();
  const queued = jobs.enqueue(spec());
  assert.equal(queued.status, JOB_STATUS.QUEUED);
  const running = jobs.start(queued.jobId);
  assert.equal(running.status, JOB_STATUS.RUNNING);
  const progressed = jobs.progress(queued.jobId, { current: 1, total: 2, percent: 50, message: 'halfway' });
  assert.equal(progressed.status, JOB_STATUS.RUNNING);
  const complete = jobs.complete(queued.jobId, { resultRef: 'result-1' });
  assert.equal(complete.status, JOB_STATUS.COMPLETE);
  assert.equal(complete.resultRef, 'result-1');
});

test('cancel becomes CANCELLED only after backend acknowledgement', () => {
  const jobs = manager();
  const queued = jobs.enqueue(spec());
  jobs.start(queued.jobId);
  const requested = jobs.requestCancel(queued.jobId);
  assert.equal(requested.status, JOB_STATUS.RUNNING);
  assert.equal(requested.cancelRequested, true);
  const cancelled = jobs.acknowledgeCancel(queued.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.equal(cancelled.backendAckedCancel, true);
});

test('stale completion of a terminal job fails closed', () => {
  const jobs = manager();
  const queued = jobs.enqueue(spec());
  jobs.start(queued.jobId);
  jobs.complete(queued.jobId, { resultRef: 'result-1' });
  assert.throws(
    () => jobs.complete(queued.jobId, { resultRef: 'result-2' }),
    (error) => error instanceof ContractError && error.code === 'STALE_COMPLETION'
  );
});

test('JobManager enforces frozen QUEUED to RUNNING to COMPLETE FAILED or CANCELLED transitions', () => {
  const jobs = manager();
  const queued = jobs.enqueue(spec());
  assert.throws(
    () => jobs.fail(queued.jobId, 'queued cannot fail'),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
  assert.throws(
    () => jobs.complete(queued.jobId),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
  assert.throws(
    () => jobs.progress(queued.jobId, { percent: 10 }),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
  const running = jobs.start(queued.jobId);
  assert.equal(running.status, JOB_STATUS.RUNNING);
  assert.throws(
    () => jobs.start(queued.jobId),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
  const failed = jobs.fail(queued.jobId, 'adapter error');
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.throws(
    () => jobs.complete(queued.jobId),
    (error) => error instanceof ContractError && error.code === 'STALE_COMPLETION'
  );

  const completeJob = jobs.enqueue(spec());
  jobs.start(completeJob.jobId);
  jobs.complete(completeJob.jobId, { resultRef: 'ok' });
  assert.throws(
    () => jobs.fail(completeJob.jobId, 'no'),
    (error) => error instanceof ContractError && error.code === 'STALE_COMPLETION'
  );

  const cancelQueued = jobs.enqueue(spec());
  const requested = jobs.requestCancel(cancelQueued.jobId);
  assert.equal(requested.status, JOB_STATUS.QUEUED);
  assert.throws(
    () => jobs.acknowledgeCancel(cancelQueued.jobId),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
  const runningCancel = jobs.start(cancelQueued.jobId);
  assert.equal(runningCancel.status, JOB_STATUS.RUNNING);
  const cancelled = jobs.acknowledgeCancel(cancelQueued.jobId);
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.throws(
    () => jobs.acknowledgeCancel(cancelQueued.jobId),
    (error) => error instanceof ContractError && error.code === 'STALE_COMPLETION'
  );
  assert.throws(
    () => jobs.start(cancelQueued.jobId),
    (error) => error instanceof ContractError && error.code === 'INVALID_JOB_TRANSITION'
  );
});

test('JobManager source does not import StateStore or apply World State patches', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'public', 'spatial-v2', 'jobs', 'job-manager.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /createStateStore/);
  assert.doesNotMatch(source, /applyPatch/);
  assert.doesNotMatch(source, /state-store/);
});
