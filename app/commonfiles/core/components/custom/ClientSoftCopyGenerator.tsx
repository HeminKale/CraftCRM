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
  Client_name__a?: string; // Client reference field for draft records
  type__a?: string; // Record type field
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

interface SoftCopyGenerationData {
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
  "Country": string;  // ✅ ADDED: Country field support
  "Language": string;  // ✅ ADDED: Language field support
  "Address Font Size": string;  // ✅ ADDED: Address font size field (1, -1 text format)
  "Address Adjustment": string;  // ✅ ADDED: Address adjustment field (1, -1 text format)
  "Scope Font Size": string;  // ✅ ADDED: Scope font size field (1, -2 text format)
  "Scope Adjustment": string;  // ✅ ADDED: Scope adjustment field (1, -1 text format)
  "Name Font Size": string;  // ✅ ADDED: Name font size field (1, -1 text format)
  "Name Adjustment": string;  // ✅ ADDED: Name adjustment field (1, -1 text format)
}

interface CertificateRecord {
  name: string;
  client_name__a: string;
  address__a: string;
  scope__a: string;
  iso_standard__a: string;
  certificateNumber__a: string;
  originalIssueDate__a: string;
  issueDate__a: string;
  surveillanceExpiryDate__a: string;
  recertificationDate__a: string;
  initialRegistrationDate__a: string;
  surveillanceDueDate__a: string;
  expiryDate__a: string;
  extraLine__a: string;
}

interface ClientSoftCopyGeneratorProps {
  recordId?: string;
  objectId: string;
  tenantId?: string;
  recordData?: any;
  selectedRecordIds?: string[];
}

function ClientSoftCopyGenerator({ recordId, objectId, tenantId, recordData, selectedRecordIds }: ClientSoftCopyGeneratorProps) {
  const [currentRecord, setCurrentRecord] = useState<ClientData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string}>({current: 0, total: 0, stage: ''});
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  
  // State for multiple records
  const [allRecords, setAllRecords] = useState<ClientData[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  
  // State for saving to database
  const [saveToDatabase, setSaveToDatabase] = useState(true);
  const [savedRecords, setSavedRecords] = useState<string[]>([]);
  
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
    size: 'low', // Default to 'low'
    accreditation: 'yes', // Default to 'yes'
    extraLine: '',
    addressAlignment: 'center',  // ✅ ADDED: Address alignment support
    country: '',  // ✅ ADDED: Country field support
    language: '',  // ✅ ADDED: Language field support
    addressFontSize: '',  // ✅ ADDED: Address font size field
    addressAdjustment: '',  // ✅ ADDED: Address adjustment field
    scopeFontSize: '',  // ✅ ADDED: Scope font size field
    scopeAdjustment: '',  // ✅ ADDED: Scope adjustment field
    nameFontSize: '',  // ✅ ADDED: Name font size field
    nameAdjustment: '',  // ✅ ADDED: Name adjustment field
  });

  // Get tenant context
  const { userProfile, tenant } = useSupabase();
  const supabase = createClientSupabaseClient();

  // Function to check for existing certificate records
  const checkForExistingCertificate = async (clientId: string, certificateNumber: string): Promise<any | null> => {
    try {
      console.log('🔍 [DEBUG] Checking for existing certificate...');
      console.log('🔍 [DEBUG] Client ID:', clientId);
      console.log('🔍 [DEBUG] Certificate Number:', certificateNumber);

      // Get certificate object ID first
      const { data: objectData, error: objectError } = await supabase
        .rpc('get_tenant_objects', {
          p_tenant_id: tenant?.id
        });

      if (objectError) {
        console.error('❌ [ERROR] Error getting objects:', objectError);
        return null;
      }

      const certificateObject = objectData?.find((obj: any) => obj.name === 'certificate__a');
      if (!certificateObject) {
        console.log('🔍 [DEBUG] Certificate object not found');
        return null;
      }

      // Create filter criteria to check for existing certificate
      const filterCriteria = [
        {
          field: 'client_name__a',
          operator: 'equals',
          value: clientId
        },
        {
          field: 'certificateNumber__a',
          operator: 'equals',
          value: certificateNumber
        }
      ];

      console.log('🔍 [DEBUG] Filter criteria:', filterCriteria);

      // Query for existing records
      const { data, error } = await supabase.rpc('get_filtered_records', {
        p_object_id: certificateObject.id,
        p_filter_criteria: filterCriteria,
        p_selected_fields: ['id', 'name', 'certificateNumber__a', 'client_name__a', 'created_at'],
        p_limit: 1,
        p_offset: 0
      });

      if (error) {
        console.error('❌ [ERROR] Error checking for existing certificate:', error);
        return null;
      }

      console.log('🔍 [DEBUG] Existing certificate check result:', data);
      
      // Extract the actual data from the RPC response
      const records = data && typeof data === 'object' && 'data' in data ? (data as any).data : [];
      
      if (records && records.length > 0) {
        console.log('🔍 [DEBUG] Found existing certificate:', records[0]);
        return records[0];
      } else {
        console.log('🔍 [DEBUG] No existing certificate found');
        return null;
      }
    } catch (error) {
      console.error('❌ [ERROR] Exception during duplicate check:', error);
      return null;
    }
  };

  // Function to save certificate record to database
  const saveCertificateRecord = async (softCopyData: SoftCopyGenerationData, clientId: string): Promise<{id: string | null, wasUpdate: boolean}> => {
    try {
      console.log('🔍 [DEBUG] Starting save operation...');
      console.log('🔍 [DEBUG] Client ID (from Client_name__a):', clientId);
      console.log('🔍 [DEBUG] Draft Record ID (currentRecord.id):', currentRecord?.id);
      console.log('🔍 [DEBUG] Current Record:', currentRecord);
      console.log('🔍 [DEBUG] Current Record Name:', currentRecord?.name);
      console.log('🔍 [DEBUG] Current Record Type:', currentRecord?.type__a || 'Unknown');
      console.log('🔍 [DEBUG] Soft copy data:', softCopyData);
      console.log('🔍 [DEBUG] Tenant ID:', tenant?.id);

      // Check for existing certificate first
      const existingCertificate = await checkForExistingCertificate(clientId, softCopyData["Certificate Number"]);
      
      if (existingCertificate) {
        console.log('⚠️ [WARNING] Certificate already exists:', existingCertificate);
        console.log('🔍 [DEBUG] Existing certificate ID:', existingCertificate.id);
        console.log('🔍 [DEBUG] Existing certificate name:', existingCertificate.name);
        console.log('🔍 [DEBUG] Existing certificate number:', existingCertificate.certificateNumber__a);
        
        // For now, we'll still create a new record but log the duplicate
        // TODO: Implement update logic or user choice
        console.log('🔍 [DEBUG] Proceeding with new record creation (duplicate detected)');
      }



      const certificateRecord: CertificateRecord = {
        name: softCopyData["Company Name"] || `Certificate - ${softCopyData["Certificate Number"]}`,
        client_name__a: clientId,
        address__a: softCopyData["Address"] || "",
        scope__a: softCopyData["Scope"] || "",
        iso_standard__a: softCopyData["ISO Standard"] || "",
        certificateNumber__a: softCopyData["Certificate Number"] || "",
        originalIssueDate__a: softCopyData["Original Issue Date"] || "",
        issueDate__a: softCopyData["Issue Date"] || "",
        surveillanceExpiryDate__a: softCopyData["Surveillance/ Expiry Date"] || "",
        recertificationDate__a: softCopyData["Recertification Date"] || "",
        initialRegistrationDate__a: softCopyData["Initial Registration Date"] || "",
        surveillanceDueDate__a: softCopyData["Surveillance Due Date"] || "",
        expiryDate__a: softCopyData["Expiry Date"] || "",
        extraLine__a: softCopyData["Extra Line"] || "",
      };

      // Add required fields that might be missing
      const fullCertificateRecord = {
        ...certificateRecord,
        is_active: true,
        autonumber: 0,
        // These will be set by the database automatically:
        // tenant_id: tenant?.id,
        // created_at: new Date().toISOString(),
        // updated_at: new Date().toISOString(),
        // created_by: userProfile?.id,
        // updated_by: userProfile?.id,
      };

      console.log('🔍 [DEBUG] Certificate record to insert:', fullCertificateRecord);

      // Try to get the certificate object ID first
      console.log('🔍 [DEBUG] Getting certificate object ID...');
      const { data: objectData, error: objectError } = await supabase
        .rpc('get_tenant_objects', {
          p_tenant_id: tenant?.id
        });

      if (objectError) {
        console.error('❌ [ERROR] Error getting objects:', objectError);
        throw new Error(`Failed to get objects: ${objectError.message}`);
      }

      // Find the certificate object
      const certificateObject = objectData?.find((obj: any) => obj.name === 'certificate__a');
      if (!certificateObject) {
        throw new Error('Certificate object not found');
      }

      console.log('🔍 [DEBUG] Certificate object found:', certificateObject);

      // Create certificate record using the correct object ID
      console.log('🔍 [DEBUG] Creating certificate record via RPC...');
      const { data, error } = await supabase
        .rpc('create_object_record', {
          p_object_id: certificateObject.id,
          p_tenant_id: tenant?.id,
          p_record_data: fullCertificateRecord
        });

      console.log('🔍 [DEBUG] RPC result:', { data, error });

      if (error) {
        console.error('❌ [ERROR] Database save failed:', error);
        console.error('❌ [ERROR] Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        return null;
      }

      console.log('✅ [SUCCESS] Certificate record created:', data);
      if (data && data.length > 0) {
        console.log('🔍 [DEBUG] Created record details:', data[0]);
        console.log('🔍 [DEBUG] Record ID:', data[0].record_id);
        console.log('🔍 [DEBUG] Success status:', data[0].success);
        console.log('🔍 [DEBUG] Message:', data[0].message);
      }

      // Determine if this was an update or create operation
      const wasUpdate = existingCertificate ? true : false;
      
      if (existingCertificate) {
        console.log('⚠️ [WARNING] Duplicate certificate created - existing certificate ID:', existingCertificate.id);
        console.log('🔍 [DEBUG] New certificate created despite duplicate detection');
      } else {
        console.log('✅ [SUCCESS] New certificate created successfully');
      }
      
      return { id: data, wasUpdate };
    } catch (error) {
      console.error('❌ [ERROR] Exception during save:', error);
      return { id: null, wasUpdate: false };
    }
  };

  // Load record data when component mounts
  useEffect(() => {
    if (selectedRecordIds && selectedRecordIds.length > 0) {
      // Bulk mode - fetch multiple records
      setIsBulkMode(true);
      fetchMultipleRecords();
    } else if (recordId && recordData) {
      // Single record mode
      setIsBulkMode(false);
      setCurrentRecord(recordData);
      
      // Auto-populate form data from draft record if available
      if (recordData) {
        setFormData(prev => ({
          ...prev,
          certificateNumber: recordData.certificateNumber__a || prev.certificateNumber,
          originalIssueDate: recordData.originalIssueDate__a || prev.originalIssueDate,
          issueDate: recordData.issueDate__a || prev.issueDate,
          surveillanceExpiryDate: recordData.surveillanceDate__a || prev.surveillanceExpiryDate,
          recertificationDate: recordData.recertificationDate__a || prev.recertificationDate,
          revision: recordData.revision__a || prev.revision,
          initialRegistrationDate: recordData.initialRegistrationDate__a || prev.initialRegistrationDate,
          surveillanceDueDate: recordData.surveillanceDueDate__a || prev.surveillanceDueDate,
          expiryDate: recordData.expiryDate__a || prev.expiryDate,
          size: recordData.size__a || prev.size,
          accreditation: recordData.accreditation__a || prev.accreditation,
          extraLine: recordData.extraLine__a || prev.extraLine,
        }));
      }
    }
  }, [recordId, recordData, selectedRecordIds]);

  // Fetch multiple records for bulk mode
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

  // Prepare data for soft copy generation
  const prepareSoftCopyData = (): SoftCopyGenerationData => {
    if (!currentRecord) {
      throw new Error("Record data not available");
    }

    return {
      "Company Name": currentRecord.name || "",
      "Address": currentRecord.address__a || "",
      "Address alignment": formData.addressAlignment || "center",  // ✅ ADDED: Address alignment support
      "ISO Standard": currentRecord['ISO standard__a'] || currentRecord.isoStandard__a || "ISO 9001",
      "Scope": currentRecord.scope__a || "General business operations and management",
      "Certificate Number": formData.certificateNumber,
      "Original Issue Date": formData.originalIssueDate,
      "Issue Date": formData.issueDate,
      "Surveillance/ Expiry Date": formData.surveillanceExpiryDate,
      "Recertification Date": formData.recertificationDate,
      "Revision": formData.revision,
      "Initial Registration Date": formData.initialRegistrationDate,
      "Surveillance Due Date": formData.surveillanceDueDate,
      "Expiry Date": formData.expiryDate,
      "Logo": logoFiles.length > 0 ? logoFiles[0].name : "",
      "Size": formData.size,
      "Accreditation": formData.accreditation,
      "Extra Line": formData.extraLine,
      "Country": formData.country || "",  // ✅ ADDED: Country field support
      "Language": formData.language || "",  // ✅ ADDED: Language field support
      "Address Font Size": formData.addressFontSize || "",  // ✅ ADDED: Address font size field
      "Address Adjustment": formData.addressAdjustment || "",  // ✅ ADDED: Address adjustment field
      "Scope Font Size": formData.scopeFontSize || "",  // ✅ ADDED: Scope font size field
      "Scope Adjustment": formData.scopeAdjustment || "",  // ✅ ADDED: Scope adjustment field
      "Name Font Size": formData.nameFontSize || "",  // ✅ ADDED: Name font size field
      "Name Adjustment": formData.nameAdjustment || "",  // ✅ ADDED: Name adjustment field
    };
  };

  // Prepare soft copy data for a specific record (for bulk mode)
  const prepareSoftCopyDataForRecord = (record: ClientData): SoftCopyGenerationData => {
    return {
      "Company Name": record.name || "",
      "Address": record.address__a || "",
      "Address alignment": formData.addressAlignment || "center",  // ✅ ADDED: Address alignment support
      "ISO Standard": record['ISO standard__a'] || record.isoStandard__a || "ISO 9001",
      "Scope": record.scope__a || "General business operations and management",
      "Certificate Number": formData.certificateNumber,
      "Original Issue Date": formData.originalIssueDate,
      "Issue Date": formData.issueDate,
      "Surveillance/ Expiry Date": formData.surveillanceExpiryDate,
      "Recertification Date": formData.recertificationDate,
      "Revision": formData.revision,
      "Initial Registration Date": formData.initialRegistrationDate,
      "Surveillance Due Date": formData.surveillanceDueDate,
      "Expiry Date": formData.expiryDate,
      "Logo": logoFiles.length > 0 ? logoFiles[0].name : "",
      "Size": formData.size,
      "Accreditation": formData.accreditation,
      "Extra Line": formData.extraLine,
      "Country": formData.country || "",  // ✅ ADDED: Country field support
      "Language": formData.language || "",  // ✅ ADDED: Language field support
      "Address Font Size": formData.addressFontSize || "",  // ✅ ADDED: Address font size field
      "Address Adjustment": formData.addressAdjustment || "",  // ✅ ADDED: Address adjustment field
      "Scope Font Size": formData.scopeFontSize || "",  // ✅ ADDED: Scope font size field
      "Scope Adjustment": formData.scopeAdjustment || "",  // ✅ ADDED: Scope adjustment field
      "Name Font Size": formData.nameFontSize || "",  // ✅ ADDED: Name font size field
      "Name Adjustment": formData.nameAdjustment || "",  // ✅ ADDED: Name adjustment field
    };
  };

  // Generate soft copy using existing certificate generation logic
  const generateSoftCopy = async () => {
    if (isBulkMode) {
      await generateBulkSoftCopies();
    } else {
      await generateSingleSoftCopy();
    }
  };

  // Generate single soft copy
  const generateSingleSoftCopy = async () => {
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
      const softCopyData = prepareSoftCopyData();
      
      setProgress({ current: 2, total: 3, stage: 'Generating soft copy certificate...' });

      // Create FormData for the API call
      const formDataPayload = new FormData();
      
      // Add the field data in the format the soft copy service expects
      formDataPayload.append('data', JSON.stringify(softCopyData));
      
      // Add logo files if any
      logoFiles.forEach((file, index) => {
        formDataPayload.append(`logo_files`, file);
      });

      // Call the soft copy generation API
      const response = await fetch('/api/pdf/generate-softcopy', {
        method: 'POST',
        body: formDataPayload,
      });

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = 'Failed to generate soft copy certificate';
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
      
      setProgress({ current: 3, total: 4, stage: 'Saving certificate record to database...' });
      
      // Save to database if enabled
      let savedRecordId: string | null = null;
      let wasUpdate = false;
      console.log('🔍 [DEBUG] Save to database enabled:', saveToDatabase);
      if (saveToDatabase) {
        console.log('🔍 [DEBUG] Calling saveCertificateRecord...');
        console.log('🚀 [CACHE-BUST] Testing cache refresh - v2.0');
        console.log('🔍 [DEBUG] About to save certificate...');
        console.log('🔍 [DEBUG] Full currentRecord object:', JSON.stringify(currentRecord, null, 2));
        console.log('🔍 [DEBUG] currentRecord.Client_name__a:', currentRecord.Client_name__a);
        console.log('🔍 [DEBUG] currentRecord.id:', currentRecord.id);
        const saveResult = await saveCertificateRecord(softCopyData, currentRecord.Client_name__a);
        console.log('🔍 [DEBUG] Save result:', saveResult);
        if (saveResult && saveResult.id) {
          savedRecordId = saveResult.id;
          wasUpdate = saveResult.wasUpdate;
          setSavedRecords(prev => [...prev, savedRecordId!]);
          console.log('🔍 [DEBUG] Added to saved records list');
          
          // Show user feedback for duplicate detection
          if (wasUpdate) {
            setSuccess(`⚠️ Certificate created (duplicate detected for certificate number: ${softCopyData["Certificate Number"]})`);
          } else {
            setSuccess(`✅ Certificate record saved successfully!`);
          }
        } else {
          console.log('🔍 [DEBUG] Save failed - no record ID returned');
        }
      } else {
        console.log('🔍 [DEBUG] Save to database is disabled');
      }
      
      setProgress({ current: 4, total: 4, stage: 'Soft copy generated successfully!' });
      let successMessage;
      if (saveToDatabase && savedRecordId) {
        const operation = wasUpdate ? 'updated' : 'saved';
        successMessage = `Soft copy certificate generated and ${operation} to database for ${currentRecord.name}`;
      } else {
        successMessage = `Soft copy certificate generated successfully for ${currentRecord.name}`;
      }
      setSuccess(successMessage);
        
      // Download the generated PDF
      const url = window.URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentRecord.name.replace(/[^a-zA-Z0-9]/g, '_')}_Soft_Copy_Certificate.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

    } catch (error) {
      console.error('Error generating soft copy:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsGenerating(false);
      setProgress({ current: 0, total: 0, stage: '' });
    }
  };

  // Generate bulk soft copies
  const generateBulkSoftCopies = async () => {
    if (!allRecords || allRecords.length === 0) {
      setError("No records available for bulk generation");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(null);
      setProgress({ current: 1, total: allRecords.length + 2, stage: 'Preparing bulk soft copy generation...' });

      const pdfResults: Array<{blob: Blob, filename: string}> = [];
      const savedRecordIds: string[] = [];
      
      // Process each record
      for (let i = 0; i < allRecords.length; i++) {
        const record = allRecords[i];
        setProgress({ 
          current: i + 2, 
          total: allRecords.length + 2, 
          stage: `Generating soft copy for ${record.name || 'Unknown Company'}...` 
        });

        try {
          // Prepare data for this record
          const softCopyData = prepareSoftCopyDataForRecord(record);

          // Create FormData for the API call
          const formDataPayload = new FormData();
          
          // Add the field data in the format the soft copy service expects
          formDataPayload.append('data', JSON.stringify(softCopyData));

          // Add logo files if any
          logoFiles.forEach((file, index) => {
            formDataPayload.append(`logo_files`, file);
          });

          // Call the soft copy generation API
          const response = await fetch('/api/pdf/generate-softcopy', {
            method: 'POST',
            body: formDataPayload,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to generate soft copy certificate';
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
          const filename = `${sanitizedCompanyName}_Soft_Copy_Certificate.pdf`;
          
          pdfResults.push({
            blob: pdfBlob,
            filename: filename
          });

          console.log(`✅ Generated soft copy for ${companyName}`);

          // Save to database if enabled
          if (saveToDatabase && record.Client_name__a) {
            console.log('🔍 [DEBUG] Saving certificate record for:', record.name);
            const saveResult = await saveCertificateRecord(softCopyData, record.Client_name__a);
            if (saveResult && saveResult.id) {
              savedRecordIds.push(saveResult.id);
              console.log('🔍 [DEBUG] Certificate record saved:', saveResult.id);
              
              // Log duplicate detection for bulk operations
              if (saveResult.wasUpdate) {
                console.log('⚠️ [WARNING] Duplicate certificate detected for:', record.name);
              }
            }
          }

        } catch (error) {
          console.error(`❌ Error generating soft copy for ${record.name || 'Unknown'}:`, error);
          // Continue with other records instead of stopping
          continue;
        }
      }

      setProgress({ 
        current: allRecords.length + 2, 
        total: allRecords.length + 3, 
        stage: 'Saving certificate records to database...' 
      });

      // Save to database if enabled
      let savedCount = 0;
      if (saveToDatabase) {
        for (let i = 0; i < allRecords.length; i++) {
          const record = allRecords[i];
          try {
            const softCopyData = prepareSoftCopyDataForRecord(record);
            const saveResult = await saveCertificateRecord(softCopyData, record.id);
            if (saveResult && saveResult.id) {
              setSavedRecords(prev => [...prev, saveResult.id!]);
              savedCount++;
            }
          } catch (error) {
            console.error(`Error saving certificate record for ${record.name}:`, error);
          }
        }
      }

      setProgress({ 
        current: allRecords.length + 3, 
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
        a.download = `bulk_soft_copy_certificates_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        const successMessage = saveToDatabase 
          ? `Bulk soft copy generation completed: ${pdfResults.length}/${allRecords.length} certificates generated and ${savedRecordIds.length} records saved to database`
          : `Bulk soft copy generation completed: ${pdfResults.length}/${allRecords.length} certificates generated`;
        setSuccess(successMessage);
        setProgress({ current: 0, total: 0, stage: '' });
      } else {
        throw new Error('No certificates were generated successfully');
      }

    } catch (error) {
      console.error('Error in bulk soft copy generation:', error);
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

  // Handle form data changes
  const handleFormDataChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
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
            {isBulkMode ? 'Generate Bulk Soft Copy Certificates' : 'Generate Soft Copy Certificate'}
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
        {isBulkMode ? (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Records</h3>
            <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
              <div className="space-y-2">
                {allRecords.map((record, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-white rounded border">
                    <div>
                      <span className="font-medium text-gray-900">{record.name || 'Unknown Company'}</span>
                      <span className="ml-2 text-sm text-gray-500">
                        {record['ISO standard__a'] || record.isoStandard__a || 'No ISO Standard'}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">#{index + 1}</span>
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
            </div>
          </div>
        )}

        {/* Save to Database Toggle */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="saveToDatabase"
              checked={saveToDatabase}
              onChange={(e) => setSaveToDatabase(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="saveToDatabase" className="ml-2 text-sm font-medium text-gray-700">
              Save certificate record to database
            </label>
          </div>
          
          <p className="text-xs text-gray-600 mt-1">
            When enabled, a new record will be created in the certificate__a table with all the certificate details.
          </p>
        </div>

        {/* Manual Input Fields */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Certificate Details</h3>
          <p className="text-sm text-gray-600 mb-4">
            Fill in the certificate details manually. All fields except Certificate Number are optional.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Certificate Number (Required) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Certificate Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.certificateNumber}
                onChange={(e) => handleFormDataChange('certificateNumber', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter certificate number"
                required
              />
            </div>

            {/* Original Issue Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Original Issue Date</label>
              <input
                type="date"
                value={formData.originalIssueDate}
                onChange={(e) => handleFormDataChange('originalIssueDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Issue Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Issue Date</label>
              <input
                type="date"
                value={formData.issueDate}
                onChange={(e) => handleFormDataChange('issueDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Surveillance/Expiry Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Surveillance/Expiry Date</label>
              <input
                type="date"
                value={formData.surveillanceExpiryDate}
                onChange={(e) => handleFormDataChange('surveillanceExpiryDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Recertification Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Recertification Date</label>
              <input
                type="date"
                value={formData.recertificationDate}
                onChange={(e) => handleFormDataChange('recertificationDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Revision */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Revision</label>
              <input
                type="text"
                value={formData.revision}
                onChange={(e) => handleFormDataChange('revision', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., R0, R1"
              />
            </div>

            {/* Initial Registration Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Initial Registration Date</label>
              <input
                type="date"
                value={formData.initialRegistrationDate}
                onChange={(e) => handleFormDataChange('initialRegistrationDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Surveillance Due Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Surveillance Due Date</label>
              <input
                type="date"
                value={formData.surveillanceDueDate}
                onChange={(e) => handleFormDataChange('surveillanceDueDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Expiry Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Expiry Date</label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => handleFormDataChange('expiryDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Size Dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Size</label>
              <select
                value={formData.size}
                onChange={(e) => handleFormDataChange('size', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="low">Low</option>
                <option value="high">High</option>
              </select>
            </div>

            {/* Accreditation Dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Accreditation</label>
              <select
                value={formData.accreditation}
                onChange={(e) => handleFormDataChange('accreditation', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* Extra Line */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Extra Line</label>
              <input
                type="text"
                value={formData.extraLine}
                onChange={(e) => handleFormDataChange('extraLine', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Additional information"
              />
            </div>

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

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => handleFormDataChange('country', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter country"
              />
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

            {/* Address Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address Font Size</label>
              <input
                type="text"
                value={formData.addressFontSize}
                onChange={(e) => handleFormDataChange('addressFontSize', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -1 (text format)"
              />
            </div>

            {/* Address Adjustment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address Adjustment</label>
              <input
                type="text"
                value={formData.addressAdjustment}
                onChange={(e) => handleFormDataChange('addressAdjustment', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -1 (text format)"
              />
            </div>

            {/* Scope Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Scope Font Size</label>
              <input
                type="text"
                value={formData.scopeFontSize}
                onChange={(e) => handleFormDataChange('scopeFontSize', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -2 (text format)"
              />
            </div>

            {/* Scope Adjustment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Scope Adjustment</label>
              <input
                type="text"
                value={formData.scopeAdjustment}
                onChange={(e) => handleFormDataChange('scopeAdjustment', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -1 (text format)"
              />
            </div>

            {/* Name Font Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name Font Size</label>
              <input
                type="text"
                value={formData.nameFontSize}
                onChange={(e) => handleFormDataChange('nameFontSize', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -1 (text format)"
              />
            </div>

            {/* Name Adjustment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name Adjustment</label>
              <input
                type="text"
                value={formData.nameAdjustment}
                onChange={(e) => handleFormDataChange('nameAdjustment', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 1, -1 (text format)"
              />
            </div>
          </div>
        </div>

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
            <div className="mt-2 flex items-center space-x-2">
              <p className="text-sm text-green-600">
                {logoFiles.length} logo file(s) selected
              </p>
              <button
                onClick={() => setLogoFiles([])}
                className="text-red-600 hover:text-red-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
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
              onClick={generateSoftCopy}
              disabled={isGenerating || !formData.certificateNumber.trim()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isBulkMode ? 'Generating Bulk Soft Copies...' : 'Generating...'}
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  {isBulkMode ? 'Generate Bulk Soft Copies' : 'Generate Soft Copy'}
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

export default ClientSoftCopyGenerator;
