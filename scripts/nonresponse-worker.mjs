// Future operator entry point only. Never run or enable against live data in QA.
if (process.env.NONRESPONSE_AUTOMATION_ENABLED !== 'true') process.exit(0);
const secret = process.env.NOTIFICATION_WORKER_SECRET;
try {
  if (!secret || secret.length < 32) throw new Error('configuration');
  const url = new URL('/api/notifications/nonresponse-worker', process.env.NOTIFICATION_APP_ORIGIN || 'http://127.0.0.1:3000');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('origin');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !(await response.json()).success) throw new Error('worker');
  console.log('Non-response worker completed one bounded check');
} catch {
  console.error('Non-response worker unavailable; inspect the private transition audit');
  process.exitCode = 1;
}
