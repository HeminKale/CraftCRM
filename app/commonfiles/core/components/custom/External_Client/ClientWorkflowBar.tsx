'use client';

import React from 'react';

// Each stage: label shown on bar, the date column key in recordData,
// and the picklist value that maps to this stage being "current"
interface WorkflowStage {
  label: string;
  dateKey: string;        // key in recordData (with __a suffix)
  statusValue: string;    // picklist value stored in status__a
}

const STAGES: WorkflowStage[] = [
  { label: 'Application Sent',          dateKey: 'Date__a',                          statusValue: 'Application_Sent' },
  { label: 'Application Accepted',      dateKey: 'Application_Accpeted_Date__a',     statusValue: 'Application_Accepted' },
  { label: 'Quotation Received',        dateKey: 'Quotation_Received_Date__a',       statusValue: 'Quotation_Received' },
  { label: 'Client Agreement Signed',   dateKey: 'Client_Agreement_Signed_Date__a',  statusValue: 'Client_Agreement_Signed' },
  { label: 'Stage 1 Plan Sent',         dateKey: 'Stage_one_plan_Sent_Date__a',      statusValue: 'Stage_one_plan_Sent' },
  { label: 'Stage 1 Audit Done',        dateKey: 'Stage_one_Audit_Done_on__a',       statusValue: 'Stage_one_Audit_Done' },
  { label: 'Report Sent',               dateKey: 'Report_Sent_Date__a',              statusValue: 'Report_Sent' },
];

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
function resolveCurrentStageIndex(
  recordData: Record<string, any>,
  picklistOptions: any[]
): number {
  // Try status__a override first — compare against picklist value directly
  const rawStatus = recordData['status__a'];
  if (rawStatus) {
    const overrideIdx = STAGES.findIndex(
      s => s.statusValue === rawStatus
    );
    if (overrideIdx !== -1) return overrideIdx;
  }

  // Fall back to date-driven: last stage with a date filled
  let lastFilledIdx = -1;
  for (let i = 0; i < STAGES.length; i++) {
    if (recordData[STAGES[i].dateKey]) lastFilledIdx = i;
  }
  return lastFilledIdx;
}

interface Props {
  recordData: Record<string, any>;
  picklistOptions: any[];  // options for the status__a picklist field
}

export default function ClientWorkflowBar({ recordData, picklistOptions }: Props) {
  const currentIdx = resolveCurrentStageIndex(recordData, picklistOptions);

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Client Progress
      </h3>

      {/* Workflow track */}
      <div className="relative flex items-start">

          {/* Stages */}
        <div className="relative z-10 flex w-full justify-between">
          {STAGES.map((stage, idx) => {
            const isDone    = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            const dateVal   = recordData[stage.dateKey];
            const dateStr   = formatDate(dateVal);

            // Line segment to the right of this dot (except last)
            const lineRight = idx < STAGES.length - 1;
            const lineColor = idx < currentIdx ? 'bg-green-500' : 'bg-gray-200';

            return (
              <div key={stage.label} className="flex flex-col items-center flex-1 min-w-0">
                {/* Stage label — above dot */}
                <span className={`text-xs font-medium text-center leading-tight mb-2 px-1 ${
                  isDone ? 'text-gray-900' : 'text-gray-400'
                }`}>
                  {stage.label}
                </span>

                {/* Dot + connecting lines */}
                <div className="relative flex items-center w-full justify-center">
                  {/* Left connector */}
                  {idx > 0 && (
                    <div className={`absolute right-1/2 top-1/2 -translate-y-1/2 h-0.5 w-1/2 ${
                      idx <= currentIdx ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                  )}
                  {/* Right connector */}
                  {idx < STAGES.length - 1 && (
                    <div className={`absolute left-1/2 top-1/2 -translate-y-1/2 h-0.5 w-1/2 ${
                      idx < currentIdx ? 'bg-green-500' : 'bg-gray-200'
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
    </div>
  );
}
