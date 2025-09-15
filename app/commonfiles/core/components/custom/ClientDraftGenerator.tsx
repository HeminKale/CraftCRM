'use client';

import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle, FileText, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { createClientSupabaseClient } from '../../lib/supabase';
import { useSupabase } from '../../providers/SupabaseProvider';

interface ClientData {
  id: string;
  name: string;
  address__a?: string;
  scope__a?: string;
  'ISO standard__a'?: string;
  isoStandard__a?: string; // Alternative field name for draft objects
  channelPartner__a?: string;
  type__a?: string;
  size__a?: string;
  accreditation__a?: string;
  logo__a?: string;
  originalIssueDate__a?: string;
  surveillanceDate__a?: string;
  issueDate__a?: string;
  recertificationDate__a?: string;
  certificateNumber__a?: string;
}

interface DraftGenerationData {
  "Company Name": string;
  "Address": string;
  "Address alignment": string;  // ✅ ADDED: Address alignment support
  "ISO Standard": string;
  "Scope": string;
  "Channel Partner": string;
  "Type": string;
  "Size": string;
  "Accreditation": string;
  "Logo": string;
  "Country": string;
  "Certificate Number": string;
  "Original Issue Date": string;
  "Issue Date": string;
  "Surveillance/ Expiry Date": string;
  "Recertification Date": string;
  "Initial Registration Date": string;
  "Surveillance Due Date": string;
  "Expiry Date": string;
  "Revision": string;
  "Extra Line": string;
  "Language": string;  // ✅ ADDED: Language field support
}

interface ClientDraftGeneratorProps {
  recordId?: string;
  objectId: string;
  tenantId?: string;
  recordData?: any;
  selectedRecordIds?: string[];
}

function ClientDraftGenerator({ recordId, objectId, tenantId, recordData, selectedRecordIds }: ClientDraftGeneratorProps) {
  console.log('🔍 === CLIENT DRAFT GENERATOR FUNCTION START ===');
  console.log('🔍 Props received:', { recordId, objectId, tenantId, recordData, selectedRecordIds });
  console.log('🔍 recordData type:', typeof recordData);
  console.log('🔍 recordData is array:', Array.isArray(recordData));
  console.log('🔍 selectedRecordIds type:', typeof selectedRecordIds);
  console.log('🔍 selectedRecordIds is array:', Array.isArray(selectedRecordIds));
  const [currentRecord, setCurrentRecord] = useState<ClientData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string}>({current: 0, total: 0, stage: ''});
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  
  // NEW: State for multiple records
  const [allRecords, setAllRecords] = useState<ClientData[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  
  // Optional fields visibility state - Set default selected fields as requested
  const [optionalFields, setOptionalFields] = useState({
    showChannelPartner: false,
    showType: false,
    showSize: false,
    showAccreditation: false,
    showLogo: false,
    showCountry: false,
    showCertificateNumber: true, // Default selected
    showOriginalIssueDate: true, // Default selected
    showIssueDate: true, // Default selected
    showSurveillanceExpiryDate: true, // Default selected
    showRecertificationDate: false,
    showInitialRegistrationDate: false,
    showSurveillanceDueDate: false,
    showExpiryDate: false,
    showRevision: false,
    showExtraLine: false,
  });

  // NEW: Picklist values for specific fields
  const [fieldValues, setFieldValues] = useState({
    accreditation: 'yes', // Default to 'yes'
    country: '', // Default to blank
    size: 'low', // Default to 'low'
  });

  // Form data state for manual input fields
  const [formData, setFormData] = useState({
    extraLine: '',
    addressAlignment: '',  // ✅ ADDED: Address alignment support
    language: '',          // ✅ ADDED: Language field support
  });

  // Bulk mode: Extra Line settings for each record
  const [bulkExtraLineSettings, setBulkExtraLineSettings] = useState<{[recordId: string]: {enabled: boolean, value: string}}>({});

  // Get tenant context
  const { userProfile, tenant } = useSupabase();
  const supabase = createClientSupabaseClient();

  // Handler for form data changes
  const handleFormDataChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handler for bulk Extra Line checkbox changes
  const handleBulkExtraLineToggle = (recordId: string, enabled: boolean) => {
    setBulkExtraLineSettings(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        enabled,
        value: prev[recordId]?.value || ''
      }
    }));
  };

  // Handler for bulk Extra Line value changes
  const handleBulkExtraLineValueChange = (recordId: string, value: string) => {
    setBulkExtraLineSettings(prev => ({
      ...prev,
      [recordId]: {
        ...prev[recordId],
        value
      }
    }));
  };

  // Load record data when component mounts
  useEffect(() => {
    console.log('🔍 === CLIENT DRAFT GENERATOR MOUNT ===');
    console.log('🔍 selectedRecordIds:', selectedRecordIds);
    console.log('🔍 selectedRecordIds length:', selectedRecordIds?.length);
    console.log('🔍 recordId:', recordId);
    console.log('🔍 recordData:', recordData);
    console.log('🔍 recordData is array:', Array.isArray(recordData));
    console.log('🔍 recordData length:', recordData?.length);
    
    if (selectedRecordIds && selectedRecordIds.length > 0) {
      // Bulk mode - check if we have pre-fetched data or need to fetch
      console.log('🔍 ✅ Setting bulk mode to TRUE');
      setIsBulkMode(true);
      
      if (recordData && Array.isArray(recordData) && recordData.length > 0) {
        // Use pre-fetched record data
        console.log('✅ Using pre-fetched record data for bulk mode:', recordData);
        setAllRecords(recordData);
      } else {
        // Fetch multiple records if not pre-fetched
        console.log('🔍 Fetching records for bulk mode...');
        fetchMultipleRecords();
      }
    } else if (recordId && recordData) {
      // Single record mode
      console.log('🔍 ✅ Setting bulk mode to FALSE (single record)');
      setIsBulkMode(false);
      setCurrentRecord(recordData);
    } else {
      console.log('🔍 ⚠️ No clear mode detected - setting bulk mode to FALSE');
      setIsBulkMode(false);
    }
  }, [recordId, recordData, selectedRecordIds]);

  // NEW: Fetch multiple records for bulk mode
  const fetchMultipleRecords = async () => {
    if (!selectedRecordIds || selectedRecordIds.length === 0 || !objectId || !tenant?.id) {
      return;
    }

    try {
      
      const { data, error } = await supabase
        .rpc('get_object_records_with_references', {
          p_object_id: objectId,
          p_tenant_id: tenant.id,
          p_limit: 100,
          p_offset: 0
        });

      if (error) {
        console.error('❌ Error fetching records:', error);
        setError('Failed to fetch records');
        return;
      }

      if (data) {
        // Filter to only selected records
        const selectedRecords = data
          .filter((record: any) => selectedRecordIds.includes(record.record_id))
          .map((record: any) => record.record_data);
        

        setAllRecords(selectedRecords);
      }
    } catch (err) {
      console.error('❌ Error in fetchMultipleRecords:', err);
      setError('Failed to fetch records');
    }
  };

  // Generate default values for optional fields
  const generateDefaultValues = (): Partial<DraftGenerationData> => {
    // Generate certificate number (AMERXXXX format)
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const certificateNumber = `AMER${randomDigits}`;

    return {
      "Certificate Number": certificateNumber,
      "Original Issue Date": "dd/mm/yyyy",
      "Issue Date": "dd/mm/yyyy",
      "Surveillance/ Expiry Date": "dd/mm/yyyy",
      "Recertification Date": "dd/mm/yyyy",
      "Initial Registration Date": "dd/mm/yyyy",
      "Surveillance Due Date": "dd/mm/yyyy",
      "Expiry Date": "dd/mm/yyyy",
      "Revision": "R0",
      "Country": "Saudi Arabia", // Default country
    };
  };

  // Prepare data for draft generation
  const prepareDraftData = (): DraftGenerationData => {
    if (!currentRecord) {
      throw new Error("Record data not available");
    }

    const defaults = generateDefaultValues();
    
    // Start with required fields
    const draftData: DraftGenerationData = {
      "Company Name": currentRecord.name || "",
      "Address": currentRecord.address__a || "",
      "Address alignment": formData.addressAlignment || "center",  // ✅ ADDED: Address alignment support
      "ISO Standard": currentRecord['ISO standard__a'] || currentRecord.isoStandard__a || "ISO 9001",
      "Scope": currentRecord.scope__a || "General business operations and management",
      "Channel Partner": "",
      "Type": "",
      "Size": "",
      "Accreditation": "",
      "Logo": "",
      "Country": "",
      "Certificate Number": "",
      "Original Issue Date": "",
      "Issue Date": "",
      "Surveillance/ Expiry Date": "",
      "Recertification Date": "",
      "Initial Registration Date": "",
      "Surveillance Due Date": "",
      "Expiry Date": "",
      "Revision": "",
      "Extra Line": "",
      "Language": formData.language || "",  // ✅ ADDED: Language field support
    };

    // Add optional fields only if they are checked
    if (optionalFields.showChannelPartner) {
      draftData["Channel Partner"] = currentRecord.channelPartner__a || "N/A";
    }
    if (optionalFields.showType) {
      draftData["Type"] = currentRecord.type__a || "new";
    }
    if (optionalFields.showSize) {
      draftData["Size"] = currentRecord.size__a || fieldValues.size;
    }
    if (optionalFields.showAccreditation) {
      draftData["Accreditation"] = currentRecord.accreditation__a || fieldValues.accreditation;
    }
    if (optionalFields.showLogo) {
      draftData["Logo"] = currentRecord.logo__a || "";
    }
    if (optionalFields.showCountry) {
      draftData["Country"] = fieldValues.country || defaults["Country"] || "Saudi Arabia";
    }
    if (optionalFields.showCertificateNumber) {
      draftData["Certificate Number"] = currentRecord.certificateNumber__a || defaults["Certificate Number"];
    }
    if (optionalFields.showOriginalIssueDate) {
      draftData["Original Issue Date"] = currentRecord.originalIssueDate__a || defaults["Original Issue Date"];
    }
    if (optionalFields.showIssueDate) {
      draftData["Issue Date"] = currentRecord.issueDate__a || defaults["Issue Date"];
    }
    if (optionalFields.showSurveillanceExpiryDate) {
      draftData["Surveillance/ Expiry Date"] = currentRecord.surveillanceDate__a || defaults["Surveillance/ Expiry Date"];
    }
    if (optionalFields.showRecertificationDate) {
      draftData["Recertification Date"] = currentRecord.recertificationDate__a || defaults["Recertification Date"];
    }
    if (optionalFields.showInitialRegistrationDate) {
      draftData["Initial Registration Date"] = defaults["Initial Registration Date"];
    }
    if (optionalFields.showSurveillanceDueDate) {
      draftData["Surveillance Due Date"] = defaults["Surveillance Due Date"];
    }
    if (optionalFields.showExpiryDate) {
      draftData["Expiry Date"] = defaults["Expiry Date"];
    }
    if (optionalFields.showRevision) {
      draftData["Revision"] = defaults["Revision"];
    }
    if (optionalFields.showExtraLine) {
      draftData["Extra Line"] = formData.extraLine; // Use manual input for additional text
    }

    return draftData;
  };

  // NEW: Prepare draft data for a specific record (for bulk mode)
  const prepareDraftDataForRecord = (record: ClientData, recordId?: string): DraftGenerationData => {
    const defaults = generateDefaultValues();
    
    // Start with required fields
    const draftData: DraftGenerationData = {
      "Company Name": record.name || "",
      "Address": record.address__a || "",
      "Address alignment": formData.addressAlignment || "center",  // ✅ ADDED: Address alignment support
      "ISO Standard": record['ISO standard__a'] || record.isoStandard__a || "ISO 9001",
      "Scope": record.scope__a || "General business operations and management",
      "Channel Partner": "",
      "Type": "",
      "Size": "",
      "Accreditation": "",
      "Logo": "",
      "Country": "",
      "Certificate Number": "",
      "Original Issue Date": "",
      "Issue Date": "",
      "Surveillance/ Expiry Date": "",
      "Recertification Date": "",
      "Initial Registration Date": "",
      "Surveillance Due Date": "",
      "Expiry Date": "",
      "Revision": "",
      "Extra Line": "",
      "Language": formData.language || "",  // ✅ ADDED: Language field support
    };

    // Add optional fields only if they are checked
    if (optionalFields.showChannelPartner) {
      draftData["Channel Partner"] = record.channelPartner__a || "N/A";
    }
    if (optionalFields.showType) {
      draftData["Type"] = record.type__a || "new";
    }
    if (optionalFields.showSize) {
      draftData["Size"] = record.size__a || fieldValues.size;
    }
    if (optionalFields.showAccreditation) {
      draftData["Accreditation"] = record.accreditation__a || fieldValues.accreditation;
    }
    if (optionalFields.showLogo) {
      draftData["Logo"] = record.logo__a || "";
    }
    if (optionalFields.showCountry) {
      draftData["Country"] = fieldValues.country || defaults["Country"] || "Saudi Arabia";
    }
    if (optionalFields.showCertificateNumber) {
      draftData["Certificate Number"] = record.certificateNumber__a || defaults["Certificate Number"];
    }
    if (optionalFields.showOriginalIssueDate) {
      draftData["Original Issue Date"] = record.originalIssueDate__a || defaults["Original Issue Date"];
    }
    if (optionalFields.showIssueDate) {
      draftData["Issue Date"] = record.issueDate__a || defaults["Issue Date"];
    }
    if (optionalFields.showSurveillanceExpiryDate) {
      draftData["Surveillance/ Expiry Date"] = record.surveillanceDate__a || defaults["Surveillance/ Expiry Date"];
    }
    if (optionalFields.showRecertificationDate) {
      draftData["Recertification Date"] = record.recertificationDate__a || defaults["Recertification Date"];
    }
    if (optionalFields.showInitialRegistrationDate) {
      draftData["Initial Registration Date"] = defaults["Initial Registration Date"];
    }
    if (optionalFields.showSurveillanceDueDate) {
      draftData["Surveillance Due Date"] = defaults["Surveillance Due Date"];
    }
    if (optionalFields.showExpiryDate) {
      draftData["Expiry Date"] = defaults["Expiry Date"];
    }
    if (optionalFields.showRevision) {
      draftData["Revision"] = defaults["Revision"];
    }
    if (optionalFields.showExtraLine) {
      // For bulk mode, use individual record's Extra Line setting if available
      if (recordId && bulkExtraLineSettings[recordId]?.enabled) {
        draftData["Extra Line"] = bulkExtraLineSettings[recordId].value;
      } else {
        draftData["Extra Line"] = formData.extraLine; // Use manual input for additional text
      }
    }

    return draftData;
  };

  // Generate draft using existing certificate generation logic
  const generateDraft = async () => {
    if (isBulkMode) {
      await generateBulkDrafts();
    } else {
      await generateSingleDraft();
    }
  };

  // NEW: Generate single draft
  const generateSingleDraft = async () => {
    if (!currentRecord) {
      setError("Record data not available");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);
      setProgress({ current: 1, total: 3, stage: 'Preparing client data...' });

      // Prepare the data
      const draftData = prepareDraftData();
      

      
      setProgress({ current: 2, total: 3, stage: 'Generating draft certificate...' });

      // Create FormData for the API call (using working certificate generation endpoint)
      const formData = new FormData();
      
      // Create a dummy Word file (required by the working endpoint)
      const dummyForm = new File([''], 'dummy.docx', { 
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
      });
      formData.append('form', dummyForm);
      
      // Add the field data in the format the certificate service expects
      formData.append('fields', JSON.stringify(draftData));
      
      // Add logo files if any
      logoFiles.forEach((file, index) => {
        formData.append(`logo_files`, file);
      });

      // Call the working certificate generation API (uses generate_certificate.py with dummy Word file)
      const response = await fetch('/api/pdf/generate', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = 'Failed to generate draft certificate';
        try {
        const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = `${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // The API returns a PDF file directly
      const pdfBlob = await response.blob();
      
        setProgress({ current: 3, total: 3, stage: 'Draft generated successfully!' });
      setSuccess(`Draft certificate generated successfully for ${currentRecord.name}`);
        
        // Download the generated PDF
      const url = window.URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
      a.download = `${currentRecord.name.replace(/[^a-zA-Z0-9]/g, '_')}_Draft_Certificate.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

    } catch (error) {
      console.error('Error generating draft:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0, stage: '' });
    }
  };

  // NEW: Generate bulk drafts
  const generateBulkDrafts = async () => {
    if (!allRecords || allRecords.length === 0) {
      setError("No records available for bulk generation");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);
      setProgress({ current: 1, total: allRecords.length + 2, stage: 'Preparing bulk draft generation...' });

      const pdfResults: Array<{blob: Blob, filename: string}> = [];
      
      // Process each record
      for (let i = 0; i < allRecords.length; i++) {
        const record = allRecords[i];
        setProgress({ 
          current: i + 2, 
          total: allRecords.length + 2, 
          stage: `Generating draft for ${record.name || 'Unknown Company'}...` 
        });

        try {
          // Prepare data for this record
          const draftData = prepareDraftDataForRecord(record, record.id);

          // Create FormData for the API call (using new JSON-only certificate generation endpoint)
          const formData = new FormData();
          
          // Add the field data in the format the certificate service expects
          formData.append('fields', JSON.stringify(draftData));

          // Add logo files if any
          logoFiles.forEach((file, index) => {
            formData.append(`logo_files`, file);
          });

          // Call the new certificate generation API (uses generate_certificate.py with JSON data only)
          const response = await fetch('/api/pdf/generate-certificate-json', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to generate draft certificate';
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
          const filename = `${sanitizedCompanyName}_Draft_Certificate.pdf`;
          
          pdfResults.push({
            blob: pdfBlob,
            filename: filename
          });

          console.log(`✅ Generated draft for ${companyName}`);

        } catch (error) {
          console.error(`❌ Error generating draft for ${record.name || 'Unknown'}:`, error);
          // Continue with other records instead of stopping
          continue;
        }
      }

      setProgress({ 
        current: allRecords.length + 2, 
        total: allRecords.length + 2, 
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
        a.download = `bulk_draft_certificates_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        setSuccess(`Bulk draft generation completed: ${pdfResults.length}/${allRecords.length} certificates generated`);
        setProgress({ current: 0, total: 0, stage: '' });
      } else {
        throw new Error('No certificates were generated successfully');
      }

    } catch (error) {
      console.error('Error in bulk draft generation:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0, stage: '' });
    }
  };

  // Handle logo file upload
  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setLogoFiles(files);
  };

  if (!isBulkMode && !currentRecord) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading record data...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {isBulkMode ? 'Generate Bulk Draft Certificates' : 'Generate Draft Certificate'}
          </h2>
          <div className="flex items-center space-x-2">
            <ImageIcon className="h-5 w-5 text-gray-500" />
            <span className="text-sm text-gray-500">
              {isBulkMode 
                ? `${allRecords.length} records selected` 
                : `Record: ${currentRecord?.name || 'Unknown'}`
              }
            </span>
          </div>
        </div>

        {/* Client Information Display */}
        {(() => {
          console.log('🔍 === RENDERING CLIENT INFORMATION ===');
          console.log('🔍 isBulkMode:', isBulkMode);
          console.log('🔍 allRecords length:', allRecords.length);
          console.log('🔍 currentRecord:', currentRecord);
          return null;
        })()}
        {isBulkMode ? (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Records</h3>
            <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="space-y-4">
                {allRecords.map((record, index) => (
                  <div key={index} className="p-4 bg-white rounded border">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="font-medium text-gray-900">{record.name || 'Unknown Company'}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          {record['ISO standard__a'] || record.isoStandard__a || 'No ISO Standard'}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">#{index + 1}</span>
                    </div>
                    
                    {/* Extra Line checkbox and input for this record */}
                    {optionalFields.showExtraLine && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <label className="flex items-center space-x-2 mb-2">
                          <input
                            type="checkbox"
                            checked={bulkExtraLineSettings[record.id]?.enabled || false}
                            onChange={(e) => handleBulkExtraLineToggle(record.id, e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">Add Extra Line for this record</span>
                        </label>
                        
                        {bulkExtraLineSettings[record.id]?.enabled && (
                          <input
                            type="text"
                            value={bulkExtraLineSettings[record.id]?.value || ''}
                            onChange={(e) => handleBulkExtraLineValueChange(record.id, e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            placeholder="Enter additional information for this record"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Company Name</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.name || 'Not specified'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Address</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.address__a || 'Not specified'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">ISO Standard</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.['ISO standard__a'] || currentRecord?.isoStandard__a || 'Not specified'}
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Scope</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.scope__a || 'General business operations and management'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.type__a || 'new'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Size</label>
              <p className="mt-1 text-sm text-gray-900 bg-gray-50 p-2 rounded border">
                  {currentRecord?.size__a || 'low'}
              </p>
            </div>
          </div>
        </div>
        )}

        {/* Logo Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Company Logo (Optional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {logoFiles.length > 0 && (
            <p className="mt-2 text-sm text-green-600">
              {logoFiles.length} logo file(s) selected
            </p>
          )}
        </div>

        {/* Optional Fields Selection */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Optional Fields</h3>
          <p className="text-sm text-gray-600 mb-4">
            Select which optional fields to include in the generated certificate:
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Basic Fields */}
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showChannelPartner}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showChannelPartner: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Channel Partner</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showType}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showType: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Type</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showSize}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showSize: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Size</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showAccreditation}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showAccreditation: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Accreditation</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showLogo}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showLogo: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Logo</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showCountry}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showCountry: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Country</span>
            </label>
            
            {/* Certificate Fields */}
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showCertificateNumber}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showCertificateNumber: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Certificate Number</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showOriginalIssueDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showOriginalIssueDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Original Issue Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showIssueDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showIssueDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Issue Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showSurveillanceExpiryDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showSurveillanceExpiryDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Surveillance/Expiry Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showRecertificationDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showRecertificationDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Recertification Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showInitialRegistrationDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showInitialRegistrationDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Initial Registration Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showSurveillanceDueDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showSurveillanceDueDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Surveillance Due Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showExpiryDate}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showExpiryDate: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Expiry Date</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showRevision}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showRevision: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Revision</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={optionalFields.showExtraLine}
                onChange={(e) => setOptionalFields(prev => ({ ...prev, showExtraLine: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Extra Line</span>
            </label>
          </div>
        </div>

        {/* Manual Input Fields */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Manual Input Fields</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Address Alignment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address Alignment</label>
              <select
                value={formData.addressAlignment}
                onChange={(e) => handleFormDataChange('addressAlignment', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="center">Center</option>
                <option value="left">Left</option>
              </select>
            </div>

            {/* Language */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
              <select
                value={formData.language}
                onChange={(e) => handleFormDataChange('language', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">(Blank)</option>
                <option value="S">S</option>
              </select>
            </div>

            {/* Extra Line - only show if enabled */}
            {optionalFields.showExtraLine && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Extra Line</label>
                <input
                  type="text"
                  value={formData.extraLine}
                  onChange={(e) => handleFormDataChange('extraLine', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Additional information"
                />
              </div>
            )}
          </div>
        </div>

        {/* NEW: Picklist Field Values */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Field Values</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Accreditation Picklist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Accreditation</label>
              <select
                value={fieldValues.accreditation}
                onChange={(e) => setFieldValues(prev => ({ ...prev, accreditation: e.target.value }))}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* Country Picklist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
              <select
                value={fieldValues.country}
                onChange={(e) => setFieldValues(prev => ({ ...prev, country: e.target.value }))}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="">(Blank)</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Size Picklist */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Size</label>
              <select
                value={fieldValues.size}
                onChange={(e) => setFieldValues(prev => ({ ...prev, size: e.target.value }))}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="low">Low (Default)</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        </div>

        {/* Progress Display */}
        {progress.stage && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{progress.stage}</span>
              <span className="text-sm text-gray-500">{progress.current}/{progress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={generateDraft}
              disabled={isGenerating}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isBulkMode ? 'Generating Bulk Drafts...' : 'Generating...'}
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  {isBulkMode ? 'Generate Bulk Drafts' : 'Generate Draft'}
                </>
              )}
            </button>
            
            {logoFiles.length > 0 && (
              <button
                onClick={() => setLogoFiles([])}
                className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Clear Logos
              </button>
            )}
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
            <div className="flex">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-green-800">Success</h3>
                <div className="mt-2 text-sm text-green-700">{success}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClientDraftGenerator;
