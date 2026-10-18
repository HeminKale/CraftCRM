// Server worker only. Injected boundaries allow tests with no provider traffic.
import { createHash } from 'node:crypto';
export const emailAddress = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export type DeliveryConfig = { key: string; from: string; appUrl: string; replyTo?: string; mode: string; testRecipients: string[] };

export function deliveryConfig(env: NodeJS.ProcessEnv = process.env): DeliveryConfig {
  if (env.EMAIL_DELIVERY_ENABLED !== 'true') throw new Error('delivery_disabled');
  if (!env.RESEND_API_KEY || !emailAddress.test(env.RESEND_FROM_ADDRESS || '')) throw new Error('sender_unconfigured');
  const app = new URL(env.EMAIL_APP_URL || env.NEXT_PUBLIC_APP_URL || '');
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('https_app_origin_required');
  if (env.RESEND_REPLY_TO && !emailAddress.test(env.RESEND_REPLY_TO)) throw new Error('invalid_reply_to');
  const mode = env.EMAIL_DELIVERY_MODE || 'test';
  const testRecipients = (env.EMAIL_TEST_RECIPIENTS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!['test', 'live'].includes(mode) || (mode === 'test' && !testRecipients.length)) throw new Error('delivery_mode_unconfigured');
  return { key: env.RESEND_API_KEY, from: env.RESEND_FROM_ADDRESS!, appUrl: app.origin, replyTo: env.RESEND_REPLY_TO, mode, testRecipients };
}

export function buildNotice(job: any, config: DeliveryConfig, attachment?: { filename: string; content: string }) {
  if (!emailAddress.test(job.recipient || '')) throw new Error('invalid_record_recipient');
  const context = job.context || {};
  let subject: string, html: string;
  if (job.notice_kind === 'invitation') {
    if (job.object_name !== 'user_invitations' || !context.token) throw new Error('invalid_invitation');
    const link = `${config.appUrl}/invite?token=${encodeURIComponent(context.token)}`;
    subject = 'Invitation to your certification portal';
    html = `<p>You have been invited to the certification portal.</p><p>Role: ${escape(context.role)}</p><p><a href="${escape(link)}">Set up your account</a></p><p>This link expires at the time recorded on your invitation.</p>`;
  } else {
    if (!['renewal_clients__a', 'recertification_clients__a'].includes(job.object_name) || !['record_created', 'intimation', 'nonresponse_reminder', 'nonresponse_suspension'].includes(job.notice_kind)) throw new Error('unsupported_notice');
    if (job.notice_kind === 'nonresponse_suspension') {
      if (job.object_name !== 'renewal_clients__a' || job.notice_round !== 3 || !context.case_id || !attachment) throw new Error('unsupported_suspension_notice');
      subject = `Suspension letter — ${String(context.company || 'your organization').replace(/[\r\n]/g, ' ')}`;
      html = `<p>Dear ${escape(context.contact || 'Sir/Madam')},</p><p>The suspension letter for <strong>${escape(context.company || 'your organization')}</strong> is attached.</p><p>Contact CRM about a late response or restoration. Email delivery does not record a software response.</p>`;
      return { from: config.from, to: job.recipient, subject, html, ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        attachments: [attachment], tags: [{ name: 'notification_id', value: job.id }] };
    }
    if (job.notice_kind === 'nonresponse_reminder') {
      if (job.object_name !== 'renewal_clients__a' || job.notice_round !== 2 || !context.response_due_at || !attachment) throw new Error('invalid_second_notice');
      const deadline = new Date(context.response_due_at);
      if (!Number.isFinite(deadline.getTime())) throw new Error('invalid_deadline');
      subject = `Second Surveillance notice — ${String(context.company || 'your organization').replace(/[\r\n]/g, ' ')}`;
      html = `<p>Dear ${escape(context.contact || 'Sir/Madam')},</p><p>No software response is recorded to the Surveillance intimation for <strong>${escape(context.company || 'your organization')}</strong>. This is the second notice; the original intimation letter is attached.</p>` +
        `<p>Please respond in the portal by ${escape(deadline.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST. Continued non-response after this further 10-day window leads to suspension.</p>` +
        `<p><a href="${escape(config.appUrl)}">Open your portal</a> to record your software response. Email replies do not count as a software response.</p>`;
      return { from: config.from, to: job.recipient, subject, html, ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        attachments: [attachment], tags: [{ name: 'notification_id', value: job.id }] };
    }
    const workflow = job.object_name === 'renewal_clients__a' ? 'Surveillance' : 'Recertification';
    subject = `${workflow} ${job.notice_kind === 'intimation' ? 'audit intimation' : 'record created'} — ${String(context.company || 'your organization').replace(/[\r\n]/g, ' ')}`;
    if (job.notice_kind === 'intimation' && !attachment) throw new Error('required_attachment_unavailable');
    html = `<p>Dear ${escape(context.contact || 'Sir/Madam')},</p><p>${workflow} ${job.notice_kind === 'intimation' ? 'audit intimation' : 'record created'} for <strong>${escape(context.company || 'your organization')}</strong>.</p>` +
      (attachment ? '<p>The intimation letter is attached.</p>' : '<p>The intimation letter will follow separately.</p>') +
      `<p><a href="${escape(config.appUrl)}">Open your portal</a> to review the record and use the available software response actions. An email reply does not record acceptance or rejection in the software.</p>`;
  }
  return { from: config.from, to: job.recipient, subject, html,
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    ...(attachment ? { attachments: [attachment] } : {}), tags: [{ name: 'notification_id', value: job.id }],
  };
}

export async function rpc(client: any, name: string, params: any = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error('notification_persistence_failed');
  return data;
}

export async function deliverOne(client: any, config: DeliveryConfig, send: typeof fetch = fetch) {
  await rpc(client, 'release_suspension_letter'); // No-op until an operator activates a tenant's template.
  const job = await rpc(client, 'claim_notification');
  if (!job) return false;
  if (job.skipped) return true;
  const base = { p_id: job.id, p_lease: job.lease_token };
  const finish = (provider: string | null, error: string | null, retry = false, retryAfter = 0) => rpc(client, 'finish_notification', {
    ...base, p_provider: provider, p_error: error, p_retry: retry, p_retry_after: retryAfter,
  });
  // Test mode never redirects a customer's notice to another inbox.
  if (config.mode === 'test' && !config.testRecipients.includes(job.recipient)) {
    await finish(null, 'test_recipient_not_approved', true, 3600); return true;
  }
  let payload = job.payload;
  if (!payload) {
    let attachment;
    if (job.notice_kind === 'nonresponse_suspension') {
      let letter: Buffer;
      try {
        const file = await rpc(client, 'suspension_docx_for_notice', base);
        if (!file || file.bucket !== 'notification-templates') throw new Error('template_unavailable');
        const { data, error } = await client.storage.from(file.bucket).download(file.path);
        if (error || !data || data.size > 2 * 1024 * 1024) throw new Error('template_unavailable');
        const bytes = Buffer.from(await data.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('template_changed');
        const { personalizeSuspensionDocx } = await import('./suspensionDocx');
        letter = await personalizeSuspensionDocx(bytes, file.values);
      } catch { await finish(null, 'required_docx_template_unavailable', true); return true; }
      try {
        const { convertSuspensionDocxToPdf } = await import('./suspensionPdf');
        const pdf = await convertSuspensionDocxToPdf(letter);
        attachment = { filename: `suspension-${job.record_id}.pdf`, content: pdf.toString('base64'), content_type: 'application/pdf' };
      } catch { await finish(null, 'suspension_pdf_conversion_failed', true); return true; }
    } else if (job.attachment_id) {
      try {
        const file = await rpc(client, 'notification_attachment', base);
        if (!file || file.size > 10 * 1024 * 1024) throw new Error('invalid_attachment');
        const { data, error } = await client.storage.from(file.bucket).download(file.path);
        if (error || !data || data.size > 10 * 1024 * 1024) throw new Error('invalid_attachment');
        attachment = { filename: String(file.name || 'intimation.pdf').replace(/[\r\n]/g, ''), content: Buffer.from(await data.arrayBuffer()).toString('base64') };
      } catch { await finish(null, 'required_attachment_unavailable', true); return true; }
    }
    try { payload = buildNotice(job, config, attachment); }
    catch { await finish(null, 'invalid_notice_payload'); return true; }
  }
  if (job.notice_kind === 'nonresponse_suspension') {
    try {
      const { validateSuspensionPdfPayload } = await import('./suspensionPdf');
      await validateSuspensionPdfPayload(payload, job.record_id);
    } catch { await finish(null, 'suspension_pdf_required'); return true; }
  }
  // Persist immutable payload before sending; retries reuse sender/body/bytes.
  payload = await rpc(client, 'prepare_notification', { ...base, p_payload: payload });
  if (!payload) return true; // Record/invitation/revision changed while preparing.
  if (job.notice_kind === 'nonresponse_suspension') {
    // Persistence may return an older immutable payload. Never send a saved DOCX.
    try {
      const { validateSuspensionPdfPayload } = await import('./suspensionPdf');
      await validateSuspensionPdfPayload(payload, job.record_id);
    } catch { await finish(null, 'suspension_pdf_required'); return true; }
  }
  let response: Response;
  try {
    response = await send('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `craft-notice/${job.id}` },
      body: JSON.stringify(payload),
    });
  } catch { await finish(null, 'provider_outcome_unknown', true); return true; }
  const result = await response.json().catch(() => ({})) as any;
  if (response.ok && typeof result.id === 'string' && result.id.length > 0) await finish(result.id, null);
  else {
    const retry = response.ok || response.status === 408 || response.status === 429 || response.status >= 500 ||
      (response.status === 409 && result.name === 'concurrent_idempotent_requests');
    const header = response.headers.get('retry-after');
    const after = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 0;
    await finish(null, response.ok ? 'provider_outcome_unknown' : `provider_http_${response.status}`, retry, Number.isFinite(after) ? after : 0);
  }
  return true;
}
