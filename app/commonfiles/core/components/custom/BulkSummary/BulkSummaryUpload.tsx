'use client';

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import { useCurrentApp } from '../../../hooks/useCurrentApp';
import { bulkMappings, bulkSpec, mergeStandards, parseBulkRows, type BulkRow, type BulkWorkflow } from './bulkSummaryMapping';

const LABELS = { initial: 'Bulk Summary Upload', surveillance: 'Bulk Surv 1 Summary Upload', recertification: 'Bulk Recert Summary Upload' };
type Candidate = { id: string; version: string; data: Record<string, any> };
type Preview = { body: string; targets: Candidate[]; clients: Candidate[]; separate_standard: boolean };
type RowState = { preview?: Preview; target: string; client: string; selected: boolean; error?: string; result?: any };
const rowKey = (row: BulkRow) => `${row.row}:${row.part}`;
const isoKey = (workflow: BulkWorkflow) => workflow === 'initial' ? 'ISOStandard__a' : 'iso_standards__a';
const candidateText = (c: Candidate, workflow: BulkWorkflow) => `${c.data[isoKey(workflow)] || 'Standards not recorded'} · ${c.data.status__a || 'No status'} · ${c.data.certification_body__a || 'Body not recorded'} · ${c.id.slice(0, 8)}`;
const automaticChoice = (candidates: Candidate[]) => candidates.length === 0 ? 'new' : candidates.length === 1 && candidates[0].data.certification_body__a ? candidates[0].id : '';

export default function BulkSummaryUpload({ workflow, onImported }: { workflow: BulkWorkflow; onImported: () => void }) {
  const { userProfile } = useSupabase();
  const [open, setOpen] = useState(false);
  if (userProfile?.role !== 'admin') return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800">{LABELS[workflow]}</button>
    {open && <BulkDialog workflow={workflow} onImported={onImported} onClose={() => setOpen(false)} />}
  </>;
}

function BulkDialog({ workflow, onImported, onClose }: { workflow: BulkWorkflow; onImported: () => void; onClose: () => void }) {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();
  const { selectedApp } = useCurrentApp();
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [reviewedIgnored, setReviewedIgnored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const spec = useMemo(() => bulkSpec(workflow), [workflow]);
  const labels = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [label, field] of Object.entries(bulkMappings(workflow))) if (field.extColumn && !result[field.extColumn]) result[field.extColumn] = label.replace(/\b[a-z]/g, c => c.toUpperCase());
    return result;
  }, [workflow]);
  const parsed = useMemo(() => {
    if (!workbook || !sheetName) return null;
    const sheet = workbook.Sheets[sheetName];
    const bounds = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    if (bounds.s.r !== 0 || bounds.s.c !== 0 || bounds.e.c >= 150) return { value: null, error: 'Start the headings at A1 and use at most 150 columns.' };
    const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    // XLSX readers use saved formula results. Never treat a missing result as blank.
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.f && cell.v === undefined && cells[r - range.s.r]) cells[r - range.s.r][c - range.s.c] = '#MISSING_FORMULA_RESULT';
    }
    try { return { value: parseBulkRows(cells, workflow, overrides), error: '' }; }
    catch (e: any) { return { value: null, error: e.message }; }
  }, [workbook, sheetName, workflow, overrides]);
  const rows = parsed?.value?.rows || [];
  const invalidate = () => { setStates({}); setReviewedIgnored(false); setError(''); setMessage(''); };
  const assertApp = () => {
    if (!selectedApp?.id || !tenant?.id) throw new Error('Select the certification app before uploading.');
    const current = JSON.parse(localStorage.getItem('selected_app') || 'null');
    if (current?.id && current.id !== selectedApp.id) throw new Error('The selected app changed. Close and reopen this upload.');
  };
  const chooseFile = async (selected: File) => {
    invalidate(); setFile(null); setWorkbook(null); setBusy(true);
    try {
      assertApp();
      if (!/\.(xlsx|xls)$/i.test(selected.name) || selected.size > 10 * 1024 * 1024) throw new Error('Choose an .xlsx/.xls file up to 10 MB.');
      const buffer = await selected.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const book = XLSX.read(buffer, { type: 'array', cellDates: false, cellText: true, sheetRows: 1001 });
      if (!book.SheetNames.length) throw new Error('The workbook has no worksheets.');
      // Do not silently truncate a workbook at the reader limit.
      if (book.SheetNames.some(n => book.Sheets[n]['!fullref'])) throw new Error('The workbook is too large. Use at most 500 populated rows per upload.');
      setHash(Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join(''));
      setWorkbook(book); setSheetName(book.SheetNames[0]); setOverrides({}); setFile(selected);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const refreshPreview = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      assertApp();
      const next: Record<string, RowState> = {};
      for (let start = 0; start < rows.length; start += 8) await Promise.all(rows.slice(start, start + 8).map(async row => {
        if (row.errors.length) return;
        const { data, error: rpcError } = await supabase.rpc('preview_bulk_summary_row', { p_app_id: selectedApp!.id, p_workflow: workflow, p_data: row.data });
        if (rpcError) { next[rowKey(row)] = { target: '', client: '', selected: false, error: rpcError.message }; return; }
        const p = data as Preview;
        const target = automaticChoice(p.targets);
        const linked = p.targets.find(c => c.id === target)?.data.external_client_id__a;
        next[rowKey(row)] = { preview: p, target, client: linked || automaticChoice(p.clients), selected: true };
      }));
      setStates(next); setMessage('Preview ready. Review target choices, split records, field changes and excluded columns before applying.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const changeState = (key: string, update: Partial<RowState>) => setStates(old => ({ ...old, [key]: { ...old[key], ...update } }));
  const isReady = (row: BulkRow, state?: RowState) => !!state?.preview && !state.error && !row.errors.length && !!state.target &&
    (workflow === 'initial' || !!state.client && (state.client === 'new' || state.preview.clients.some(c => c.id === state.client)));
  const apply = async () => {
    if (!file || !parsed?.value || parsed.value.ignored.length && !reviewedIgnored) return;
    setBusy(true); setError(''); setMessage('');
    let completed = 0, failed = 0;
    try {
      assertApp();
      const extension = file.name.toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx';
      const path = `${tenant!.id}/bulk_summary_${hash}${extension}`;
      const upload = await supabase.storage.from('tenant-uploads').upload(path, file, { upsert: false });
      if (upload.error) {
        // Storage versions can report a duplicate with different status codes.
        // Continue only if the stored source really contains these same bytes.
        const stored = await supabase.storage.from('tenant-uploads').download(path);
        if (stored.error || !stored.data) throw upload.error;
        const digest = await crypto.subtle.digest('SHA-256', await stored.data.arrayBuffer());
        const storedHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (storedHash !== hash) throw new Error('The stored source workbook differs from this upload. No records were applied.');
      }
      const source = { bucket: 'tenant-uploads', path, name: file.name, size: file.size };
      for (const row of rows) {
        const state = states[rowKey(row)];
        if (!state?.selected || state.result?.success || !isReady(row, state)) continue;
        const target = state.preview!.targets.find(c => c.id === state.target);
        const client = state.preview!.clients.find(c => c.id === state.client);
        const { data, error: rpcError } = await supabase.rpc('apply_bulk_summary_row', {
          p_app_id: selectedApp!.id, p_workflow: workflow, p_file_hash: hash, p_sheet_name: sheetName,
          p_row_number: row.row, p_data: row.data, p_source_file: source,
          p_target_id: target?.id || null, p_target_version: target?.version || null,
          p_client_id: client?.id || null, p_client_version: client?.version || null,
        });
        if (rpcError || data?.success !== true) { failed++; changeState(rowKey(row), { error: rpcError?.message || 'The server did not confirm this import. Refresh preview before retrying.' }); }
        else { completed++; changeState(rowKey(row), { error: undefined, result: data }); }
      }
      setMessage(`${completed} record(s) completed or already applied; ${failed} failed. Unselected or unresolved rows were not applied.`);
      if (completed) onImported();
    } catch (e: any) { setError(e.message || 'Upload failed. Refresh preview before retrying.'); }
    finally { setBusy(false); }
  };
  const ready = rows.filter(row => states[rowKey(row)]?.selected && !states[rowKey(row)].result?.success && isReady(row, states[rowKey(row)])).length;
  return <div className="fixed inset-0 z-50 bg-gray-700/50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={LABELS[workflow]}>
    <div className="bg-white rounded-lg shadow-lg max-w-6xl mx-auto my-10 p-6 space-y-4">
      <div className="flex justify-between gap-4"><div><h2 className="text-lg font-semibold">{LABELS[workflow]}</h2><p className="text-sm text-gray-600">App: {selectedApp?.name || 'Select an app'}. Only 9001, 14001 and 45001 can share a record. Other standards are split into separate records.</p></div><button type="button" disabled={busy} onClick={onClose}>Close</button></div>
      <p className="text-sm text-gray-600">Choose the wide spreadsheet with headings in its first row. Imported dates assert historical milestones; they do not send emails or perform approvals. The complete source workbook is retained for admins only.</p>
      <input ref={fileInput} type="file" accept=".xlsx,.xls" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) return chooseFile(f); }} />
      {workbook && <label className="text-sm">Worksheet <select value={sheetName} disabled={busy} onChange={e => { invalidate(); setOverrides({}); setSheetName(e.target.value); }} className="border rounded p-1 ml-2">{workbook.SheetNames.map(n => <option key={n}>{n}</option>)}</select></label>}
      {(error || parsed?.error) && <p role="alert" className="text-sm text-red-700">{error || parsed?.error}</p>}
      {message && <p role="status" className="text-sm text-blue-800">{message}</p>}
      {parsed?.value && <>
        <details><summary className="cursor-pointer text-sm font-medium">Review column mappings ({parsed.value.headers.length} columns)</summary><div className="max-h-72 overflow-y-auto mt-2"><table className="w-full text-sm"><tbody>{parsed.value.headers.map((h, i) => <tr key={i}><td className="p-1">{h || '(blank heading)'}</td><td><select aria-label={`Map ${h}`} disabled={busy} value={parsed.value!.columns[i]} onChange={e => { invalidate(); setOverrides(old => ({ ...old, [i]: e.target.value })); }} className="border rounded p-1 max-w-md"><option value="">Do not import</option>{Object.keys(spec.fields).map(column => <option key={column} value={column}>{labels[column]} ({spec.fields[column].kind})</option>)}</select></td></tr>)}</tbody></table></div></details>
        {!!parsed.value.ignored.length && <label className="block text-sm bg-amber-50 p-3 rounded"><input type="checkbox" disabled={busy} checked={reviewedIgnored} onChange={e => setReviewedIgnored(e.target.checked)} /> I reviewed these populated columns, which will not be imported: {parsed.value.ignored.join(', ')}.</label>}
        <p className="text-sm">{new Set(rows.map(r => r.row)).size} spreadsheet rows produce {rows.length} record parts. When a mixed row is split, certificate numbers are paired with standards in their original listed order; review each part below.</p>
        <button type="button" disabled={busy || !rows.length} onClick={refreshPreview} className="border rounded px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Working…' : 'Find matches / refresh preview'}</button>
        <div className="max-h-[55vh] overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left bg-gray-100"><th className="p-2">Apply</th><th>Row / company</th><th>Record and original client</th><th>Fields / result</th></tr></thead><tbody>{rows.map(row => {
          const key = rowKey(row), state = states[key], p = state?.preview, target = p?.targets.find(c => c.id === state.target);
          const proposed = target ? mergeStandards(target.data[isoKey(workflow)], row.standards) : row.standards;
          return <tr key={key} className="border-t align-top"><td className="p-2"><input type="checkbox" aria-label={`Apply row ${row.row} ${row.part}`} disabled={busy || !isReady(row, state) || !!state?.result?.success} checked={!!state?.selected} onChange={e => changeState(key, { selected: e.target.checked })} /></td><td className="p-2"><p>Row {row.row}: {row.company}</p><p className="font-medium">{proposed}</p>{row.errors.map((e, i) => <p key={i} className="text-red-700">{e}</p>)}</td><td className="p-2">{p && <>
            <label className="block">Target <select aria-label={`Target row ${row.row} ${row.part}`} disabled={busy || !!state.result?.success} value={state.target} className="border rounded p-1 max-w-md" onChange={e => {
              const linked = p.targets.find(c => c.id === e.target.value)?.data.external_client_id__a;
              changeState(key, { target: e.target.value, client: linked || automaticChoice(p.clients), error: undefined });
            }}><option value="">Choose matching record</option>{p.targets.length === 0 && <option value="new">Create separate/new record</option>}{p.targets.map(c => <option key={c.id} value={c.id}>{candidateText(c, workflow)}</option>)}</select></label>
            {workflow !== 'initial' && <label className="block mt-2">Original client <select aria-label={`Original client row ${row.row} ${row.part}`} value={state.client} disabled={busy || !!state.result?.success || !!target?.data.external_client_id__a} className="border rounded p-1 max-w-md" onChange={e => changeState(key, { client: e.target.value })}><option value="">Choose original client</option>{p.clients.length === 0 && <option value="new">Create linked identity (no Initial milestones)</option>}{p.clients.map(c => <option key={c.id} value={c.id}>{candidateText(c, 'initial')}</option>)}</select></label>}
            {p.separate_standard && <p className="text-xs text-gray-600 mt-1">This standard is kept separate from integrated records.</p>}
            {target?.data.external_client_id__a && !p.clients.some(c => c.id === target.data.external_client_id__a) && workflow !== 'initial' && <p className="text-xs text-red-700 mt-1">The linked original client does not match this company, certification body or integrated group. Resolve its linkage before importing this audit record.</p>}
          </>}</td><td className="p-2"><details><summary className="cursor-pointer">{Object.keys(row.data).length} mapped fields</summary>{Object.entries(row.data).map(([field, value]) => <div key={field} className="mt-1 break-words"><strong>{labels[field]}</strong>: {target?.data[field] ? `${target.data[field]} → ` : ''}{field === isoKey(workflow) ? proposed : value}</div>)}</details>{state?.error && <p className="text-red-700">{state.error}</p>}{state?.result?.success && <p className="text-green-800">{state.result.already_applied ? 'Already applied' : state.result.created ? 'Created' : 'Updated'}: {state.result.record_id}</p>}</td></tr>;
        })}</tbody></table></div>
        <button type="button" disabled={busy || !ready || !!parsed.value.ignored.length && !reviewedIgnored} onClick={apply} className="px-4 py-2 text-sm bg-blue-700 text-white rounded disabled:opacity-50">Apply {ready} selected record part(s)</button>
      </>}
    </div>
  </div>;
}
