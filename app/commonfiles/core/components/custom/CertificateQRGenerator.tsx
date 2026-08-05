'use client';

import React, { useState, useRef } from 'react';
import { QrCode, Download, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import * as QRCode from 'qrcode';

// GitHub Pages URL — QR code encodes this base URL + certificate data as query params
const VERIFICATION_PAGE_BASE_URL = 'https://salesqr.github.io/preview/certificate_verification.html';

const CERTIFICATION_BODY_OPTIONS = [
  { label: 'None', value: '' },
  { label: 'Americo', value: 'Americo' },
  { label: 'BQSR', value: 'BQSR' },
  { label: 'AQSR', value: 'AQSR' },
] as const;

interface FormState {
  certificateNumber: string;
  companyName: string;
  certificateStandard: string;
  issueDate: string;
  expiryDate: string;
  certificationBody: string;
  accreditationBody: string;
}

const EMPTY_FORM: FormState = {
  certificateNumber: '',
  companyName: '',
  certificateStandard: '',
  issueDate: '',
  expiryDate: '',
  certificationBody: '',  // Default to "None" (empty string)
  accreditationBody: '',
};

interface CertificateQRGeneratorProps {
  tabId?: string;
  tabLabel?: string;
  onCancel?: () => void;
}

export default function CertificateQRGenerator({ onCancel }: CertificateQRGeneratorProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleChange = (field: keyof FormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const buildVerificationUrl = (): string => {
    const params = new URLSearchParams({
      cert: form.certificateNumber,
      company: form.companyName,
      standard: form.certificateStandard,
      issue: form.issueDate,
      expiry: form.expiryDate,
      body: form.certificationBody,
      accreditation: form.accreditationBody,
    });
    return `${VERIFICATION_PAGE_BASE_URL}?${params.toString()}`;
  };

  const handleGenerate = async () => {
    if (!form.certificateNumber.trim() || !form.companyName.trim()) {
      toast.error('Certificate Number and Company Name are required');
      return;
    }
    if (!canvasRef.current) return;

    setGenerating(true);
    try {
      const url = buildVerificationUrl();
      await QRCode.toCanvas(canvasRef.current, url, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'H',
      });
      // JPEG has no transparency — flatten onto a white background before
      // reading back the data URL, otherwise transparent QR modules can turn
      // black on some viewers.
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      setQrDataUrl(canvasRef.current.toDataURL('image/jpeg', 0.95));
      toast.success('QR code generated');
    } catch (err: any) {
      console.error('QR generation failed:', err);
      toast.error(err?.message || 'Failed to generate QR code');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${form.certificateNumber || 'certificate'}-qr.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setQrDataUrl(null);
  };

  const inputClass =
    'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

  return (
    <div className="bg-white p-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Certificate QR Code Generator</h2>
          <p className="text-sm text-gray-500 mt-1">
            Enter certificate details and generate a scannable QR code linking to the verification page.
          </p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>
                Certificate Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.certificateNumber}
                onChange={e => handleChange('certificateNumber', e.target.value)}
                className={inputClass}
                placeholder="e.g. AMER402307"
              />
            </div>

            <div>
              <label className={labelClass}>
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.companyName}
                onChange={e => handleChange('companyName', e.target.value)}
                className={inputClass}
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div>
              <label className={labelClass}>Certificate Standard</label>
              <input
                type="text"
                value={form.certificateStandard}
                onChange={e => handleChange('certificateStandard', e.target.value)}
                className={inputClass}
                placeholder="e.g. ISO 9001:2015"
              />
            </div>

            <div>
              <label className={labelClass}>Certification Body</label>
              <select
                value={form.certificationBody}
                onChange={e => handleChange('certificationBody', e.target.value)}
                className={inputClass}
              >
                {CERTIFICATION_BODY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Issue Date</label>
              <input
                type="date"
                value={form.issueDate}
                onChange={e => handleChange('issueDate', e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Expiry Date</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={e => handleChange('expiryDate', e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="md:col-span-2">
              <label className={labelClass}>Accreditation Body</label>
              <input
                type="text"
                value={form.accreditationBody}
                onChange={e => handleChange('accreditationBody', e.target.value)}
                className={inputClass}
                placeholder="e.g. UAF"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <QrCode className="w-4 h-4" />
              {generating ? 'Generating...' : 'Generate QR Code'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>

        {/* Right: QR preview */}
        <div className="flex flex-col items-center justify-start">
          <label className={labelClass + ' self-start lg:self-center'}>Preview</label>
          <div className="border-2 border-dashed border-gray-300 rounded-md p-6 w-full flex flex-col items-center justify-center min-h-[300px] bg-gray-50">
            <canvas
              ref={canvasRef}
              className={qrDataUrl ? 'rounded shadow-sm' : 'hidden'}
            />
            {!qrDataUrl && (
              <div className="text-center text-gray-400">
                <QrCode className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">QR code will appear here</p>
              </div>
            )}
          </div>

          {qrDataUrl && (
            <button
              type="button"
              onClick={handleDownload}
              className="mt-4 px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download JPEG
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
