'use client';
import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const labels: Record<string, string> = {
  queued: 'Queued', sending: 'Submitting to provider', retry: 'Retry scheduled',
  accepted: 'Accepted by email provider', delivered: 'Delivered to recipient mail server',
  delayed: 'Delivery delayed', bounced: 'Bounced', failed: 'Failed', complained: 'Reported as spam',
  suppressed: 'Suppressed by provider', blocked: 'Blocked — action required',
  cancelled: 'Superseded or cancelled', review: 'Manual review required — automatic sending stopped',
};
const date = (value: string) => `${new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;

const holdLabels: Record<string, string> = {
  policy_unapproved: 'Deadline and response policy awaiting confirmation',
  letter_template_pending: 'Approved notice/letter template pending',
  missing_record_email: 'Record email missing; excluded from automation',
  current_notice_untracked: 'Current letter has no tracked notice',
  recipient_changed: 'Record email changed since this notice was queued',
  replacement_policy_pending: 'Replacement letter needs an approved deadline rule',
  delivery_policy_pending: 'Notice delivery state needs an approved deadline rule',
  software_response_recorded: 'Software response recorded; review its effect under the approved policy',
  checkpoint_not_awaiting_response: 'Workflow is not awaiting intimation response',
  linked_client_unavailable: 'Linked External Client unavailable in this tenant',
  legacy_case_requires_review: 'Earlier case requires review before timing can be enabled',
  reject_ba_pending: 'Software Reject recorded — direct suspension awaits BA confirmation',
  late_response_crm: 'Late software response recorded for CRM; suspension remains active',
  linked_client_changed: 'Linked client changed; CRM review required',
  suspension_letter_template_pending: 'Suspension letter awaits the shared template',
};

export default function NotificationDeliveryPanel({ objectName, recordId, refresh }: { objectName?: string; recordId: string; refresh: number }) {
  const [data, setData] = useState<any>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [reviewUnavailable, setReviewUnavailable] = useState(false);
  const supported = ['renewal_clients__a', 'recertification_clients__a'].includes(objectName || '');
  useEffect(() => {
    if (!supported) return;
    let active = true;
    setData(null); setUnavailable(false); setReview(null); setReviewUnavailable(false);
    const load = async () => {
      const { data, error } = await createClientComponentClient().rpc('get_record_notifications', { p_object: objectName, p_record: recordId });
      if (active) { setData(error ? null : data); setUnavailable(!!error); }
      if (objectName === 'renewal_clients__a' && !error) {
        const result = await createClientComponentClient().rpc('get_record_nonresponse', { p_object: objectName, p_record: recordId });
        if (active) { setReview(result.error ? null : result.data); setReviewUnavailable(!!result.error); }
      }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [objectName, recordId, refresh, supported]);
  if (!supported) return null;
  return <section className="rounded border border-gray-200 bg-gray-50 p-3 text-sm" aria-label="Email delivery and software responses">
    <h3 className="font-semibold">Email delivery and software responses</h3>
    <p className="text-gray-600">Upload success, email delivery and software Accept/Reject are tracked separately. Email replies do not record a software response.</p>
    {unavailable ? <p>Delivery history unavailable for this session.</p> : !data ? <p>Loading delivery history…</p> : <>
      {!data.notices?.length && <p>No tracked notice. Historical workflow dates are not delivery evidence.</p>}
      {data.notices?.map((n: any) => <div key={n.id} className="mt-2 border-t pt-2">
        <p><strong>{n.kind === 'record_created' ? 'Record creation alert' : n.kind === 'nonresponse_suspension' ? 'Suspension letter' : n.kind === 'nonresponse_reminder' ? 'Second non-response notice' : `Intimation — round ${n.round}`}</strong>: {labels[n.state] || n.state}</p>
        {n.error === 'suspension_template_pending' && <p>Shared suspension-letter template pending; this letter has not been sent.</p>}
        <p>Queued: {date(n.queued_at)}{n.upload_finalized_at && ` · Letter finalised: ${date(n.upload_finalized_at)}`}</p>
        {n.accepted_at && <p>Provider accepted: {date(n.accepted_at)}</p>}
        {n.delivered_at && <p>Recipient mail server delivery: {date(n.delivered_at)}</p>}
        {n.failed_at && <p>Failure/bounce recorded: {date(n.failed_at)}</p>}
        {n.provider_id && <p>Provider message: <code>{n.provider_id}</code></p>}
        <p>Attempts: {n.attempts} · Reference: <code>{n.id}</code></p>
      </div>)}
      {objectName === 'renewal_clients__a'
        ? <p className="mt-2">Software intimation responses: {data.responses?.length ? data.responses.map((r: any) => `${r.action === 'accept' ? 'Accepted' : 'Rejected'} at ${date(r.acted_at)}`).join('; ') : 'No tracked intimation response'}</p>
        : <p className="mt-2">Recertification software responses are recorded through the workflow actions. There is no separate intimation Accept/Reject action.</p>}
      <p className="text-gray-600">{!review?.deadline_start_at && 'Response deadline has not been started. '}Delivery to a mail server does not prove the message was read.</p>
      {objectName === 'renewal_clients__a' && <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3" aria-label="Non-response review">
        <h4 className="font-semibold">{review?.suspended_at ? 'Suspended — no software response' : review?.automation_enabled ? 'Non-response deadline tracking' : 'Non-response automation: disabled'}</h4>
        <p>30 calendar days from the original intimation upload, then 10 days from the second notice, at the same IST clock time. Delivery outcomes, replacement letters and email corrections do not reset the timer.</p>
        {reviewUnavailable ? <p>Non-response history unavailable for this session.</p> : review?.in_scope ? <>
          <p>First deadline: {review.first_deadline_at ? date(review.first_deadline_at) : 'not started'} · Final deadline: {review.final_deadline_at ? date(review.final_deadline_at) : 'not started'}{!review.automation_enabled && ' · Automatic suspension: disabled'}</p>
          {review.deadline_start_at && <p>Original intimation finalised: {date(review.deadline_start_at)}</p>}
          {review.second_notice_issued_at && <p>Second notice created: {date(review.second_notice_issued_at)}</p>}
          {review.suspended_at && <p>External Client suspended: {date(review.suspended_at)}. Late responses are for CRM review; restoration is not automatic.</p>}
          {review.last_checked_at ? <p>Evidence last reviewed: {date(review.last_checked_at)}</p> : <p>No enrolled non-response case. Historical records are not automatically enrolled.</p>}
          {review.evidence?.source_notice_id && <p>Source notice: <code>{review.evidence.source_notice_id}</code></p>}
          {review.evidence?.holds?.length > 0 && <ul className="list-disc pl-5">{review.evidence.holds.map((hold: string) => <li key={hold}>{holdLabels[hold] || hold}</li>)}</ul>}
          {!!review.audit?.length && <details className="mt-2"><summary>Evidence review history</summary>
            <p>Latest 20 evidence changes. Provider events and software responses remain separate above.</p>
            {review.audit.map((a: any) => <div key={a.id} className="mt-2 border-t border-amber-200 pt-2">
              <p>{date(a.observed_at)} · {a.worker} · {a.evidence?.outcome || 'Policy hold'} · {a.policy_version}</p>
              {a.actor_id && <p>Actor: <code>{a.actor_id}</code></p>}
              {a.evidence?.holds?.length > 0 && <p>{a.evidence.holds.map((hold: string) => holdLabels[hold] || hold).join('; ')}</p>}
            </div>)}
          </details>}
          {!!review.transitions?.length && <details className="mt-2"><summary>Deadline and suspension transitions</summary>
            {review.transitions.map((a: any) => <p key={a.id}>{date(a.occurred_at)} · {a.outcome.replace(/_/g, ' ')} · {a.worker} · Source <code>{a.evidence?.source_notice_id}</code></p>)}
          </details>}
        </> : <p>Loading non-response evidence…</p>}
      </div>}
    </>}
  </section>;
}
