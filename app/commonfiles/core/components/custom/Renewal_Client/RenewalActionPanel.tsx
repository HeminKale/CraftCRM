'use client';

import React, { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';

interface Props {
  recordId: string;
  recordData: Record<string, any>;
  objectId: string;
  currentUserRole: string;
  currentCustomRole: string | null;
  currentUserId: string;
  tenantId?: string;
  onActionComplete: () => void;
}

type Mode = 'idle' | 'rejecting';

export default function RenewalActionPanel({
  recordId,
  recordData,
  currentUserRole,
  currentCustomRole,
  currentUserId,
  onActionComplete,
}: Props) {
  const supabase = createClientComponentClient();
  const [mode, setMode]             = useState<Mode>('idle');
  const [notes, setNotes]           = useState('');
  const [processing, setProcessing] = useState(false);

  const status        = recordData['status__a'] as string | null ?? null;
  const clientUserId  = recordData['client_user_id__a'];
  const isAdmin       = currentUserRole === 'admin';
  const isCRM         = isAdmin || lower(currentCustomRole).includes('crm');
  // External Client: strictly the linked user, never CRM/admin
  const isExternalClient = !isCRM && currentUserId === clientUserId;
  const rejectionNotes   = recordData['rejection_notes__a'];

  // Check file presence to detect upload even if status didn't auto-advance
  const hasFile = (key: string) => {
    const v = recordData[key];
    if (!v) return false;
    if (typeof v === 'string') return v !== 'null' && v !== '{}' && v !== '[]' && v !== '';
    if (typeof v === 'object') {
      return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
    }
    return false;
  };

  const intimationUploaded = hasFile('surveillance_intimation_letter__a');
  const auditPlanUploaded  = hasFile('surveillance_audit_plan__a');

  // ── CRM panels: instruction only (upload happens via FileUploadField on record) ──
  // Same pattern as External Client — CRM uploads through the field, not through this panel
  const showIntimationPrompt = isCRM && !status && !intimationUploaded;
  const showAuditPlanPrompt  = isCRM && status === 'Intimation_Accepted' && !auditPlanUploaded;
  const showCompletionPrompt = isCRM && status === 'Audit_Plan_Accepted';

  // ── External Client panels: accept / reject ──
  const showIntimationReview = isExternalClient && status === 'Intimation_Sent';
  const showAuditPlanReview  = isExternalClient && status === 'Audit_Plan_Sent';

  const anyVisible = showIntimationPrompt || showAuditPlanPrompt || showCompletionPrompt ||
                     showIntimationReview || showAuditPlanReview;

  if (!anyVisible) {
    if (rejectionNotes && isCRM) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Rejection Notes</p>
          <p className="text-sm text-red-800">{rejectionNotes}</p>
        </div>
      );
    }
    return null;
  }

  // ── Client accept/reject ──────────────────────────────────────
  const handleReview = async (rpc: string, action: 'accept' | 'reject') => {
    if (action === 'reject' && mode === 'idle') { setMode('rejecting'); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc(rpc, {
        p_record_id: recordId,
        p_action:    action,
        p_notes:     action === 'reject' ? notes.trim() || null : null,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setMode('idle');
      setNotes('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  // ── Rejection form ────────────────────────────────────────────
  if (mode === 'rejecting') {
    const rpc = status === 'Intimation_Sent'
      ? 'review_surveillance_intimation'
      : 'review_surveillance_audit_plan';
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4 space-y-3">
        <p className="text-sm font-semibold text-red-900">Reject — add a reason</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Optional reason..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-red-500 focus:border-red-500"
        />
        <div className="flex gap-2">
          <button onClick={() => handleReview(rpc, 'reject')} disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
            {processing ? 'Processing...' : 'Confirm Reject'}
          </button>
          <button onClick={() => { setMode('idle'); setNotes(''); }} disabled={processing}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-4">

      {/* ── CRM: Upload Intimation Letter (instruction — use field below) ── */}
      {showIntimationPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Surveillance Intimation Letter</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Upload the intimation letter using the <strong>Surveillance Intimation Letter</strong> field below.
                Status will advance to <em>Intimation Sent</em> automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {rejectionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Previous rejection: </span>{rejectionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── External Client: Review Intimation Letter ── */}
      {showIntimationReview && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Surveillance Intimation</p>
              <p className="text-xs text-purple-600 mt-0.5">
                Please review the surveillance intimation letter and accept or reject.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
          {rejectionNotes && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Previous rejection: </span>{rejectionNotes}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => handleReview('review_surveillance_intimation', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_surveillance_intimation', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM: Upload Audit Plan (instruction) ── */}
      {showAuditPlanPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Surveillance Audit Plan</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Intimation accepted. Upload the audit plan using the <strong>Surveillance Audit Plan</strong> field below.
                Status will advance to <em>Audit Plan Sent</em> automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Next Step
            </span>
          </div>
        </div>
      )}

      {/* ── External Client: Review Audit Plan ── */}
      {showAuditPlanReview && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Surveillance Audit Plan</p>
              <p className="text-xs text-purple-600 mt-0.5">
                Please review the audit plan and accept or reject.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
          {rejectionNotes && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Previous rejection: </span>{rejectionNotes}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => handleReview('review_surveillance_audit_plan', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_surveillance_audit_plan', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM: Completion prompt ── */}
      {showCompletionPrompt && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-900">Complete Renewal</p>
              <p className="text-xs text-green-600 mt-0.5">
                Audit plan accepted. Upload the <strong>Surveillance Audit Report</strong> and{' '}
                <strong>Surveillance Certificates</strong> using the fields below, then enter the audit date.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 shrink-0 ml-3">
              Final Step
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function lower(s: string | null | undefined) { return (s || '').toLowerCase(); }
