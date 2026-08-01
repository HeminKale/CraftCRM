'use client';

import React, { useState, useEffect } from 'react';

// Each stage: label shown on bar, the date column key in recordData,
// and the picklist value that maps to this stage being "current"
interface WorkflowStage {
  label: string;
  dateKey: string;        // key in recordData (with __a suffix); '' = no date for this stage
  statusValue: string;    // picklist value stored in status__a
}

// Single unified pipeline — one dot per status__a value, in order.
// This array is the display-side mirror of the status__a picklist: the same
// values, in the same order, are registered in tenant.picklist_values (see
// migrations 237 §4 and 238 §B3) so the edit-mode dropdown and this bar
// never disagree.
//
// stage1_ncr_rca_uploaded_date__a and stage2_ncr_rca_uploaded_date__a are
// retired (migration 238 Part A2/B — columns kept for history, no longer
// written). Never wire either back in as a dateKey.
const STAGES: WorkflowStage[] = [
  { label: 'Application Sent',           dateKey: 'Date__a',                          statusValue: 'Application_Sent' },
  { label: 'Application Accepted',       dateKey: 'Application_Accpeted_Date__a',     statusValue: 'Application_Accepted' },
  { label: 'Quotation Received',         dateKey: 'Quotation_Received_Date__a',       statusValue: 'Quotation_Received' },
  { label: 'Client Agreement Signed',    dateKey: 'Client_Agreement_Signed_Date__a',  statusValue: 'Client_Agreement_Signed' },
  { label: 'Team Assigned',              dateKey: '',                                 statusValue: 'Team_Assigned' },
  { label: 'Stage 1 Plan Sent',          dateKey: 'Stage_one_plan_Sent_Date__a',      statusValue: 'Stage_one_plan_Sent' },
  { label: 'Stage 1 Plan Accepted',      dateKey: 'stage1_plan_accepted_date__a',     statusValue: 'Stage1_Plan_Accepted' },
  { label: 'Stage 1 Report Sent',        dateKey: '',                                 statusValue: 'Stage1_Report_Sent' },
  { label: 'Stage 1 RCA Done',           dateKey: '',                                 statusValue: 'Stage1_NCR_RCA_Uploaded' },
  { label: 'Stage 1 NCR + RCA Accepted', dateKey: 'stage1_auditor_accepted_date__a',  statusValue: 'Stage1_Auditor_Accepted' },
  { label: 'Stage 1 Tech Review Passed', dateKey: 'stage1_tech_findings_date__a',     statusValue: 'Stage1_Tech_Findings_Given' },
  { label: 'Stage 1 Closed',             dateKey: 'stage1_closed_date__a',            statusValue: 'Stage1_Closed' },
  { label: 'Ready for Stage 2',          dateKey: 'stage1_tech_final_accepted_date__a', statusValue: 'Stage1_Complete' },
  { label: 'Stage 2 Plan Sent',          dateKey: 'stage2_plan_sent_date__a',         statusValue: 'Stage2_Plan_Sent' },
  { label: 'Stage 2 Plan Accepted',      dateKey: 'stage2_plan_accepted_date__a',     statusValue: 'Stage2_Plan_Accepted' },
  { label: 'Stage 2 Report Sent',        dateKey: '',                                 statusValue: 'Stage2_Report_Sent' },
  { label: 'Stage 2 RCA Done',           dateKey: '',                                 statusValue: 'Stage2_NCR_RCA_Uploaded' },
  { label: 'Stage 2 NCR + RCA Accepted', dateKey: 'stage2_auditor_accepted_date__a',  statusValue: 'Stage2_Auditor_Accepted' },
  { label: 'Stage 2 Evidences Uploaded', dateKey: 'stage2_evidences_uploaded_date__a', statusValue: 'Stage2_Evidences_Uploaded' },
  { label: 'Stage 2 NCR Closed',         dateKey: 'stage2_evidences_accepted_date__a', statusValue: 'Stage2_Evidences_Accepted' },
  { label: 'Stage 2 Tech Review Passed', dateKey: 'stage2_tech_findings_date__a',     statusValue: 'Stage2_Tech_Findings_Given' },
  { label: 'CDC Approved',               dateKey: 'cdc_date__a',                      statusValue: 'CDC_Approved' },
  { label: 'Client Registered',          dateKey: 'stage2_registration_date__a',      statusValue: 'Client_Registered' },
];

// How many stages to show either side of the current one when the full list
// doesn't fit — current-3 … current … current+3, so a 7-wide window.
const WINDOW_RADIUS = 3;
const WINDOW_SIZE = WINDOW_RADIUS * 2 + 1;

function formatDate(value: any): string {
  if (!value) return '';
  try {
    const d = new Date(value);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(value);
  }
}

// Resolve the current stage index from recordData:
// 1. If status__a is set, find matching stage index (override)
// 2. Otherwise derive from which date fields are filled (highest filled = current)
function resolveCurrentStageIndex(recordData: Record<string, any>): number {
  // Try status__a override first — compare against picklist value directly
  const rawStatus = recordData['status__a'];
  if (rawStatus) {
    const overrideIdx = STAGES.findIndex(s => s.statusValue === rawStatus);
    if (overrideIdx !== -1) return overrideIdx;
  }

  // Fall back to date-driven: last stage with a date filled
  let lastFilledIdx = -1;
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].dateKey && recordData[STAGES[i].dateKey]) lastFilledIdx = i;
  }
  return lastFilledIdx;
}

// Pick the visible slice: a WINDOW_SIZE-wide window centred on the current
// stage, clamped so it never runs off either end of the array.
function resolveWindow(currentIdx: number, total: number): { start: number; end: number } {
  if (total <= WINDOW_SIZE) return { start: 0, end: total };
  // currentIdx of -1 (nothing started yet) anchors the window at the start
  const anchor = currentIdx < 0 ? 0 : currentIdx;
  let start = anchor - WINDOW_RADIUS;
  if (start < 0) start = 0;
  if (start + WINDOW_SIZE > total) start = total - WINDOW_SIZE;
  return { start, end: start + WINDOW_SIZE };
}

// Renders a slice of the pipeline. `offset` is the global index of the first
// stage in `stages`, so connector/completion colouring stays correct even when
// the slice doesn't start at zero.
function StageTrack({ stages, offset, currentIdx, total, recordData }: {
  stages: WorkflowStage[];
  offset: number;
  currentIdx: number;
  total: number;
  recordData: Record<string, any>;
}) {
  return (
    <div className="relative flex items-start">
      <div className="relative z-10 flex w-full justify-between">
        {stages.map((stage, idx) => {
          const globalIdx = offset + idx;
          const isDone    = globalIdx <= currentIdx;
          const isCurrent = globalIdx === currentIdx;
          const dateStr   = stage.dateKey ? formatDate(recordData[stage.dateKey]) : '';

          return (
            <div key={stage.statusValue} className="flex flex-col items-center flex-1 min-w-0">
              {/* Stage label — above dot */}
              <span className={`text-xs font-medium text-center leading-tight mb-2 px-1 ${
                isDone ? 'text-gray-900' : 'text-gray-400'
              }`}>
                {stage.label}
              </span>

              {/* Dot + connecting lines */}
              <div className="relative flex items-center w-full justify-center">
                {/* Left connector — drawn whenever a stage precedes this one globally,
                    so a clipped window shows a continuation stub rather than a gap */}
                {globalIdx > 0 && (
                  <div className={`absolute right-1/2 top-1/2 -translate-y-1/2 h-0.5 w-1/2 ${
                    globalIdx <= currentIdx ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}
                {/* Right connector */}
                {globalIdx < total - 1 && (
                  <div className={`absolute left-1/2 top-1/2 -translate-y-1/2 h-0.5 w-1/2 ${
                    globalIdx < currentIdx ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}

                {/* The dot */}
                <div className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isCurrent
                    ? 'border-blue-500 bg-white shadow-md ring-4 ring-blue-100'
                    : isDone
                    ? 'border-green-500 bg-green-500'
                    : 'border-gray-300 bg-white'
                }`}>
                  {isDone && !isCurrent && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {isCurrent && (
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  )}
                </div>
              </div>

              {/* Date — below dot */}
              {dateStr && (
                <span className="text-xs mt-2 text-center text-gray-600 font-medium">
                  {dateStr}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  recordData: Record<string, any>;
  picklistOptions: any[];  // options for the status__a picklist field
}

export default function ClientWorkflowBar({ recordData, picklistOptions }: Props) {
  const currentIdx = resolveCurrentStageIndex(recordData);
  const total = STAGES.length;

  const [windowStart, setWindowStart] = useState(() => resolveWindow(currentIdx, total).start);

  // Recentre the window on the current stage whenever the record itself
  // changes stage (e.g. navigating to a different record) — but leave the
  // user's manual prev/next paging alone otherwise.
  useEffect(() => {
    setWindowStart(resolveWindow(currentIdx, total).start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  const isWindowed = total > WINDOW_SIZE;
  const windowEnd = Math.min(windowStart + WINDOW_SIZE, total);
  const canGoPrev = windowStart > 0;
  const canGoNext = windowEnd < total;

  const goPrev = () => setWindowStart(s => Math.max(0, s - 1));
  const goNext = () => setWindowStart(s => Math.min(total - WINDOW_SIZE, s + 1));

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Client Progress
        </h3>
      </div>

      <div className="flex items-center gap-2">
        {isWindowed && (
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev}
            title="Previous stage"
            className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${
              canGoPrev
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                : 'border-gray-200 text-gray-300 cursor-not-allowed'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="flex-1 min-w-0">
          <StageTrack
            stages={STAGES.slice(windowStart, windowEnd)}
            offset={windowStart}
            currentIdx={currentIdx}
            total={total}
            recordData={recordData}
          />
        </div>

        {isWindowed && (
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext}
            title="Next stage"
            className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${
              canGoNext
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                : 'border-gray-200 text-gray-300 cursor-not-allowed'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
