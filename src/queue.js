/**
 * In-Memory Non-Blocking Job Queue
 * Handles CPU-heavy tasks (reports, PDF export, batch validation)
 * without blocking Express HTTP event loop.
 */
const crypto = require('crypto');

class MemoryQueue {
  constructor(concurrency = 4) {
    this.concurrency = concurrency;
    this.queue = [];
    this.activeWorkers = 0;
    this.jobs = new Map(); // jobId -> status & result
    this.stats = { completed: 0, failed: 0, processedTotal: 0 };
  }

  enqueue(type, payload, handler) {
    const id = 'job_' + crypto.randomBytes(6).toString('hex');
    const job = {
      id,
      type,
      payload,
      handler,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };

    this.jobs.set(id, job);
    this.queue.push(job);
    this.processNext();
    return id;
  }

  getJob(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      durationMs: job.finishedAt ? job.finishedAt - job.startedAt : null,
      result: job.result,
      error: job.error,
    };
  }

  processNext() {
    if (this.activeWorkers >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    this.activeWorkers++;
    job.status = 'processing';
    job.startedAt = Date.now();

    // Use setImmediate to release event loop slice
    setImmediate(async () => {
      try {
        job.result = await job.handler(job.payload);
        job.status = 'completed';
        this.stats.completed++;
      } catch (err) {
        job.error = err.message || 'Job execution failed';
        job.status = 'failed';
        this.stats.failed++;
      } finally {
        job.finishedAt = Date.now();
        this.stats.processedTotal++;
        this.activeWorkers--;

        // Clean up old job metadata if map gets too large (> 50,000 jobs)
        if (this.jobs.size > 50000) {
          const oldest = this.jobs.keys().next().value;
          this.jobs.delete(oldest);
        }

        this.processNext();
      }
    });
  }

  getStats() {
    return {
      queued: this.queue.length,
      activeWorkers: this.activeWorkers,
      completed: this.stats.completed,
      failed: this.stats.failed,
      totalTracked: this.jobs.size,
    };
  }
}

module.exports = new MemoryQueue();
