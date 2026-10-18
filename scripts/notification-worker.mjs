// Hostinger VPS scheduler entry point. This script is not run during tests/build.
// Keep credentials in a protected systemd EnvironmentFile, never command arguments.
if (process.env.EMAIL_DELIVERY_ENABLED !== 'true') process.exit(0);
const secret = process.env.NOTIFICATION_WORKER_SECRET;
const origin = process.env.NOTIFICATION_APP_ORIGIN || 'http://127.0.0.1:3000';
if (!secret || secret.length < 32) {
  console.error('Notification worker configuration missing');
  process.exit(1);
}
try {
  const url = new URL('/api/notifications/worker', origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('origin');
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(90000), redirect: 'error',
  });
  if (!response.ok) throw new Error('worker');
  const result = await response.json();
  if (!result.success) throw new Error('worker');
  console.log(result.processed ? 'Notification worker processed one queue item' : 'Notification worker queue idle');
} catch {
  console.error('Notification worker unavailable; inspect notification audit and server configuration');
  process.exitCode = 1;
}
