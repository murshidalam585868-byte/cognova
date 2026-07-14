/**
 * src/lib/queue/redis.ts
 * BullMQ queue and worker setup for async job processing.
 * Used for background tasks: digest generation, memory embedding, email sends.
 */

import { Queue, Worker, Job, RedisOptions } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Redis Connection
// ---------------------------------------------------------------------------

let redisConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (redisConnection) return redisConnection;

  const config = loadConfig();
  const redisUrl = config.redisUrl || 'redis://localhost:6379';

  redisConnection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,    // Required by BullMQ
  });

  redisConnection.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  redisConnection.on('connect', () => {
    logger.info('Redis connected');
  });

  return redisConnection;
}

// ---------------------------------------------------------------------------
// BullMQ Queue
// ---------------------------------------------------------------------------

export const QUEUE_NAMES = {
  TASKS: 'shadow-brain-tasks',
  DIGESTS: 'shadow-brain-digests',
  MEMORY: 'shadow-brain-memory',
  EMAIL: 'shadow-brain-email',
} as const;

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (queues.has(name)) return queues.get(name)!;

  const connection = getRedisConnection();
  const queue = new Queue(name, { connection });
  queues.set(name, queue);

  logger.info('BullMQ queue initialized', { queue: name });
  return queue;
}

// ---------------------------------------------------------------------------
// Job Enqueuing
// ---------------------------------------------------------------------------

export interface TaskJobData {
  type: string;
  payload: Record<string, unknown>;
  userId?: string;
}

export async function addTaskJob(data: TaskJobData, delayMs?: number): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.TASKS);
  const job = await queue.add(data.type, data, {
    delay: delayMs,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  logger.info('Task job enqueued', { jobId: job.id, type: data.type });
  return job;
}

export async function addDigestJob(
  userId: string,
  digestType: 'daily' | 'weekly',
  delayMs?: number
): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.DIGESTS);
  const job = await queue.add('generate-digest', { userId, digestType }, {
    delay: delayMs,
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
  });
  logger.info('Digest job enqueued', { jobId: job.id, userId, digestType });
  return job;
}

export async function addMemoryJob(
  userId: string,
  conversationId: string
): Promise<Job> {
  const queue = getQueue(QUEUE_NAMES.MEMORY);
  const job = await queue.add('extract-memory', { userId, conversationId }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
  });
  logger.info('Memory job enqueued', { jobId: job.id, userId, conversationId });
  return job;
}

// ---------------------------------------------------------------------------
// Worker Factory
// ---------------------------------------------------------------------------

export type JobProcessor<T = unknown> = (job: Job<T>) => Promise<unknown>;

export function createWorker(
  queueName: string,
  processor: JobProcessor,
  concurrency = 5
): Worker {
  const connection = getRedisConnection();

  const worker = new Worker(
    queueName,
    async (job) => {
      logger.info('Processing job', { jobId: job.id, queue: queueName, type: job.name });
      try {
        const result = await processor(job);
        logger.info('Job completed', { jobId: job.id, queue: queueName });
        return result;
      } catch (err) {
        logger.error('Job failed', { jobId: job.id, queue: queueName, error: (err as Error).message });
        throw err;
      }
    },
    { connection, concurrency }
  );

  worker.on('failed', (job, err) => {
    logger.error('Worker job failed', {
      jobId: job?.id,
      queue: queueName,
      error: err.message,
    });
  });

  logger.info('BullMQ worker created', { queue: queueName, concurrency });
  return worker;
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

export async function closeQueuesAndWorkers(): Promise<void> {
  for (const [, queue] of queues) {
    await queue.close();
  }
  if (redisConnection) {
    await redisConnection.quit();
  }
  logger.info('Queues and Redis connections closed');
}
