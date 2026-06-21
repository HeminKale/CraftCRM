'use client';

import React from 'react';

interface WorkflowStage {
  label: string;
  dateKey: string;
  statusValue: string;
}

const STAGES: WorkflowStage[] = [
  { label: 'Intimation Sent',     dateKey: 'intimation_sent_date__a',     statusValue: 'Intimation_Sent'     },
  { label: 'Intimation Accepted', dateKey: 'intimation_accepted_date__a', statusValue: 'Intimation_Accepted' },
  { label: 'Audit Plan Sent',     dateKey: 'audit_plan_sent_date__a',     statusValue: 'Audit_Plan_Sent'     },
  { label: 'Audit Plan Accepted', dateKey: 'audit_plan_accepted_date__a', statusValue: 'Audit_Plan_Accepted' },
  { label: 'Renewal Complete',    dateKey: 'certificates_sent_date__a',   statusValue: 'Renewal_Complete'    },
];

function formatDate(value: any): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(value);
  }
}

function resolveCurrentStageIndex(recordData: Record<string, any>): number {
  const rawStatus = recordData['status__a'];
  if (rawStatus) {
    const idx = STAGES.findIndex(s => s.statusValue === rawStatus);
    if (idx !== -1) return idx;
  }
  let lastFilled = -1;
  for (let i = 0; i < STAGES.length; i++) {
    if (recordData[STAGES[i].dateKey]) lastFilled = i;
  }
  return lastFilled;
}

interface Props {
  status: string | null;
  recordData: Record<string, any>;
}

export default function RenewalWorkflowBar({ recordData }: Props) {
  const currentIdx = resolveCurrentStageIndex(recordData);

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Renewal Progress
      </h3>

      <div className="relative flex items-start">
        <div className="relative z-10 flex w-full justify-between">
          {STAGES.map((stage, idx) => {
            const isDone    = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            const dateStr   = formatDate(recordData[stage.dateKey]);

            return (
              <div key={stage.label} className="flex flex-col items-center flex-1 min-w-0">

                {/* Label — above dot */}
                <span className={`text-xs font-medium text-center leading-tight mb-2 px-1 ${
                  isDone ? 'text-gray-900' : 'text-gray-400'
                }`}>
                  {stage.label}
                </span>

                {/* Dot + connectors */}
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

                  {/* Dot */}
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
