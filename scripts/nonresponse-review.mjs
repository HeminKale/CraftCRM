// Optional operator evidence review. Never enables notices or suspension.
if (process.env.NONRESPONSE_REVIEW_ENABLED !== 'true') process.exit(0);
const secret = process.env.NOTIFICATION_WORKER_SECRET;
const origin = process.env.NOTIFICATION_APP_ORIGIN || 'http://127.0.0.1:3000';
try {
  if (!secret || secret.length < 32) throw new Error('configuration');
  const url = new URL('/api/notifications/nonresponse-review', origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('origin');
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new Error('review');
  const result = await response.json();
  if (!result.success || result.automation_enabled !== false) throw new Error('review');
  console.log(result.processed ? 'Non-response evidence reviewed; automation remains disabled' : 'Non-response evidence review idle');
} catch {
  console.error('Non-response evidence review unavailable; inspect server configuration');
  process.exitCode = 1;
}
