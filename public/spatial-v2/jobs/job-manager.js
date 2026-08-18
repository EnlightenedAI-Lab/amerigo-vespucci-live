/**
 * JobManager owns QUEUED → RUNNING → COMPLETE | FAILED | CANCELLED.
 * Completion never mutates World State. ResultCommitter is the only writer.
 */

import {
  JOB_STATUS,
  JOB_TARGET,
  TERMINAL_JOB_STATUSES,
  createJob
} from '../foundation/contracts/job.js';
import {
  createId,
  failClosed,
  frozenClone,
  isoNow
} from '../foundation/contracts/validate.js';

function isTerminal(status) {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function createJobManager(options = {}) {
  const now = options.now;
  const idFactory = options.idFactory;
  const jobs = new Map();
  const listeners = new Set();

  function write(job) {
    const next = createJob(job, { now });
    jobs.set(next.jobId, next);
    for (const listener of listeners) {
      try {
        listener(frozenClone(next));
      } catch (error) {
        console.warn('[IQAI V2] JobManager listener failed', error);
      }
    }
    return frozenClone(next);
  }

  function requireJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) failClosed('UNKNOWN_JOB', 'Job is not registered.', { jobId });
    return job;
  }

  return Object.freeze({
    enqueue(input) {
      const jobId = input.jobId || createId('job', idFactory);
      if (jobs.has(jobId)) {
        failClosed('DUPLICATE_JOB', 'Job id is already registered.', { jobId });
      }
      return write({
        ...input,
        jobId,
        status: JOB_STATUS.QUEUED,
        target: input.target || JOB_TARGET.LOCAL_CPU,
        progress: { current: 0, percent: 0, message: 'QUEUED', updatedAt: isoNow(now) },
        cancelRequested: false,
        backendAckedCancel: false,
        receipts: [`queued:${jobId}`]
      });
    },
    start(jobId) {
      const job = requireJob(jobId);
      if (job.status !== JOB_STATUS.QUEUED) {
        failClosed('INVALID_JOB_TRANSITION', 'Only QUEUED jobs may enter RUNNING.', {
          jobId,
          status: job.status
        });
      }
      return write({
        ...job,
        status: JOB_STATUS.RUNNING,
        updatedAt: isoNow(now),
        progress: { ...job.progress, message: 'RUNNING', updatedAt: isoNow(now) },
        receipts: [...job.receipts, `running:${jobId}`]
      });
    },
    progress(jobId, progress) {
      const job = requireJob(jobId);
      if (job.status !== JOB_STATUS.RUNNING) {
        failClosed('INVALID_JOB_TRANSITION', 'PROGRESS is a RUNNING update, not a job status.', {
          jobId,
          status: job.status
        });
      }
      return write({
        ...job,
        updatedAt: isoNow(now),
        progress: { ...job.progress, ...progress, updatedAt: isoNow(now) }
      });
    },
    requestCancel(jobId) {
      const job = requireJob(jobId);
      if (isTerminal(job.status)) {
        failClosed('INVALID_JOB_TRANSITION', 'Terminal jobs cannot be cancelled.', {
          jobId,
          status: job.status
        });
      }
      if (job.cancelRequested) {
        failClosed('INVALID_JOB_TRANSITION', 'Cancel was already requested.', { jobId });
      }
      return write({
        ...job,
        cancelRequested: true,
        updatedAt: isoNow(now),
        receipts: [...job.receipts, `cancel-requested:${jobId}`]
      });
    },
    acknowledgeCancel(jobId) {
      const job = requireJob(jobId);
      if (isTerminal(job.status)) {
        failClosed('STALE_COMPLETION', 'Terminal jobs cannot ACK cancel again.', {
          jobId,
          status: job.status
        });
      }
      if (job.status !== JOB_STATUS.RUNNING) {
        failClosed('INVALID_JOB_TRANSITION', 'Only RUNNING jobs may become CANCELLED after backend ACK.', {
          jobId,
          status: job.status
        });
      }
      if (!job.cancelRequested) {
        failClosed('INVALID_JOB_TRANSITION', 'Backend cannot ACK cancel without a request.', { jobId });
      }
      return write({
        ...job,
        status: JOB_STATUS.CANCELLED,
        backendAckedCancel: true,
        updatedAt: isoNow(now),
        receipts: [...job.receipts, `cancelled:${jobId}`]
      });
    },
    complete(jobId, { resultRef, receipt } = {}) {
      const job = requireJob(jobId);
      if (isTerminal(job.status)) {
        failClosed('STALE_COMPLETION', 'Terminal jobs cannot complete again.', {
          jobId,
          status: job.status
        });
      }
      if (job.status !== JOB_STATUS.RUNNING) {
        failClosed('INVALID_JOB_TRANSITION', 'Only RUNNING jobs may complete.', {
          jobId,
          status: job.status
        });
      }
      if (job.cancelRequested) {
        failClosed('INVALID_JOB_TRANSITION', 'Cancel-requested jobs must ACK cancel, not complete.', { jobId });
      }
      return write({
        ...job,
        status: JOB_STATUS.COMPLETE,
        resultRef: resultRef || null,
        updatedAt: isoNow(now),
        progress: { ...job.progress, percent: 100, message: 'COMPLETE', updatedAt: isoNow(now) },
        receipts: [...job.receipts, receipt || `complete:${jobId}`]
      });
    },
    fail(jobId, error) {
      const job = requireJob(jobId);
      if (isTerminal(job.status)) {
        failClosed('STALE_COMPLETION', 'Terminal jobs cannot fail again.', { jobId, status: job.status });
      }
      if (job.status !== JOB_STATUS.RUNNING) {
        failClosed('INVALID_JOB_TRANSITION', 'QUEUED jobs cannot fail. Only RUNNING jobs may fail.', {
          jobId,
          status: job.status
        });
      }
      return write({
        ...job,
        status: JOB_STATUS.FAILED,
        error: String(error || 'Job failed.'),
        updatedAt: isoNow(now),
        receipts: [...job.receipts, `failed:${jobId}`]
      });
    },
    get(jobId) {
      const job = jobs.get(jobId);
      return job ? frozenClone(job) : null;
    },
    list() {
      return [...jobs.values()].map((job) => frozenClone(job));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
