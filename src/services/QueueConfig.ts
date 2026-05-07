import IORedis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

export const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const WORKFLOW_QUEUE_NAME = 'job-workflow-queue';

export const defaultJobOptions = {
  attempts: 10,
  backoff: {
    type: 'fixed',
    delay: 30000,
  },
  removeOnComplete: true,
};
