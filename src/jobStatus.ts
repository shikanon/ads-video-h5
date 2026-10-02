import type { Job } from './types';

export function isActiveJob(job: Pick<Job, 'status'>) {
  return job.status === 'queued' || job.status === 'running' || job.status === 'stopping';
}
