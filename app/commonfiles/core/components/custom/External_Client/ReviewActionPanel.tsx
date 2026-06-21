'use client';

import React, { useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';
import SignaturePad, { SignaturePadHandle } from './SignaturePad';

interface Props {
  recordId: string;
  recordData: Record<string, any>;
  currentUserRole: string;
  currentCustomRole: string | null;
  currentUserId: string;
  objectId: string;
  onActionComplete: () => void;
}

type PanelMode = 'idle' | 'rejecting' | 'signing';

export default function ReviewActionPanel({
  recordId,
  recordData,
  currentUserRole,
  currentCustomRole,
  currentUserId,
  objectId,
  onActionComplete,
}: Props) {
  const supabase = createClientComponentClient();
  const [mode, setMode] = useState<PanelMode>('idle');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  // Signature pad ref
  const sigPadRef = useRef<SignaturePadHandle>(null);
  const [sigEmpty, setSigEmpty] = useState(true);

  // Toggle: 'draw' or 'upload'
  const [signMethod, setSignMethod] = useState<'draw' | 'upload'>('draw');

  // Uploaded image option
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const status       = recordData['status__a'] || recordData['status'] || null;
  const clientUserId = recordData['client_user_id__a'];
  const isAdmin      = currentUserRole === 'admin';
  const isCRMOffice  = isAdmin || lower(currentCustomRole).includes('crm');
  const isLinkedClient = isAdmin || currentUserId === clientUserId;

  const showApplicationPanel = isCRMOffice && status === 'Application_Sent';

  const agreementUploaded = !!(
    recordData['clientAgreement__c__a'] &&
    recordData['clientAgreement__c__a'] !== 'null' &&
    recordData['clientAgreement__c__a'] !== '[]'
  );
  const showAgreementPanel = isLinkedClient && agreementUploaded && status !== 'Client_Agreement_Signed';
  const rejectionNotes = recordData['rejection_notes__a'];

  // ── Image upload handler ─────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadedImage(file);
    if (file) {
      setUploadedImagePreview(URL.createObjectURL(file));
    } else {
      setUploadedImagePreview(null);
    }
  };

  const clearImage = () => {
    setUploadedImage(null);
    setUploadedImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // ── Sign & Accept ────────────────────────────────────────────
  const handleSignAndAccept = async () => {
    // Validate whichever method is selected
    if (signMethod === 'draw') {
      const blob = await sigPadRef.current?.getBlob();
      if (!blob) { toast.error('Please draw your signature before accepting.'); return; }
    } else {
      if (!uploadedImage) { toast.error('Please upload a signature image before accepting.'); return; }
    }

    setProcessing(true);
    try {
      // Resolve bucket + path from the stored agreement file metadata
      const rawAgreement = recordData['clientAgreement__c__a'];
      let storageBucket = 'tenant-uploads';
      let storagePath: string | null = null;
      if (rawAgreement) {
        try {
          const parsed = typeof rawAgreement === 'string' ? JSON.parse(rawAgreement) : rawAgreement;
          const entry  = Array.isArray(parsed) ? parsed[0] : parsed;
          storageBucket = entry?.bucket ?? 'tenant-uploads';
          storagePath   = entry?.path   ?? null;
        } catch { /* ignore */ }
      }

      // Resolve display name
      const { data: { user } } = await supabase.auth.getUser();
      const signedBy =
        user?.user_metadata?.full_name ||
        `${user?.user_metadata?.first_name ?? ''} ${user?.user_metadata?.last_name ?? ''}`.trim() ||
        user?.email || 'Client';

      if (storagePath) {
        const fd = new FormData();
        fd.append('storage_bucket', storageBucket);
        fd.append('storage_path', storagePath);
        fd.append('signed_by', signedBy);
        fd.append('sign_method', signMethod);

        if (signMethod === 'draw') {
          const blob = await sigPadRef.current!.getBlob();
          fd.append('signature', new File([blob!], 'signature.png', { type: 'image/png' }));
        } else {
          fd.append('uploaded_image', uploadedImage!);
        }

        const res = await fetch('/api/sign-agreement', { method: 'POST', body: fd });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: 'unknown' }));
          console.error('[sign-agreement]', res.status, errBody);
          toast(`Could not embed signature: ${errBody.error || res.status}`, { icon: '⚠️' });
        }
      } else {
        toast('Agreement file not linked — signature not embedded.', { icon: '⚠️' });
      }

      // Advance status + stamp date
      const { data, error } = await supabase.rpc('review_client_agreement', {
        p_record_id: recordId,
        p_action:    'accept',
        p_notes:     null,
      });

      if (error) { toast.error(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) { toast.error(result?.message || 'Action failed'); return; }

      toast.success('Agreement signed successfully');
      setMode('idle');
      clearImage();
      onActionComplete();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process signature');
    } finally {
      setProcessing(false);
    }
  };

  // ── Generic accept / reject (application panel) ─────────────
  const handleAction = async (action: 'accept' | 'reject', rpc: string) => {
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

  // ── Nothing to show ──────────────────────────────────────────
  if (!showApplicationPanel && !showAgreementPanel) {
    if (isAdmin && rejectionNotes) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Rejection Notes</p>
          <p className="text-sm text-red-800">{rejectionNotes}</p>
        </div>
      );
    }
    return null;
  }

  // ── Application Review Panel ─────────────────────────────────
  if (showApplicationPanel) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-900">Review Application</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Application has been submitted and is awaiting CRM Office review.
            </p>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            Awaiting Review
          </span>
        </div>

        {rejectionNotes && (
          <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <span className="font-semibold">Previous rejection notes: </span>{rejectionNotes}
          </div>
        )}

        {mode === 'rejecting' ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Rejection reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Enter reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleAction('reject', 'review_client_application')} disabled={processing}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
                {processing ? 'Processing...' : 'Confirm Reject'}
              </button>
              <button onClick={() => { setMode('idle'); setNotes(''); }} disabled={processing}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-3">
            <button onClick={() => handleAction('accept', 'review_client_application')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept Application
            </button>
            <button onClick={() => handleAction('reject', 'review_client_application')} disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Agreement Signing Panel ──────────────────────────────────
  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg px-5 py-4 mb-4">

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-purple-900">Sign Client Agreement</p>
          <p className="text-xs text-purple-600 mt-0.5">
            Draw your signature and upload an image where required, then click Sign & Accept.
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 shrink-0 ml-3">
          Awaiting Signature
        </span>
      </div>

      {rejectionNotes && (
        <div className="mb-4 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          <span className="font-semibold">Previous notes: </span>{rejectionNotes}
        </div>
      )}

      {mode === 'rejecting' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason for rejection <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Enter your reason..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-red-500 focus:border-red-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleAction('reject', 'review_client_agreement')} disabled={processing}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
              {processing ? 'Processing...' : 'Confirm Reject'}
            </button>
            <button onClick={() => { setMode('idle'); setNotes(''); }} disabled={processing}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Signature row ── */}
          <div className="rounded-lg border border-purple-200 overflow-hidden mb-4">

            {/* Column headers */}
            <div className="grid grid-cols-2 bg-purple-100 border-b border-purple-200">
              <div className="px-4 py-2 text-xs font-semibold text-purple-800 uppercase tracking-wide">Party</div>
              <div className="px-4 py-2 text-xs font-semibold text-purple-800 uppercase tracking-wide border-l border-purple-200">Signature</div>
            </div>

            {/* FOR ON BEHALF OF CLIENT — single row */}
            <div className="grid grid-cols-2 bg-white">
              <div className="px-4 py-4 flex items-start">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">For On Behalf Of</p>
                  <p className="text-sm font-medium text-gray-900">CLIENT</p>
                </div>
              </div>

              <div className="px-4 py-4 border-l border-purple-100 space-y-3">
                {/* Method toggle */}
                <div className="flex rounded-md overflow-hidden border border-purple-200 w-fit">
                  <button
                    type="button"
                    onClick={() => { setSignMethod('draw'); clearImage(); }}
                    disabled={processing}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      signMethod === 'draw'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-purple-700 hover:bg-purple-50'
                    }`}
                  >
                    Draw
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSignMethod('upload'); sigPadRef.current?.clear(); setSigEmpty(true); }}
                    disabled={processing}
                    className={`px-3 py-1 text-xs font-medium border-l border-purple-200 transition-colors ${
                      signMethod === 'upload'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-purple-700 hover:bg-purple-50'
                    }`}
                  >
                    Upload Image
                  </button>
                </div>

                {/* Draw pad */}
                {signMethod === 'draw' && (
                  <SignaturePad
                    ref={sigPadRef}
                    hideActions
                    disabled={processing}
                    onStrokeEnd={empty => setSigEmpty(empty)}
                  />
                )}

                {/* Upload image */}
                {signMethod === 'upload' && (
                  <div>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      disabled={processing}
                      className="hidden"
                    />
                    {uploadedImagePreview ? (
                      <div className="space-y-2">
                        <img
                          src={uploadedImagePreview}
                          alt="Signature"
                          className="h-16 w-auto object-contain border border-gray-200 rounded"
                        />
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => imageInputRef.current?.click()} disabled={processing}
                            className="text-xs text-purple-600 hover:text-purple-800 underline">Change</button>
                          <span className="text-gray-300">|</span>
                          <button type="button" onClick={clearImage} disabled={processing}
                            className="text-xs text-red-400 hover:text-red-600">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={processing}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-purple-700 bg-purple-50 border border-dashed border-purple-300 rounded-md hover:bg-purple-100 disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Upload signature image
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSignAndAccept}
              disabled={processing || (signMethod === 'draw' ? sigEmpty : !uploadedImage)}
              className="px-5 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {processing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processing…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Sign &amp; Accept
                </>
              )}
            </button>
            <button
              onClick={() => setMode('rejecting')}
              disabled={processing}
              className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          </div>

          {signMethod === 'draw' && sigEmpty && (
            <p className="text-xs text-purple-400 mt-2">Draw your signature above to enable Sign &amp; Accept.</p>
          )}
        </>
      )}
    </div>
  );
}

function lower(s: string | null | undefined): string {
  return (s || '').toLowerCase();
}
