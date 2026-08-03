'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';

interface Props {
  recordId: string;
  recordData: Record<string, any>;
  currentUserRole: string;
  currentCustomRole: string | null;
  currentUserId: string;
  objectId: string;
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

export default function StageAuditActionPanel({
  recordId,
  recordData,
  currentUserRole,
  currentCustomRole,
  currentUserId,
  onActionComplete,
}: Props) {
  const supabase = createClientComponentClient();
  const [mode, setMode] = useState<Mode>('idle');
  const [rejectRpc, setRejectRpc] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [findingsNotes, setFindingsNotes] = useState('');
  const [closureNotes, setClosureNotes] = useState('');
  const [stage2FindingsNotes, setStage2FindingsNotes] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
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
  const isAdmin        = currentUserRole === 'admin';
  // The linked client themselves — excluding admin, even though admin can
  // also open a client's record. Used as a hard exclusion below so a role-
  // name mixup (or a client whose custom role string happens to contain one
  // of these substrings) can never grant them a CRM/Auditor/Tech/CDC-only
  // action panel meant for someone reviewing their record, not living in it.
  const isClientOnly   = !isAdmin && currentUserId === clientUserId;
  const isCRM          = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('crm'));
  const isAuditor      = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('auditor'));
  const isTech         = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('tech'));
  const isCdc          = isAdmin || (!isClientOnly && lower(currentCustomRole).includes('cdc'));
  const isLinkedClient = isAdmin || currentUserId === clientUserId;

  const assignedAuditorId      = recordData['auditor_id__a'] || null;
  const assignedTechReviewerId = recordData['tech_reviewer_id__a'] || null;

  const planUploaded       = hasFile(recordData['stage_one_audit_plan__a']);
  const stage2PlanUploaded = hasFile(recordData['Stage_two_audit_plan__a']);

  const planClientRemarks       = recordData['stage1_plan_client_remarks__a'];
  const rcaRejectionNotes       = recordData['stage1_rejection_notes__a'];
  const techFinalRejectionNotes = recordData['stage1_tech_final_rejection_notes__a'];
  // Reuses the same column the Tech Reviewer's findings are submitted into —
  // only meaningful while status is Stage1_Tech_Findings_Rejected (cleared by
  // finalize_file_upload once the Auditor re-uploads the report/NCR).
  const techFindingsRevisionNotes = recordData['stage1_tech_findings_notes__a'];

  const stage2PlanClientRemarks      = recordData['stage2_plan_client_remarks__a'];
  const stage2RcaRejectionNotes      = recordData['stage2_rejection_notes__a'];
  const stage2EvidencesRejectionNotes = recordData['stage2_evidences_rejection_notes__a'];
  const stage2TechFindingsRevisionNotes = recordData['stage2_tech_findings_notes__a'];

  // ── Checkpoint visibility — Stage 1, one per role, gated by status__a ──
  // CRM-only: assign the Auditor/Tech Reviewer before the plan can be uploaded
  // (mandatory checkpoint, migration 244 — start_file_upload hard-blocks the
  // plan upload server-side until both are set, this is just the matching UI).
  const showAssignTeamPrompt = isCRM && status === 'Client_Agreement_Signed';

  // Plan upload also reappears after a client rejection, so CRM/Auditor can revise.
  const showPlanUploadPrompt = (isCRM || isAuditor) &&
    (status === 'Team_Assigned' || (status === 'Stage_one_plan_Sent' && !!planClientRemarks));
  const showPlanReviewPanel  = isLinkedClient && status === 'Stage_one_plan_Sent' && planUploaded;
  const showAuditPrepPrompt  = (isCRM || isAuditor) && status === 'Stage1_Plan_Accepted';
  const showRcaUploadPrompt  = isLinkedClient && status === 'Stage1_Report_Sent';
  const showRcaReviewPanel   = (isAuditor || isCRM) && status === 'Stage1_NCR_RCA_Uploaded';
  const showFindingsPanel    = isTech && status === 'Stage1_Auditor_Accepted';
  // Tech Reviewer gave findings (rather than accepting with none) — sent
  // back to Auditor/CRM to revise and re-upload the report/NCR, which loops
  // straight back to showFindingsPanel above (skips the Client/RCA cycle).
  const showTechFindingsRevisionPrompt = (isCRM || isAuditor) && status === 'Stage1_Tech_Findings_Rejected';
  const showClosurePanel     = isAuditor && status === 'Stage1_Tech_Findings_Given';
  const showFinalReviewPanel = isTech && status === 'Stage1_Closed';

  // ── Checkpoint visibility — Stage 2 ──
  // Tail is deliberately shorter than Stage 1's (confirmed decision, migration
  // 238): tech findings goes straight to CDC upload, no auditor-close /
  // tech-final-signoff pair. close_stage2_audit and accept_stage2_tech_review
  // are retired — do not wire them here.
  const showStage2PlanUploadPrompt = (isCRM || isAuditor) &&
    (status === 'Stage1_Complete' || (status === 'Stage2_Plan_Sent' && !!stage2PlanClientRemarks));
  const showStage2PlanReviewPanel  = isLinkedClient && status === 'Stage2_Plan_Sent' && stage2PlanUploaded;
  const showStage2AuditPrepPrompt  = (isCRM || isAuditor) && status === 'Stage2_Plan_Accepted';
  const showStage2RcaUploadPrompt  = isLinkedClient && status === 'Stage2_Report_Sent';
  const showStage2RcaReviewPanel   = (isAuditor || isCRM) && status === 'Stage2_NCR_RCA_Uploaded';
  const showStage2EvidencesUploadPrompt = isLinkedClient && status === 'Stage2_Auditor_Accepted';
  const showStage2EvidencesReviewPanel  = (isAuditor || isCRM) && status === 'Stage2_Evidences_Uploaded';
  const showStage2FindingsPanel    = isTech && status === 'Stage2_Evidences_Accepted';
  // Mirrors showTechFindingsRevisionPrompt above, Stage 2 side.
  const showStage2TechFindingsRevisionPrompt = (isCRM || isAuditor) && status === 'Stage2_Tech_Findings_Rejected';
  // CDC role only (migration 243) — CRM/Tech Reviewer no longer trigger the
  // auto-advance, so the prompt shouldn't invite them to try.
  const showCdcUploadPrompt        = isCdc && status === 'Stage2_Tech_Findings_Given';
  const showRegistrationPanel      = (isCRM || isAuditor) && status === 'CDC_Approved';

  // Read-only "assigned team" strip — shown once assignment exists, to
  // anyone who'd care (CRM/Auditor/Tech Reviewer/admin).
  const showAssignedTeamInfo = (isCRM || isAuditor || isTech) &&
    !!(assignedAuditorId && assignedTechReviewerId);

  const anyVisible = showAssignTeamPrompt || showAssignedTeamInfo ||
    showPlanUploadPrompt || showPlanReviewPanel || showAuditPrepPrompt ||
    showRcaUploadPrompt || showRcaReviewPanel || showFindingsPanel ||
    showTechFindingsRevisionPrompt || showClosurePanel ||
    showFinalReviewPanel ||
    showStage2PlanUploadPrompt || showStage2PlanReviewPanel || showStage2AuditPrepPrompt ||
    showStage2RcaUploadPrompt || showStage2RcaReviewPanel || showStage2EvidencesUploadPrompt ||
    showStage2EvidencesReviewPanel || showStage2FindingsPanel ||
    showStage2TechFindingsRevisionPrompt || showCdcUploadPrompt ||
    showRegistrationPanel;

  // ── Fetch Auditor/Tech Reviewer options — needed both to populate the
  // assign dropdowns and to resolve names for the read-only "assigned" strip.
  // MUST run unconditionally, before the "nothing to show" early return below
  // — every hook in this component has to fire on every render regardless of
  // anyVisible, or the hook count changes between renders (React: "Rendered
  // more hooks than during the previous render"). This effect used to sit
  // after that early return, which only surfaced once a record actually had
  // both auditor_id__a/tech_reviewer_id__a set (flipping anyVisible/
  // showAssignedTeamInfo across renders) — fixed 2026-08-01.
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
    const anyRemarks = planClientRemarks || rcaRejectionNotes || techFinalRejectionNotes ||
      techFindingsRevisionNotes ||
      stage2PlanClientRemarks || stage2RcaRejectionNotes || stage2EvidencesRejectionNotes ||
      stage2TechFindingsRevisionNotes;
    if (isAdmin && anyRemarks) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Rejection Notes</p>
          {planClientRemarks && <p className="text-sm text-red-800">{planClientRemarks}</p>}
          {rcaRejectionNotes && <p className="text-sm text-red-800 mt-1">{rcaRejectionNotes}</p>}
          {techFinalRejectionNotes && <p className="text-sm text-red-800 mt-1">{techFinalRejectionNotes}</p>}
          {techFindingsRevisionNotes && <p className="text-sm text-red-800 mt-1">{techFindingsRevisionNotes}</p>}
          {stage2PlanClientRemarks && <p className="text-sm text-red-800 mt-1">{stage2PlanClientRemarks}</p>}
          {stage2RcaRejectionNotes && <p className="text-sm text-red-800 mt-1">{stage2RcaRejectionNotes}</p>}
          {stage2EvidencesRejectionNotes && <p className="text-sm text-red-800 mt-1">{stage2EvidencesRejectionNotes}</p>}
          {stage2TechFindingsRevisionNotes && <p className="text-sm text-red-800 mt-1">{stage2TechFindingsRevisionNotes}</p>}
        </div>
      );
    }
    return null;
  }

  // ── CRM: assign Auditor + Tech Reviewer (mandatory before Stage 1 plan) ──
  const handleAssignTeam = async () => {
    if (!selectedAuditorId || !selectedTechReviewerId) {
      toast.error('Select both an Auditor and a Tech Reviewer.');
      return;
    }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('assign_stage_team', {
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

  // ── Generic accept/reject (plan review, RCA review, evidences review) ──
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

  // ── Tech Reviewer: submit Stage 1 findings ──────────────────────
  // Notes are optional: submitting with an empty box is the "directly accept"
  // path (no findings to raise), submitting with text is "accept with findings".
  const handleSubmitFindings = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('submit_stage1_tech_findings', {
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

  // ── Auditor: close Stage 1 audit ────────────────────────────────
  const handleCloseAudit = async () => {
    if (!closureNotes.trim()) { toast.error('Please enter closure notes.'); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('close_stage1_audit', {
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

  // ── Tech Reviewer: submit Stage 2 findings ──────────────────────
  // Same optional-notes = direct-accept trick as Stage 1. Unlike Stage 1,
  // this is the LAST tech-review action for Stage 2 — CDC upload follows
  // directly (no auditor-close / final-signoff pair).
  const handleSubmitStage2Findings = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('submit_stage2_tech_findings', {
        p_record_id: recordId,
        p_notes:     stage2FindingsNotes.trim() || null,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setStage2FindingsNotes('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit findings');
    } finally {
      setProcessing(false);
    }
  };

  // ── CRM/Auditor: record client registration date ────────────────
  const handleSetRegistrationDate = async () => {
    if (!registrationDate) { toast.error('Please select a registration date.'); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('set_stage2_registration_date', {
        p_record_id: recordId,
        p_date:      registrationDate,
      });
      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }
      toast.success(result.message);
      setRegistrationDate('');
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record registration date');
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

      {/* ── CRM: Assign Auditor + Tech Reviewer (mandatory before Stage 1 plan) ── */}
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

      {/* ══════════════════════ Stage 1 ══════════════════════ */}

      {/* ── CRM/Auditor: Upload Stage 1 Audit Plan (instruction — use field below) ── */}
      {showPlanUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">
                {planClientRemarks ? 'Revise Stage 1 Audit Plan' : 'Upload Stage 1 Audit Plan'}
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

      {/* ── Linked Client: Review Stage 1 Audit Plan ── */}
      {showPlanReviewPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Stage 1 Audit Plan</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
          {planClientRemarks && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Your previous remarks: </span>{planClientRemarks}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => handleReview('review_stage1_plan', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_stage1_plan', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM/Auditor: Set audit date + upload report & NCR (instruction) ── */}
      {showAuditPrepPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Conduct Stage 1 Audit</p>
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
              <p className="text-sm font-semibold text-blue-900">Upload NCR + RCA</p>
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

      {/* ── Auditor/CRM: Review NCR + RCA ── */}
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
            <button onClick={() => handleReview('review_stage1_ncr_rca', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_stage1_ncr_rca', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── Tech Reviewer: Submit Stage 1 Findings (or accept without) ── */}
      {showFindingsPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Tech Review</p>
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

      {/* ── CRM/Auditor: Revise & Re-upload Stage 1 Report/NCR (Tech Reviewer gave findings) ── */}
      {showTechFindingsRevisionPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Revise Stage 1 Audit Report</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {techFindingsRevisionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Tech Reviewer findings: </span>{techFindingsRevisionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── Auditor: Close Stage 1 Audit ── */}
      {showClosurePanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Close Stage 1 Audit</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Ready to Close
            </span>
          </div>
          {techFinalRejectionNotes && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Previous rejection (final sign-off): </span>{techFinalRejectionNotes}
            </div>
          )}
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

      {/* ── Tech Reviewer: Final Sign-Off (Stage 1 only) ── */}
      {showFinalReviewPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Final Sign-Off</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Final Review
            </span>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleReview('accept_stage1_tech_review', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('accept_stage1_tech_review', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════ Stage 2 ══════════════════════ */}

      {/* ── CRM/Auditor: Upload Stage 2 Audit Plan (instruction) ── */}
      {showStage2PlanUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">
                {stage2PlanClientRemarks ? 'Revise Stage 2 Audit Plan' : 'Upload Stage 2 Audit Plan'}
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {stage2PlanClientRemarks && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Client remarks: </span>{stage2PlanClientRemarks}
            </div>
          )}
        </div>
      )}

      {/* ── Linked Client: Review Stage 2 Audit Plan ── */}
      {showStage2PlanReviewPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Review Stage 2 Audit Plan</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Your Response
            </span>
          </div>
          {stage2PlanClientRemarks && (
            <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Your previous remarks: </span>{stage2PlanClientRemarks}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => handleReview('review_stage2_plan', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_stage2_plan', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── CRM/Auditor: Set Stage 2 audit date + upload report & NCR (instruction) ── */}
      {showStage2AuditPrepPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Conduct Stage 2 Audit</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Next Step
            </span>
          </div>
        </div>
      )}

      {/* ── Linked Client: Upload Stage 2 NCR + RCA (instruction) ── */}
      {showStage2RcaUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Stage 2 NCR + RCA</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {stage2RcaRejectionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Auditor remarks: </span>{stage2RcaRejectionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── Auditor/CRM: Review Stage 2 NCR + RCA ── */}
      {showStage2RcaReviewPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Review Stage 2 NCR + RCA</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Awaiting Review
            </span>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleReview('review_stage2_ncr_rca', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_stage2_ncr_rca', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── Linked Client: Upload Evidences (instruction — Stage 2 only) ── */}
      {showStage2EvidencesUploadPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Upload Evidences</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {stage2EvidencesRejectionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Auditor remarks: </span>{stage2EvidencesRejectionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── Auditor/CRM: Review Evidences (Stage 2 only) ── */}
      {showStage2EvidencesReviewPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Review Evidences</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 shrink-0 ml-3">
              Awaiting Review
            </span>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleReview('review_stage2_evidences', 'accept')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
            <button onClick={() => handleReview('review_stage2_evidences', 'reject')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {/* ── Tech Reviewer: Submit Stage 2 Findings (or accept without) ── */}
      {showStage2FindingsPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Tech Review</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Awaiting Tech Review
            </span>
          </div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Findings / remarks <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            value={stage2FindingsNotes}
            onChange={e => setStage2FindingsNotes(e.target.value)}
            rows={3}
            placeholder="Enter technical review findings, or leave blank to accept without findings..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
          />
          <div className="mt-3">
            <button onClick={handleSubmitStage2Findings} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {processing
                ? 'Submitting...'
                : stage2FindingsNotes.trim() ? 'Submit Findings' : 'Accept Without Findings'}
            </button>
          </div>
        </div>
      )}

      {/* ── CRM/Auditor: Revise & Re-upload Stage 2 Report/NCR (Tech Reviewer gave findings) ── */}
      {showStage2TechFindingsRevisionPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900">Revise Stage 2 Audit Report</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 shrink-0 ml-3">
              Action Required
            </span>
          </div>
          {stage2TechFindingsRevisionNotes && (
            <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <span className="font-semibold">Tech Reviewer findings: </span>{stage2TechFindingsRevisionNotes}
            </div>
          )}
        </div>
      )}

      {/* ── CRM/Tech: Upload CDC Report (instruction — upload IS the approval) ── */}
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

      {/* ── CRM/Auditor: Record Client Registration Date (terminal step) ── */}
      {showRegistrationPanel && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-purple-900">Record Client Registration</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
              Final Step
            </span>
          </div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Registration date</label>
          <input
            type="date"
            value={registrationDate}
            onChange={e => setRegistrationDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
          />
          <div className="mt-3">
            <button onClick={handleSetRegistrationDate} disabled={processing || !registrationDate}
              className="px-5 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {processing ? 'Saving...' : 'Confirm Registration'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
