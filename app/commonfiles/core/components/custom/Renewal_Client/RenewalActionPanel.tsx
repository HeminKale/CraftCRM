'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';

interface Props {
  recordId: string;
  recordData: Record<string, any>;
  objectId: string;
  currentUserRole: string;
  currentCustomRole: string | null;
  currentUserId: string;
  currentUserEmail?: string;
  tenantId?: string;
  onActionComplete: () => void;
}

type Mode = 'idle' | 'rejecting';

function lower(s: string | null | undefined): string {
  return (s || '').toLowerCase();
}

function hasFile(v: any): boolean {
  if (!v) return false;
  if (typeof v === 'string') return v !== 'null' && v !== '{}' && v !== '[]' && v !== '';
  if (typeof v === 'object') return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
  return false;
}

// File fields come back from get_object_records_with_references as a JSON
// string ({"id","name","bucket","path",...} — set by finalize_file_upload).
// Parses it defensively; returns null for anything that isn't a real
// single-file object (covers the '{}' / '[]' / already-parsed cases too).
function parseFileInfo(raw: any): { name: string; bucket: string; path: string } | null {
  if (!hasFile(raw)) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || Array.isArray(obj) || !obj.bucket || !obj.path) return null;
    return { name: obj.name || 'file', bucket: obj.bucket, path: obj.path };
  } catch {
    return null;
  }
}

// Full Surveillance 1 checkpoint chain through Certificate Issue (row 15 of
// the SURV1 rights matrix — Suspension/Withdrawal are out of scope for this
// plan, see 00_Sprint_Plan.md). Mirrors StageAuditActionPanel.tsx's shape
// throughout: one role-gated conditional block per checkpoint, generic
// accept/reject handler shared across every review panel, hard exclusion of
// the record's own linked client from any CRM/Auditor/Tech/CDC-only panel.
export default function RenewalActionPanel({
  recordId,
  recordData,
  currentUserRole,
  currentCustomRole,
  currentUserId,
  currentUserEmail,
  onActionComplete,
}: Props) {
  const supabase = createClientComponentClient();
  const [mode, setMode] = useState<Mode>('idle');
  const [rejectRpc, setRejectRpc] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [findingsNotes, setFindingsNotes] = useState('');
  const [closureNotes, setClosureNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  // ── Assign Team (Auditor / Tech Reviewer) ────────────────────────
  type TeamOption = { id: string; name: string; email: string };
  const [auditorOptions, setAuditorOptions] = useState<TeamOption[]>([]);
  const [techReviewerOptions, setTechReviewerOptions] = useState<TeamOption[]>([]);
  const [loadingTeamOptions, setLoadingTeamOptions] = useState(false);
  const [selectedAuditorId, setSelectedAuditorId] = useState('');
  const [selectedTechReviewerId, setSelectedTechReviewerId] = useState('');

  const status       = recordData['status__a'] || null;
  const clientUserId = recordData['client_user_id__a'];
  // The Surveillance 1 record's own Email field. Matching against this
  // directly (instead of only the linked External Client's client_user_id__a)
  // means a client can be recognized on this record even when the upstream
  // External Client record was never linked to a login — the two emails are
  // expected to match in practice, so this is a superset of the old check,
  // never a narrower one. Mirrored server-side in migration 287.
  const recordEmail  = lower(recordData['email__a']);
  const isEmailMatch  = !!recordEmail && recordEmail === lower(currentUserEmail);

  const isAdmin      = currentUserRole === 'admin';
  // The linked client themselves — excluding admin. Hard-excludes them from
  // ever triggering a CRM/Auditor/Tech/CDC-only panel, regardless of what
  // their custom role string happens to contain (same hardening
  // StageAuditActionPanel needed after a live bug — built in from the start
  // here instead).
  const isClientOnly = !isAdmin && (currentUserId === clientUserId || isEmailMatch);
  const isCRM         = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('crm'));
  const isAuditor     = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('auditor'));
  const isTech        = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('tech'));
  const isCdc         = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('cdc'));
  const isLinkedClient = isAdmin || currentUserId === clientUserId || isEmailMatch;

  const assignedAuditorId      = recordData['auditor_id__a'] || null;
  const assignedTechReviewerId = recordData['tech_reviewer_id__a'] || null;

  const intimationUploaded = hasFile(recordData['surveillance_intimation_letter__a']);
  const planUploaded       = hasFile(recordData['surv_audit_plan__a']);

  const rejectionNotes        = recordData['rejection_notes__a'];          // legacy intimation reject
  const planClientRemarks     = recordData['surv_plan_client_remarks__a'];
  const rcaRejectionNotes     = recordData['surv_rca_rejection_notes__a'];
  const intimationFile        = parseFileInfo(recordData['surveillance_intimation_letter__a']);

  // ── Checkpoint visibility, one per rights-matrix row ─────────────
  const showIntimationPrompt = isCRM && !status && !intimationUploaded;
  const showIntimationReview = isLinkedClient && status === 'Intimation_Sent';

  const showAssignTeamPrompt = isCRM && status === 'Intimation_Accepted';
  // Per the SURV1 rights matrix, CDC also has "view" on the assign-team row
  // (unlike External Client's equivalent strip, which the rights matrix
  // there never gave CDC visibility on) — included here from the start.
  const showAssignedTeamInfo = (isCRM || isAuditor || isTech || isCdc) &&
    !!(assignedAuditorId && assignedTechReviewerId);

  // Plan upload reappears after a client rejection, so CRM/Auditor can revise.
  const showPlanUploadPrompt = (isCRM || isAuditor) &&
    (status === 'Team_Assigned' || (status === 'Surv_Plan_Sent' && !!planClientRemarks));
  const showPlanReviewPanel  = isLinkedClient && status === 'Surv_Plan_Sent' && planUploaded;

  const showAuditPrepPrompt  = (isCRM || isAuditor) && status === 'Surv_Plan_Accepted';
  const showRcaUploadPrompt  = isLinkedClient && status === 'Surv_NCR_Sent';
  // Auditor only — deliberately NOT (isAuditor || isCRM), unlike External
  // Client's equivalent panel. review_surv_ncr_rca's RPC gate has no CRM
  // bypass (confirmed decision, Sprint 2) — CRM is view-only on this row per
  // the SURV1 rights matrix, so CRM must never see buttons that would just
  // fail on click.
  const showRcaReviewPanel   = isAuditor && status === 'Surv_NCR_RCA_Uploaded';

  const showReportPrompt     = (isCRM || isAuditor) && status === 'Surv_Auditor_Accepted';
  const showFindingsPanel    = isTech && status === 'Surv_Report_Sent';
  const showClosurePanel     = isAuditor && status === 'Surv_Tech_Findings_Given';
  const showCdcUploadPrompt  = isCdc && status === 'Surv_Closed';
  const showCertificatePrompt = isCRM && status === 'CDC_Approved';

  // ── Sprint 8: Suspension & Withdrawal. Every one of these six rows is
  // "upload IS the action" — no accept/reject buttons, just an instructional
  // banner telling the uploading role to use the file field below, same
  // shape as showCdcUploadPrompt/showCertificatePrompt above. Strictly
  // linear sequencing, confirmed (00_Sprint_Plan.md Sprint 8) — each prompt
  // requires exactly the prior checkpoint's status, matching the RPC-level
  // gate in migration 278.
  const showSuspensionIntimationPrompt = isCRM && status === 'Certificate_Issued';
  const showSuspensionDecisionPrompt   = isCdc && status === 'Suspension_Intimation_Sent';
  const showSuspensionLetterPrompt     = isCRM && status === 'Suspension_Decision_Uploaded';
  const showWithdrawalIntimationPrompt = isCRM && status === 'Suspension_Letter_Sent';
  const showWithdrawalDecisionPrompt   = isCdc && status === 'Withdrawal_Intimation_Sent';
  const showWithdrawalLetterPrompt     = isCRM && status === 'Withdrawal_Decision_Uploaded';

  const anyVisible = showIntimationPrompt || showIntimationReview ||
    showAssignTeamPrompt || showAssignedTeamInfo ||
    showPlanUploadPrompt || showPlanReviewPanel || showAuditPrepPrompt ||
    showRcaUploadPrompt || showRcaReviewPanel ||
    showReportPrompt || showFindingsPanel || showClosurePanel ||
    showCdcUploadPrompt || showCertificatePrompt ||
    showSuspensionIntimationPrompt || showSuspensionDecisionPrompt || showSuspensionLetterPrompt ||
    showWithdrawalIntimationPrompt || showWithdrawalDecisionPrompt || showWithdrawalLetterPrompt;

  // ── Fetch Auditor/Tech Reviewer options — must run unconditionally,
  // before the "nothing to show" early return below, so hook count never
  // changes between renders (same fix StageAuditActionPanel needed live). ──
  useEffect(() => {
    if (!showAssignTeamPrompt && !showAssignedTeamInfo) return;
    let cancelled = false;
    setLoadingTeamOptions(true);
    Promise.all([
      supabase.rpc('get_tenant_users_by_role_pattern', { p_role_pattern: 'auditor' }),
      supabase.rpc('get_tenant_users_by_role_pattern', { p_role_pattern: 'tech' }),
    ]).then(([auditorsRes, techRes]) => {
      if (cancelled) return;
      if (!auditorsRes.error) setAuditorOptions(auditorsRes.data || []);
      if (!techRes.error) setTechReviewerOptions(techRes.data || []);
    }).finally(() => { if (!cancelled) setLoadingTeamOptions(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAssignTeamPrompt, showAssignedTeamInfo, recordId]);

  // ── Nothing to show ──────────────────────────────────────────
  if (!anyVisible) {
    const anyRemarks = rejectionNotes || planClientRemarks || rcaRejectionNotes;
    if (isAdmin && anyRemarks) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Rejection Notes</p>
          {rejectionNotes && <p className="text-sm text-red-800">{rejectionNotes}</p>}
          {planClientRemarks && <p className="text-sm text-red-800 mt-1">{planClientRemarks}</p>}
          {rcaRejectionNotes && <p className="text-sm text-red-800 mt-1">{rcaRejectionNotes}</p>}
        </div>
      );
    }
    return null;
  }

  // ── CRM: assign Auditor + Tech Reviewer ──────────────────────────
  const handleAssignTeam = async () => {
    if (!selectedAuditorId || !selectedTechReviewerId) {
      toast.error('Select both an Auditor and a Tech Reviewer.');
      return;
    }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('assign_surv_team', {
        p_record_id:        recordId,
        p_auditor_id:       selectedAuditorId,
        p_tech_reviewer_id: selectedTechReviewerId,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign team');
    } finally {
      setProcessing(false);
    }
  };

  // ── Generic accept/reject (intimation, plan, RCA review) ─────────
  const handleReview = async (rpc: string, action: 'accept' | 'reject') => {
    if (action === 'reject' && mode === 'idle') { setRejectRpc(rpc); setMode('rejecting'); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc(rpc, {
        p_record_id: recordId,
        p_action:    action,
        p_notes:     action === 'reject' ? rejectNotes.trim() || null : null,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setMode('idle');
      setRejectRpc(null);
      setRejectNotes('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  // ── View/download an uploaded file inline from a review panel ────
  // Generic on purpose — used for the intimation letter today, safe to
  // reuse for plan/report/etc. review panels later without duplicating
  // this. Signed URL, 5 min expiry — same pattern RecordDetailView.tsx's
  // maybeSendRenewalUploadEmail already uses for the same bucket.
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const handleViewFile = async (file: { name: string; bucket: string; path: string }) => {
    setViewingFile(file.path);
    try {
      const { data, error } = await supabase.storage
        .from(file.bucket)
        .createSignedUrl(file.path, 300);
      if (error || !data?.signedUrl) { toast.error('Could not open file'); return; }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open file');
    } finally {
      setViewingFile(null);
    }
  };

  // ── Tech Reviewer: submit findings ───────────────────────────────
  // Notes optional: blank box = accept without findings, matching the
  // established "empty box = direct accept" trick. Deliberately does NOT
  // implement External Client's later revision-loop-back (migration 253) —
  // not in the SURV1 rights matrix or the sprint plan for this object.
  const handleSubmitFindings = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('submit_surv_tech_findings', {
        p_record_id: recordId,
        p_notes:     findingsNotes.trim() || null,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setFindingsNotes('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit findings');
    } finally {
      setProcessing(false);
    }
  };

  // ── Auditor: close the audit ──────────────────────────────────────
  const handleCloseAudit = async () => {
    if (!closureNotes.trim()) { toast.error('Please enter closure notes.'); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('close_surv_audit', {
        p_record_id:     recordId,
        p_closure_notes: closureNotes.trim(),
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setClosureNotes('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to close audit');
    } finally {
      setProcessing(false);
    }
  };

  // ── Shared "Confirm Reject" form ──────────────────────────────
  if (mode === 'rejecting' && rejectRpc) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4 space-y-3">
        <p className="text-sm font-semibold text-red-900">Reject — add a reason</p>
        <textarea
          value={rejectNotes}
          onChange={e => setRejectNotes(e.target.value)}
          rows={3}
          placeholder="Optional reason..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-red-500 focus:border-red-500"
        />
        <div className="flex gap-2">
          <button onClick={() => handleReview(rejectRpc, 'reject')} disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
            {processing ? 'Processing...' : 'Confirm Reject'}
          </button>
          <button onClick={() => { setMode('idle'); setRejectRpc(null); setRejectNotes(''); }} disabled={processing}
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

      {/* ── Linked Client: Review Intimation Letter ── */}
      {showIntimationReview && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Surveillance Intimation</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
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
            {intimationFile && (
              <button onClick={() => handleViewFile(intimationFile)} disabled={viewingFile === intimationFile.path}
                className="px-5 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-300 rounded-md hover:bg-purple-100 disabled:opacity-50 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {viewingFile === intimationFile.path ? 'Opening…' : 'View Letter'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── CRM: Assign Auditor + Tech Reviewer ── */}
      {showAssignTeamPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-blue-900">Assign Team</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Auditor</label>
              <select
                value={selectedAuditorId}
                onChange={e => setSelectedAuditorId(e.target.value)}
                disabled={loadingTeamOptions}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{loadingTeamOptions ? 'Loading...' : 'Select an Auditor'}</option>
                {auditorOptions.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tech Reviewer</label>
              <select
                value={selectedTechReviewerId}
                onChange={e => setSelectedTechReviewerId(e.target.value)}
                disabled={loadingTeamOptions}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{loadingTeamOptions ? 'Loading...' : 'Select a Tech Reviewer'}</option>
                {techReviewerOptions.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
          </div>
          <button onClick={handleAssignTeam} disabled={processing || loadingTeamOptions}
            className="mt-3 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {processing ? 'Assigning...' : 'Confirm Assignment'}
          </button>
        </div>
      )}

      {/* ── Read-only: who's assigned, once set ── */}
      {showAssignedTeamInfo && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>
            <span className="font-semibold text-gray-800">Auditor: </span>
            {auditorOptions.find(u => u.id === assignedAuditorId)?.name || 'Assigned'}
          </span>
          <span>
            <span className="font-semibold text-gray-800">Tech Reviewer: </span>
            {techReviewerOptions.find(u => u.id === assignedTechReviewerId)?.name || 'Assigned'}
          </span>
        </div>
      )}

      {/* ── CRM/Auditor: Upload Audit Plan (instruction) ── */}
      {showPlanUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">
                {planClientRemarks ? 'Revise Surveillance Audit Plan' : 'Upload Surveillance Audit Plan'}
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {planClientRemarks && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Client remarks: </span>{planClientRemarks}
            </div>
          )}
        </div>
      )}

      {/* ── Linked Client: Review Audit Plan ── */}
      {showPlanReviewPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Surveillance Audit Plan</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
          <div className="flex gap-3">
            <button onClick={() => handleReview('review_surv_plan', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_surv_plan', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM/Auditor: Conduct Audit — enter date, upload NCR (instruction) ── */}
      {showAuditPrepPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Conduct Surveillance Audit</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Plan accepted. Enter the <strong>Surveillance Audit Date</strong> and upload the{' '}
                <strong>Surveillance NCR</strong> using the fields below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Next Step
            </span>
          </div>
        </div>
      )}

      {/* ── Linked Client: Upload NCR + RCA (instruction) ── */}
      {showRcaUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload NCR Root Cause Analysis</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {rcaRejectionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Auditor remarks: </span>{rcaRejectionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── Auditor ONLY: Review NCR + RCA (no CRM bypass — see gate note above) ── */}
      {showRcaReviewPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Review NCR + RCA</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Awaiting Review
            </span>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleReview('review_surv_ncr_rca', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_surv_ncr_rca', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM/Auditor: Upload Audit Report (instruction) ── */}
      {showReportPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Surveillance Audit Report</p>
              <p className="text-xs text-blue-600 mt-0.5">
                RCA accepted. Upload the <strong>Surveillance Audit Report</strong> using the field below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Next Step
            </span>
          </div>
        </div>
      )}

      {/* ── Tech Reviewer: Submit Findings (or accept without) ── */}
      {showFindingsPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Tech Review</p>
              <p className="text-xs text-purple-600 mt-0.5">
                Optionally upload supporting evidence using the <strong>Tech Review Checklist</strong> field below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Tech Review
            </span>
          </div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Findings / remarks <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            value={findingsNotes}
            onChange={e => setFindingsNotes(e.target.value)}
            rows={3}
            placeholder="Enter technical review findings, or leave blank to accept without findings..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
          />
          <div className="mt-3">
            <button onClick={handleSubmitFindings} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {processing
                ? 'Submitting...'
                : findingsNotes.trim() ? 'Submit Findings' : 'Accept Without Findings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Auditor: Close Audit ── */}
      {showClosurePanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Close Surveillance Audit</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Ready to Close
            </span>
          </div>
          <textarea
            value={closureNotes}
            onChange={e => setClosureNotes(e.target.value)}
            rows={3}
            placeholder="Enter closure notes..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
          />
          <div className="mt-3">
            <button onClick={handleCloseAudit} disabled={processing || !closureNotes.trim()}
              className="px-5 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {processing ? 'Closing...' : 'Close Audit'}
            </button>
          </div>
        </div>
      )}

      {/* ── CDC: Upload CDC Report (instruction — upload IS the approval) ── */}
      {showCdcUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload CDC Report</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CRM: Issue Certificate ── */}
      {showCertificatePrompt && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-900">Issue Certificate</p>
              <p className="text-xs text-green-600 mt-0.5">
                CDC approved. Upload the <strong>Surveillance Certificates</strong> using the field below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── Sprint 8: Suspension & Withdrawal — every row is "upload IS the
          action," same instructional-banner shape as the two above. ── */}

      {/* ── CRM: Suspension Intimation ── */}
      {showSuspensionIntimationPrompt && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-yellow-900">Upload Suspension Intimation</p>
              <p className="text-xs text-yellow-600 mt-0.5">
                Upload the <strong>Suspension Intimation</strong> letter using the field below. The client will be emailed the file automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CDC: Suspension Decision (upload IS the decision) ── */}
      {showSuspensionDecisionPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Suspension Decision</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Upload the <strong>Suspension Decision</strong> document using the field below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CRM: Suspension Letter ── */}
      {showSuspensionLetterPrompt && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-yellow-900">Upload Suspension Letter</p>
              <p className="text-xs text-yellow-600 mt-0.5">
                Upload the <strong>Suspension Letter</strong> using the field below. The client will be emailed the file automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CRM: Withdrawal Intimation ── */}
      {showWithdrawalIntimationPrompt && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-red-900">Upload Withdrawal Intimation</p>
              <p className="text-xs text-red-600 mt-0.5">
                Upload the <strong>Withdrawal Intimation</strong> letter using the field below. The client will be emailed the file automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CDC: Withdrawal Decision (upload IS the decision) ── */}
      {showWithdrawalDecisionPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Withdrawal Decision</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Upload the <strong>Withdrawal Decision</strong> document using the field below.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
        </div>
      )}

      {/* ── CRM: Withdrawal Letter (terminal checkpoint) ── */}
      {showWithdrawalLetterPrompt && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-red-900">Upload Withdrawal Letter</p>
              <p className="text-xs text-red-600 mt-0.5">
                Upload the <strong>Withdrawal Letter</strong> using the field below. The client will be emailed the file automatically.
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 shrink-0 ml-3">
              Final Step
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
