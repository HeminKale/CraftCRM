'use client';

import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle, FileText, RotateCcw, Image as ImageIcon, X } from 'lucide-react';
import { createClientSupabaseClient } from '../../lib/supabase';
import { useSupabase } from '../../providers/SupabaseProvider';

interface ClientData {
  id: string;
  name: string;
  address__a?: string;
  scope__a?: string;
  'ISO standard__a'?: string;
  isoStandard__a?: string; // Alternative field name for draft objects
  iso_standard__a?: string; // Snake case field name for certificate objects
  ISO_standard__a?: string; // Alternative snake case field name
  isoStandard?: string; // Alternative field name
  ISO_standard?: string; // Alternative field name
  Client_name__a?: string; // Client reference field for draft records
  // Draft record fields
  certificateNumber__a?: string;
  originalIssueDate__a?: string;
  issueDate__a?: string;
  surveillanceDate__a?: string;
  recertificationDate__a?: string;
  revision__a?: string;
  initialRegistrationDate__a?: string;
  surveillanceDueDate__a?: string;
  expiryDate__a?: string;
  size__a?: string;
  accreditation__a?: string;
  extraLine__a?: string;
  logo__a?: string;
}

interface PrintableGenerationData {
  "Company Name": string;
  "Address": string;
  "Address alignment": string;  // ✅ ADDED: Address alignment support
  "ISO Standard": string;
  "Scope": string;
  "Certificate Number": string;
  "Original Issue Date": string;
  "Issue Date": string;
  "Surveillance/ Expiry Date": string;
  "Recertification Date": string;
  "Revision": string;
  "Initial Registration Date": string;
  "Surveillance Due Date": string;
  "Expiry Date": string;
  "Logo": string;
  "Size": string;
  "Accreditation": string;
  "Extra Line": string;
  "Country": string;
  "Language": string;  // ✅ ADDED: Language field support
}

interface ClientPrintableGeneratorProps {
  recordId?: string;
  objectId: string;
  tenantId?: string;
  recordData?: any;
  selectedRecordIds?: string[];
}

function ClientPrintableGenerator({ recordId, objectId, tenantId, recordData, selectedRecordIds }: ClientPrintableGeneratorProps) {
  const [currentRecord, setCurrentRecord] = useState<ClientData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string}>({current: 0, total: 0, stage: ''});
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  
  // State for multiple records
  const [allRecords, setAllRecords] = useState<ClientData[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  
  // Form data state for manual input fields
  const [formData, setFormData] = useState({
    certificateNumber: '',
    originalIssueDate: '',
    issueDate: '',
    surveillanceExpiryDate: '',
    recertificationDate: '',
    revision: '',
    initialRegistrationDate: '',
    surveillanceDueDate: '',
    expiryDate: '',
    size: 'high',
    accreditation: 'yes',
    extraLine: '',
    country: '',
    addressAlignment: 'center',  // ✅ ADDED: Address alignment support
    language: '',  // ✅ ADDED: Language field support
  });

  // Get tenant context
  const { userProfile, tenant } = useSupabase();
  const supabase = createClientSupabaseClient();

  // Initialize component
  useEffect(() => {
    console.log('🔍 [PRINTABLE] Initializing ClientPrintableGenerator...');
    console.log('🔍 [PRINTABLE] recordId:', recordId);
    console.log('🔍 [PRINTABLE] recordData:', recordData);
    console.log('🔍 [PRINTABLE] selectedRecordIds:', selectedRecordIds);
    
    // Debug: Log complete record structure immediately
    if (recordData) {
      console.log('🔍 [PRINTABLE] Complete recordData object:', JSON.stringify(recordData, null, 2));
      console.log('🔍 [PRINTABLE] All recordData fields:', Object.keys(recordData));
    }

    if (selectedRecordIds && selectedRecordIds.length > 0) {
      // Bulk mode - multiple records selected
      console.log('🔍 [PRINTABLE] Bulk mode detected');
      setIsBulkMode(true);
      setAllRecords(recordData || []);
    } else if (recordId && recordData) {
      // Single record mode
      setIsBulkMode(false);
      setCurrentRecord(recordData);
      
      // Auto-populate form data from draft record if available
      if (recordData) {
        setFormData(prev => ({
          ...prev,
          certificateNumber: recordData.certificateNumber__a || '',
          originalIssueDate: recordData.originalIssueDate__a || '',
          issueDate: recordData.issueDate__a || '',
          surveillanceExpiryDate: recordData.surveillanceDate__a || '',
          recertificationDate: recordData.recertificationDate__a || '',
          revision: recordData.revision__a || '',
          initialRegistrationDate: recordData.initialRegistrationDate__a || '',
          surveillanceDueDate: recordData.surveillanceDueDate__a || '',
          expiryDate: recordData.expiryDate__a || '',
          size: recordData.size__a || 'high',
          accreditation: recordData.accreditation__a || 'yes',
          extraLine: recordData.extraLine__a || '',
          country: recordData.country__a || ''
        }));
      }
    }
  }, [recordId, recordData, selectedRecordIds]);

  // Prepare printable data for a single record
  const preparePrintableDataForRecord = (record: ClientData): PrintableGenerationData => {
    // Ensure we have a valid company name - this is required by the backend
    const companyName = record.name || record.id || 'Unknown Company';
    
   
    
   
    
    // Extract ISO Standard with detailed logging
    const extractedIsoStandard = record.isoStandard__a || record['ISO standard__a'] || record.iso_standard__a || record.ISO_standard__a || record.isoStandard || record.ISO_standard || '';
    console.log('🔍 [PRINTABLE] Final extracted ISO Standard:', extractedIsoStandard);
    
    return {
      "Company Name": companyName,
      "Address": record.address__a || '',
      "Address alignment": formData.addressAlignment || 'center',  // ✅ ADDED: Address alignment support
      "ISO Standard": extractedIsoStandard,
      "Scope": record.scope__a || '',
      "Certificate Number": formData.certificateNumber || `PRINT-${companyName.substring(0, 3).toUpperCase()}-${Date.now()}`,
      "Original Issue Date": formData.originalIssueDate || '',
      "Issue Date": formData.issueDate || '',
      "Surveillance/ Expiry Date": formData.surveillanceExpiryDate || '',
      "Recertification Date": formData.recertificationDate || '',
      "Revision": formData.revision || '',
      "Initial Registration Date": formData.initialRegistrationDate || '',
      "Surveillance Due Date": formData.surveillanceDueDate || '',
      "Expiry Date": formData.expiryDate || '',
      "Logo": logoFiles.length > 0 ? logoFiles[0].name : '',
      "Size": formData.size || 'high',
      "Accreditation": formData.accreditation || 'yes',
      "Extra Line": formData.extraLine || '',
      "Country": formData.country || '',
      "Language": formData.language || '',  // ✅ ADDED: Language field support
    };
  };

  // Generate printable using existing printable generation logic
  const generatePrintable = async () => {
    if (isBulkMode) {
      await generateBulkPrintables();
    } else {
      await generateSinglePrintable();
    }
  };

  // Generate single printable
  const generateSinglePrintable = async () => {
    if (!currentRecord) {
      setError("Record data not available");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);
      setProgress({ current: 1, total: 4, stage: 'Preparing printable generation...' });

      // Prepare data for this record
      const printableData = preparePrintableDataForRecord(currentRecord);
      console.log('🔍 [PRINTABLE] Printable data prepared:', printableData);

      setProgress({ current: 2, total: 4, stage: 'Generating printable certificate...' });

      // Create FormData for the API call (using individual form parameters)
      const formDataPayload = new FormData();
      
      // ✅ UPDATED: Send individual form parameters (this is what the backend expects)
      formDataPayload.append('company_name', printableData["Company Name"]);
      formDataPayload.append('address', printableData["Address"]);
      formDataPayload.append('address_alignment', printableData["Address alignment"]);
      formDataPayload.append('iso_standard', printableData["ISO Standard"]);
      formDataPayload.append('scope', printableData["Scope"]);
      formDataPayload.append('certificate_number', printableData["Certificate Number"]);
      formDataPayload.append('original_issue_date', printableData["Original Issue Date"]);
      formDataPayload.append('issue_date', printableData["Issue Date"]);
      formDataPayload.append('surveillance_date', printableData["Surveillance/ Expiry Date"]);
      formDataPayload.append('recertification_date', printableData["Recertification Date"]);
      formDataPayload.append('revision', printableData["Revision"]);
      formDataPayload.append('size', printableData["Size"]);
      formDataPayload.append('accreditation', printableData["Accreditation"]);
      formDataPayload.append('country', printableData["Country"]);
      formDataPayload.append('initial_registration_date', printableData["Initial Registration Date"]);
      formDataPayload.append('surveillance_due_date', printableData["Surveillance Due Date"]);
      formDataPayload.append('expiry_date', printableData["Expiry Date"]);
      formDataPayload.append('extra_line', printableData["Extra Line"]);
      formDataPayload.append('logo', printableData["Logo"]);

      // Debug: Log what we're sending
      console.log('🔍 [PRINTABLE] FormData being sent:');
      Array.from(formDataPayload.entries()).forEach(([key, value]) => {
        console.log(`  ${key}:`, value);
      });
      
      // Additional debug: Check if company_name is actually in FormData
      console.log('🔍 [PRINTABLE] FormData has company_name:', formDataPayload.has('company_name'));
      console.log('🔍 [PRINTABLE] FormData get company_name:', formDataPayload.get('company_name'));

      // Add logo files if any
      logoFiles.forEach((file, index) => {
        formDataPayload.append(`logo_files`, file);
      });

      // Call the printable generation API
      const response = await fetch('/api/pdf/generate-printable', {
        method: 'POST',
        body: formDataPayload,
        // Don't set Content-Type header - let the browser set it with boundary for FormData
      });

      if (!response.ok) {
        let errorMessage = 'Failed to generate printable certificate';
        try {
          const errorData = await response.json();
          console.log('🔍 [PRINTABLE] Error response:', errorData);
          
          // Handle different error response formats
          if (errorData.error && Array.isArray(errorData.error)) {
            // FastAPI validation error format
            const firstError = errorData.error[0];
            errorMessage = `${firstError.loc?.join('.')}: ${firstError.msg}`;
          } else if (errorData.detail) {
            errorMessage = errorData.detail;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (parseError) {
          console.log('🔍 [PRINTABLE] Could not parse error response:', parseError);
          errorMessage = `${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      setProgress({ current: 3, total: 4, stage: 'Downloading printable certificate...' });

      const pdfBlob = await response.blob();
      
      // Create filename
      const companyName = currentRecord.name || 'Unknown';
      const sanitizedCompanyName = companyName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
      const filename = `${sanitizedCompanyName}_Printable_Certificate.pdf`;
      
      // Download the PDF
      const url = window.URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setProgress({ current: 4, total: 4, stage: 'Printable generated successfully!' });
      setSuccess(`Printable certificate generated successfully for ${currentRecord.name}`);

    } catch (error) {
      console.error('Error generating printable:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0, stage: '' });
    }
  };

  // Generate bulk printables
  const generateBulkPrintables = async () => {
    if (!allRecords || allRecords.length === 0) {
      setError("No records available for bulk generation");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);
      setProgress({ current: 1, total: allRecords.length + 2, stage: 'Preparing bulk printable generation...' });

      const pdfResults: Array<{blob: Blob, filename: string}> = [];
      
      // Process each record
      for (let i = 0; i < allRecords.length; i++) {
        const record = allRecords[i];
        setProgress({ 
          current: i + 2, 
          total: allRecords.length + 2, 
          stage: `Generating printable for ${record.name || 'Unknown Company'}...` 
        });

        try {
          // Prepare data for this record
          const printableData = preparePrintableDataForRecord(record);

          // Create FormData for the API call (using individual form parameters)
          const formDataPayload = new FormData();
          
          // ✅ UPDATED: Send individual form parameters (this is what the backend expects)
          formDataPayload.append('company_name', printableData["Company Name"]);
          formDataPayload.append('address', printableData["Address"]);
          formDataPayload.append('address_alignment', printableData["Address alignment"]);
          formDataPayload.append('iso_standard', printableData["ISO Standard"]);
          formDataPayload.append('scope', printableData["Scope"]);
          formDataPayload.append('certificate_number', printableData["Certificate Number"]);
          formDataPayload.append('original_issue_date', printableData["Original Issue Date"]);
          formDataPayload.append('issue_date', printableData["Issue Date"]);
          formDataPayload.append('surveillance_date', printableData["Surveillance/ Expiry Date"]);
          formDataPayload.append('recertification_date', printableData["Recertification Date"]);
          formDataPayload.append('revision', printableData["Revision"]);
          formDataPayload.append('size', printableData["Size"]);
          formDataPayload.append('accreditation', printableData["Accreditation"]);
          formDataPayload.append('country', printableData["Country"]);
          formDataPayload.append('initial_registration_date', printableData["Initial Registration Date"]);
          formDataPayload.append('surveillance_due_date', printableData["Surveillance Due Date"]);
          formDataPayload.append('expiry_date', printableData["Expiry Date"]);
          formDataPayload.append('extra_line', printableData["Extra Line"]);
          formDataPayload.append('logo', printableData["Logo"]);

          // Debug: Log what we're sending for this record
          console.log(`🔍 [PRINTABLE] FormData for ${record.name}:`);
          Array.from(formDataPayload.entries()).forEach(([key, value]) => {
            console.log(`  ${key}:`, value);
          });

          // Add logo files if any
          logoFiles.forEach((file, index) => {
            formDataPayload.append(`logo_files`, file);
          });

          // Call the printable generation API
          const response = await fetch('/api/pdf/generate-printable', {
            method: 'POST',
            body: formDataPayload,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to generate printable certificate';
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorMessage;
            } catch {
              errorMessage = `${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
          }

          const pdfBlob = await response.blob();
          
          // Create filename
          const companyName = record.name || 'Unknown';
          const sanitizedCompanyName = companyName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
          const filename = `${sanitizedCompanyName}_Printable_Certificate.pdf`;
          
          pdfResults.push({
            blob: pdfBlob,
            filename: filename
          });

          console.log(`✅ Generated printable for ${companyName}`);

        } catch (error) {
          console.error(`❌ Error generating printable for ${record.name || 'Unknown'}:`, error);
          // Continue with other records instead of stopping
          continue;
        }
      }

      setProgress({ 
        current: allRecords.length + 2, 
        total: allRecords.length + 3, 
        stage: 'Creating ZIP file...' 
      });

      // Create ZIP file
      if (pdfResults.length > 0) {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        
        pdfResults.forEach(({ blob, filename }) => {
          zip.file(filename, blob);
        });
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = window.URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bulk_printable_certificates_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        setSuccess(`Bulk printable generation completed: ${pdfResults.length}/${allRecords.length} certificates generated`);
        setProgress({ current: 0, total: 0, stage: '' });
      } else {
        throw new Error('No certificates were generated successfully');
      }

    } catch (error) {
      console.error('Error in bulk printable generation:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0, stage: '' });
    }
  };

  // Handle logo file upload
  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const fileArray = Array.from(files);
      setLogoFiles(prev => [...prev, ...fileArray]);
    }
  };

  // Remove logo file
  const removeLogoFile = (index: number) => {
    setLogoFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Handle form data changes
  const handleFormDataChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Generate Printable Certificate</h2>
        <p className="text-gray-600">
          {isBulkMode 
            ? `Generate printable certificates for ${allRecords.length} selected records`
            : `Generate printable certificate for ${currentRecord?.name || 'selected record'}`
          }
        </p>
      </div>

      {/* Progress Bar */}
      {isGenerating && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
            <span>{progress.stage}</span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
          <div className="flex">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800">Success</h3>
              <div className="mt-2 text-sm text-green-700">{success}</div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Extracted Fields Display */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Information</h3>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-1">
                Company Name
              </label>
              <div className="text-sm text-blue-700 bg-white px-3 py-2 rounded border">
                {currentRecord?.name || 'Not available'}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-1">
                Address
              </label>
              <div className="text-sm text-blue-700 bg-white px-3 py-2 rounded border">
                {currentRecord?.address__a || 'Not available'}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-1">
                ISO Standard
              </label>
              <div className="text-sm text-blue-700 bg-white px-3 py-2 rounded border">
                {currentRecord?.isoStandard__a || currentRecord?.['ISO standard__a'] || currentRecord?.iso_standard__a || currentRecord?.ISO_standard__a || currentRecord?.isoStandard || currentRecord?.ISO_standard || 'Not available'}
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-blue-800 mb-1">
                Scope
              </label>
              <div className="text-sm text-blue-700 bg-white px-3 py-2 rounded border">
                {currentRecord?.scope__a || 'Not available'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Input Fields */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Certificate Details</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Certificate Number *
            </label>
            <input
              type="text"
              value={formData.certificateNumber}
              onChange={(e) => handleFormDataChange('certificateNumber', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter certificate number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Country
            </label>
            <input
              type="text"
              value={formData.country}
              onChange={(e) => handleFormDataChange('country', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter country"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address Alignment
            </label>
            <select
              value={formData.addressAlignment}
              onChange={(e) => handleFormDataChange('addressAlignment', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Language
            </label>
            <select
              value={formData.language}
              onChange={(e) => handleFormDataChange('language', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">(Blank)</option>
              <option value="S">S</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Original Issue Date
            </label>
            <input
              type="date"
              value={formData.originalIssueDate}
              onChange={(e) => handleFormDataChange('originalIssueDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Issue Date
            </label>
            <input
              type="date"
              value={formData.issueDate}
              onChange={(e) => handleFormDataChange('issueDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Surveillance/Expiry Date
            </label>
            <input
              type="date"
              value={formData.surveillanceExpiryDate}
              onChange={(e) => handleFormDataChange('surveillanceExpiryDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recertification Date
            </label>
            <input
              type="date"
              value={formData.recertificationDate}
              onChange={(e) => handleFormDataChange('recertificationDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Initial Registration Date
            </label>
            <input
              type="date"
              value={formData.initialRegistrationDate}
              onChange={(e) => handleFormDataChange('initialRegistrationDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Surveillance Due Date
            </label>
            <input
              type="date"
              value={formData.surveillanceDueDate}
              onChange={(e) => handleFormDataChange('surveillanceDueDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Date
            </label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => handleFormDataChange('expiryDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Revision
            </label>
            <input
              type="text"
              value={formData.revision}
              onChange={(e) => handleFormDataChange('revision', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter revision"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Size
            </label>
            <select
              value={formData.size}
              onChange={(e) => handleFormDataChange('size', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Accreditation
            </label>
            <select
              value={formData.accreditation}
              onChange={(e) => handleFormDataChange('accreditation', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Extra Line
          </label>
          <textarea
            value={formData.extraLine}
            onChange={(e) => handleFormDataChange('extraLine', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter extra line text"
          />
        </div>
      </div>

      {/* Logo Upload */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Logo Upload</h3>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
            id="logo-upload"
          />
          <label
            htmlFor="logo-upload"
            className="cursor-pointer flex flex-col items-center justify-center"
          >
            <ImageIcon className="h-12 w-12 text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">Click to upload logo files</span>
            <span className="text-xs text-gray-400">PNG, JPG, JPEG supported</span>
          </label>
        </div>
        
        {logoFiles.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Uploaded Files:</h4>
            <div className="space-y-2">
              {logoFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                  <span className="text-sm text-gray-700">{file.name}</span>
                  <button
                    onClick={() => removeLogoFile(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Generate Button */}
      <div className="flex justify-end">
        <button
          onClick={generatePrintable}
          disabled={isGenerating}
          className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Generating...
            </>
          ) : (
            <>
              <Download className="h-5 w-5 mr-2" />
              {isBulkMode ? 'Generate Bulk Printables' : 'Generate Printable'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ClientPrintableGenerator;
