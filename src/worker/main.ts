import { getJobs } from '@/platform/jobs';
import { log } from '@/platform/log';

// The worker role of the app's image: it works the jobs the web process sends (e-mails, events),
// the messages waiting to leave, and the day's usage.
const jobs = getJobs(true);
await jobs.start();
log.info('working the jobs');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void jobs.stop().then(() => process.exit(0));
  });
}
