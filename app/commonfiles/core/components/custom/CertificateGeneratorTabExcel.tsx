'use client';

import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, Loader2, AlertCircle, CheckCircle, FileText, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { createClientSupabaseClient } from '../../lib/supabase';
import { useSupabase } from '../../providers/SupabaseProvider';

interface ExcelRow {
  "Company Name"?: string;
  "Client Name"?: string;
  "Address"?: string;
  "Address alignment"?: string;
  "ISO Standard"?: string;
  "Standard"?: string;
  "Scope"?: string;
  "Channel Partner"?: string;
  "Type"?: string;
  "Size"?: string;
  "Accreditation"?: string;
  "Logo"?: string;
  "Country"?: string;  // ✅ ADDED: Country field
  "Extra Line"?: string;  // ✅ ADDED: Extra Line field
  "Language"?: string;  // ✅ ADDED: Language field (S or blank)
}

interface ProcessedRow {
  name: string;
  address: string;
  addressAlignment: string;
  isoStandard: string;
  scope: string;
  channelPartner: string;
  type: string;
  size: string;
  accreditation: string;
  logo: string;
  country: string;  // ✅ ADDED: Country field
  
  // ✅ REQUIRED fields for certificate generation
  certificateNumber: string;
  originalIssueDate: string;
  issueDate: string;
  surveillanceExpiryDate: string;
  recertificationDate: string;
  
  // ✅ OPTIONAL fields for UI rendering (NOT database storage)
  initialRegistrationDate: string;
  surveillanceDueDate: string;
  expiryDate: string;
  // ✅ ADDED: Extra Line field
  extraLine: string;
  // ✅ ADDED: Language field (S or blank)
  language: string;
  
  isValid: boolean;
  errors: string[];
}

interface Draft {
  id: string;
  company_name: string;
  address__a: string;
  scope__a: string;
  isoStandard__a: string;
  type__a: string;
  size__a: string;
  accreditation__a: string;
  logo__a: string;
  country__a: string;  // ✅ ADDED: Country field
  // ❌ REMOVED: Optional fields - will be populated by soft copy system
  // initialRegistrationDate__a: string;
  // surveillanceDueDate__a: string;
  // expiryDate__a: string;
}

export default function CertificateGeneratorTabExcel() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedRows, setParsedRows] = useState<ProcessedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string}>({current: 0, total: 0, stage: ''});
  const [useCustomTemplate, setUseCustomTemplate] = useState(false);

  // Get tenant context
  const { userProfile, tenant } = useSupabase();



  // Column name normalization with specific mappings
  const normalizeColumnName = (columnName: string): string => {
    return columnName.toLowerCase().replace(/\s+/g, '');
  };

  const getColumnMapping = (headers: string[]) => {
    const mapping: { [key: string]: string } = {};
    
    console.log('🔍 [CERTIFICATE] Headers received:', headers);
    
    headers.forEach(header => {
      const normalized = normalizeColumnName(header);
      console.log(`🔍 [CERTIFICATE] Mapping header: "${header}" → normalized: "${normalized}"`);
      
      // Handle multiple variations for each field
      switch (normalized) {
        case 'companyname':
        case 'clientname':
          mapping[header] = 'name';
          break;
        case 'address':
          mapping[header] = 'address';
          break;
        case 'addressalignment':
          mapping[header] = 'addressAlignment';
          break;
        case 'isostandard':
        case 'standard':
          mapping[header] = 'isoStandard';
          break;
        case 'scope':
          mapping[header] = 'scope';
          break;
        case 'channelpartner':
          mapping[header] = 'channelPartner';
          break;
        case 'type':
          mapping[header] = 'type';
          break;
        case 'size':
          mapping[header] = 'size';
          break;
        case 'accreditation':
          mapping[header] = 'accreditation';
          break;
        case 'logo':
          mapping[header] = 'logo';
          break;
        case 'country':  // ✅ ADDED: Country field mapping
          mapping[header] = 'country';
          break;
        // ✅ RESTORED: Optional fields for UI rendering (NOT database storage)
        case 'initialregistrationdate':
          mapping[header] = 'initialRegistrationDate';
          break;
        case 'surveillanceduedate':
          mapping[header] = 'surveillanceDueDate';
          break;
        case 'expirydate':
          mapping[header] = 'expiryDate';
          break;
        // ✅ ADDED: Required fields for certificate generation
        case 'certificatenumber':
        case 'certificateno':
        case 'certno':
          mapping[header] = 'certificateNumber';
          break;
        case 'originalissuedate':
        case 'originaldate':
          mapping[header] = 'originalIssueDate';
          break;
        case 'issuedate':
        case 'issuedate':
          mapping[header] = 'issueDate';
          break;
        case 'surveillanceexpirydate':
        case 'surveillanceexpiry':
        case 'surveillance/expirydate':  // ✅ ADDED: Handle "Surveillance/ Expiry Date"
        case 'expirydate':
          mapping[header] = 'surveillanceExpiryDate';
          console.log(`🔍 [CERTIFICATE] ✅ Mapped "${header}" to surveillanceExpiryDate`);
          break;
        case 'recertificationdate':
        case 'recertdate':
          mapping[header] = 'recertificationDate';
          break;
        // ✅ ADDED: Map Extra Line field
        case 'extraline':
          mapping[header] = 'extraLine';
          break;
        // ✅ ADDED: Map Language field (S or blank)
        case 'language':
          mapping[header] = 'language';
          break;
        default:
          // Ignore unknown columns
          break;
      }
    });
    
    console.log('🔍 [CERTIFICATE] Final column mapping:', mapping);
    return mapping;
  };

  const validateAndProcessRow = (row: any, columnMapping: { [key: string]: string }): ProcessedRow => {
    const processed: ProcessedRow = {
      name: '',
      address: '',
      addressAlignment: '',
      isoStandard: '',
      scope: '',
      channelPartner: '',
      type: '',
      size: '',
      accreditation: '',
      logo: '',
      country: '',  // ✅ ADDED: Initialize Country field
      
      // ✅ REQUIRED fields for certificate generation
      certificateNumber: '',
      originalIssueDate: '',
      issueDate: '',
      surveillanceExpiryDate: '',
      recertificationDate: '',
      
      // ✅ OPTIONAL fields for UI rendering (NOT database storage)
      initialRegistrationDate: '',
      surveillanceDueDate: '',
      expiryDate: '',
      // ✅ ADDED: Initialize Extra Line field
      extraLine: '',
      // ✅ ADDED: Initialize Language field (S or blank)
      language: '',
      
      isValid: false,
      errors: []
    };

    // Process each mapped column
    Object.keys(columnMapping).forEach(originalHeader => {
      const fieldName = columnMapping[originalHeader];
      const value = row[originalHeader] || '';
      
      // ✅ ADDED: Debug logging for surveillance fields
      if (fieldName === 'surveillanceExpiryDate') {
        console.log(`🔍 [CERTIFICATE] Processing surveillance field: "${originalHeader}" → "${fieldName}" = "${value}"`);
      }
      
      switch (fieldName) {
        case 'name':
          processed.name = value.trim();
          break;
        case 'address':
          processed.address = value.trim();
          break;
        case 'addressAlignment':
          processed.addressAlignment = value.trim();
          break;
        case 'isoStandard':
          processed.isoStandard = value.trim();
          break;
        case 'scope':
          processed.scope = value.trim();
          break;
        case 'channelPartner':
          processed.channelPartner = value.trim();
          break;
        case 'type':
          processed.type = value.trim();
          break;
        case 'size':
          processed.size = value.trim();
          break;
        case 'accreditation':
          processed.accreditation = value.trim();
          break;
        case 'logo':
          processed.logo = value.trim();
          break;
        case 'country':  // ✅ ADDED: Country field processing
          processed.country = value.trim();
          break;
        // ✅ RESTORED: Optional fields for UI rendering (NOT database storage)
        case 'initialRegistrationDate':
          processed.initialRegistrationDate = value.trim();
          break;
        case 'surveillanceDueDate':
          processed.surveillanceDueDate = value.trim();
          break;
        case 'expiryDate':
          processed.expiryDate = value.trim();
          break;
        // ✅ ADDED: Required fields for certificate generation
        case 'certificateNumber':
          processed.certificateNumber = value.trim();
          break;
        case 'originalIssueDate':
          processed.originalIssueDate = value.trim();
          break;
        case 'issueDate':
          processed.issueDate = value.trim();
          break;
        case 'surveillanceExpiryDate':
          processed.surveillanceExpiryDate = value.trim();
          break;
        case 'recertificationDate':
          processed.recertificationDate = value.trim();
          break;
        // ✅ ADDED: Process Extra Line field
        case 'extraLine':
          processed.extraLine = value.trim();
          break;
        // ✅ ADDED: Process Language field (S or blank)
        case 'language':
          processed.language = value.trim();
          break;
      }
    });

    // Validation logic
    if (!processed.name) {
      processed.errors.push('Company Name/Client Name is required');
    }

    // Set default values for missing fields
    if (!processed.address) processed.address = 'N/A';
    if (!processed.isoStandard) processed.isoStandard = 'N/A';
    if (!processed.scope) processed.scope = 'N/A';
    if (!processed.channelPartner) processed.channelPartner = 'N/A';
    if (!processed.type) processed.type = 'new';
    if (!processed.size) processed.size = '';
    if (!processed.accreditation) processed.accreditation = '';
    if (!processed.logo) processed.logo = '';

    // Row is valid if it has a name
    processed.isValid = !!processed.name;

    return processed;
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                 file.type === 'application/vnd.ms-excel')) {
      setExcelFile(file);
      setError(null);
      setSuccess(null);
      setParsedRows([]);
      setProgress({current: 0, total: 0, stage: ''});
      setTemplateFile(null); // Reset template when Excel changes
    }
  };

  const handleLogoFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      // Validate file sizes (max 5MB per file)
      const validFiles = files.filter(file => file.size <= 5 * 1024 * 1024);
      if (validFiles.length !== files.length) {
        setError('Some logo files exceed 5MB limit and were skipped');
      }
      setLogoFiles(validFiles);
      setError(null);
    }
  };

  // Logo matching function - find logo file based on Excel logo column value
  const findLogoForRow = (logoFilename: string): File | null => {
    if (!logoFilename || !logoFiles.length) return null;
    
    // Try exact filename match first
    let logoFile = logoFiles.find(file => file.name === logoFilename);
    
    // If no exact match, try case-insensitive match
    if (!logoFile) {
      logoFile = logoFiles.find(file => 
        file.name.toLowerCase() === logoFilename.toLowerCase()
      );
    }
    
    // If still no match, try partial match (filename without extension)
    if (!logoFile) {
      const logoNameWithoutExt = logoFilename.split('.')[0];
      logoFile = logoFiles.find(file => 
        file.name.split('.')[0].toLowerCase() === logoNameWithoutExt.toLowerCase()
      );
    }
    
    if (logoFile) {
      console.log(`🔍 [LOGO] Found logo for '${logoFilename}': ${logoFile.name}`);
    } else {
      console.log(`⚠️ [LOGO] No logo found for '${logoFilename}'`);
    }
    
    return logoFile || null;
  };

  const parseExcelFile = async (file: File) => {
    console.log(`🔍 [EXCEL] Starting Excel file parsing for: ${file.name} (${file.size} bytes)`);
    
    const formData = new FormData();
    formData.append('excel', file);
    
    console.log(`🔍 [EXCEL] Sending request to /api/excel/parse`);
    
    const response = await fetch('/api/excel/parse', {
      method: 'POST',
      body: formData,
    });
    
    console.log(`🔍 [EXCEL] Response received:`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });
    
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      
      try {
        // Try to parse as JSON first
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // If JSON parsing fails, try to get text content
        try {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
        } catch (textError) {
          // If both fail, use the status-based message
          console.error('Failed to parse error response:', parseError, textError);
        }
      }
      
      throw new Error(errorMessage);
    }
    
    const data = await response.json();
    console.log(`🔍 [EXCEL] Parsed response data:`, {
      success: data.success,
      headersCount: data.headers?.length || 0,
      rowsCount: data.rows?.length || 0,
      totalRows: data.totalRows || 0
    });
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to parse Excel file');
    }
    
    // Normalize column names
    const columnMapping = getColumnMapping(data.headers);
    console.log(`🔍 [EXCEL] Column mapping created:`, columnMapping);
    
    // Process rows with validation
    const processedRows = data.rows.map((row: any) => 
      validateAndProcessRow(row, columnMapping)
    );
    
    console.log(`🔍 [EXCEL] Processed ${processedRows.length} rows with validation`);
    
    return {
      headers: Object.values(columnMapping),
      rows: processedRows
    };
  };

  const createOrUpdateClient = async (row: ProcessedRow, tenantId: string, userId: string) => {
    if (!row.isValid) {
      throw new Error(`Row validation failed: ${row.errors.join(', ')}`);
    }

    const supabase = createClientSupabaseClient();
    
    console.log(`🔍 [CLIENT] Processing client: ${row.name}`);
    console.log(`🔍 [CLIENT] Tenant ID: ${tenantId}`);
    console.log(`🔍 [CLIENT] User ID: ${userId}`);


    try {
      // Check if client exists by name using bridge function
      console.log(`🔍 [CLIENT] Fetching existing clients for tenant...`);
      const { data: existingClients, error: fetchError } = await supabase
        .rpc('get_tenant_clients', {
          p_tenant_id: tenantId
        });
      
      if (fetchError) {
        console.error(`❌ [CLIENT] Error fetching clients:`, fetchError);
        throw fetchError;
      }
      
      console.log(`🔍 [CLIENT] Found ${existingClients?.length || 0} existing clients`);
      
      // Find existing client by name
      const existingClient = existingClients?.find(client => client.name === row.name);
      
      // Handle channel partner - if it's a name, try to find the UUID
      let channelPartnerId: string | null = null;
      if (row.channelPartner && row.channelPartner !== 'N/A') {
        console.log(`🔍 [CLIENT] Looking for channel partner: ${row.channelPartner}`);
        // Try to find channel partner by name
        const { data: channelPartners, error: cpError } = await supabase
          .rpc('get_tenant_channel_partners', {
            p_tenant_id: tenantId
          });
        
        if (!cpError && channelPartners) {
          const channelPartner = channelPartners.find(cp => 
            cp.name.toLowerCase() === row.channelPartner.toLowerCase()
          );
          if (channelPartner) {
            channelPartnerId = channelPartner.id;
            console.log(`🔍 [CLIENT] Found channel partner ID: ${channelPartnerId}`);
          } else {
            console.log(`⚠️ [CLIENT] Channel partner not found: ${row.channelPartner}, will use null`);
            channelPartnerId = null;
          }
        } else {
          console.log(`⚠️ [CLIENT] Error fetching channel partners:`, cpError);
          channelPartnerId = null;
        }
      } else {
        console.log(`🔍 [CLIENT] No channel partner specified, using null`);
        channelPartnerId = null;
      }
      
      if (existingClient) {
        console.log(`🔍 [CLIENT] Updating existing client: ${existingClient.id}`);
        // Update existing client using bridge function instead of direct table access
        const { data: updateResult, error: updateError } = await supabase
          .rpc('update_tenant_client', {
            p_client_id: existingClient.id,
            p_iso_standard: row.isoStandard,
            p_channel_partner: channelPartnerId,
            p_type: row.type,
            p_updated_by: userId
          });
        
        if (updateError) {
          console.error(`❌ [CLIENT] Error updating client:`, updateError);
          throw updateError;
        }
        
        // Handle table return format: {id, success, error}
        if (!updateResult || !Array.isArray(updateResult) || updateResult.length === 0) {
          console.error(`❌ [CLIENT] No result returned from update_tenant_client`);
          throw new Error('Failed to update client - no result returned');
        }
        
        const result = updateResult[0];
        if (!result.success) {
          console.error(`❌ [CLIENT] Client update failed: ${result.error}`);
          throw new Error(`Failed to update client: ${result.error}`);
        }
        
        if (!result.id) {
          console.error(`❌ [CLIENT] No client ID returned from update_tenant_client`);
          throw new Error('Failed to update client - no ID returned');
        }
        
        console.log(`✅ [CLIENT] Successfully updated existing client: ${result.id}`);
        return result.id;
      } else {
        // Create new client using bridge function
        console.log(`🔍 [CLIENT] Creating new client: ${row.name}`);
        
        // Validate channelPartnerId is a valid UUID if provided
        if (channelPartnerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelPartnerId)) {
          console.warn(`⚠️ [CLIENT] Invalid UUID format for channel partner: ${channelPartnerId}, setting to null`);
          channelPartnerId = null;
        }
        
        const { data: newClientResult, error } = await supabase
          .rpc('create_tenant_client', {
            p_tenant_id: tenantId,
            p_name: row.name,
            p_iso_standard: row.isoStandard,
            p_channel_partner: channelPartnerId,
            p_type: row.type,
            p_created_by: userId
          });
        
        if (error) {
          console.error(`❌ [CLIENT] Error creating client:`, error);
          throw error;
        }
        
        // Handle table return format: {id, success, error}
        if (!newClientResult || !Array.isArray(newClientResult) || newClientResult.length === 0) {
          console.error(`❌ [CLIENT] No result returned from create_tenant_client`);
          throw new Error('Failed to create client - no result returned');
        }
        
        const result = newClientResult[0];
        if (!result.success) {
          console.error(`❌ [CLIENT] Client creation failed: ${result.error}`);
          throw new Error(`Failed to create client: ${result.error}`);
        }
        
        if (!result.id) {
          console.error(`❌ [CLIENT] No client ID returned from create_tenant_client`);
          throw new Error('Failed to create client - no ID returned');
        }
        
        console.log(`✅ [CLIENT] Successfully created new client: ${result.id}`);
        return result.id;
      }
    } catch (error) {
      console.error(`❌ [CLIENT] Unexpected error in createOrUpdateClient:`, error);
      throw error;
    }
  };

  const createDraft = async (clientId: string, row: ProcessedRow, tenantId: string, userId: string) => {
    const supabase = createClientSupabaseClient();
    
    console.log(`🔍 [DRAFT] Creating draft for client: ${clientId}`);
    console.log(`🔍 [DRAFT] Company name: ${row.name}`);

    
    const { data: draftResult, error } = await supabase
      .rpc('create_tenant_draft', {
        p_tenant_id: tenantId,
        p_client_id: clientId,
        p_type: row.type,
        p_company_name: row.name,
        p_address: row.address,
        p_iso_standard: row.isoStandard,
        p_scope: row.scope,
        p_created_by: userId
      });
    
    if (error) {
      console.error(`❌ [DRAFT] Error creating draft:`, error);
      throw error;
    }
    
    // Handle JSON return format: {success, error, draft_id, message, is_existing, draft_name}
    if (!draftResult || !draftResult.success) {
      console.error(`❌ [DRAFT] Draft creation failed: ${draftResult?.error || 'Unknown error'}`);
      throw new Error(`Failed to create draft: ${draftResult?.error || 'Unknown error'}`);
    }
    
    if (!draftResult.draft_id) {
      console.error(`❌ [DRAFT] No draft ID returned from create_tenant_draft`);
      throw new Error('Failed to create draft - no ID returned');
    }
    
    console.log(`✅ [DRAFT] Draft created successfully: ${draftResult.draft_id}`);
    console.log(`🔍 [DRAFT] Draft name: ${draftResult.draft_name}`);
    console.log(`🔍 [DRAFT] Is existing: ${draftResult.is_existing || false}`);
    
    // Return a draft object with ONLY core fields for certificate generation
    // Optional fields will be populated by soft copy system later
    return {
      id: draftResult.draft_id,
      company_name: row.name,
      address__a: row.address,
      scope__a: row.scope,
      isoStandard__a: row.isoStandard,
      type__a: row.type,
      size__a: row.size,
      accreditation__a: row.accreditation,
      logo__a: row.logo,
      country__a: row.country  // ✅ ADDED: Country field
      // ❌ REMOVED: Optional fields - will be populated by soft copy system
      // initialRegistrationDate__a: row.initialRegistrationDate,
      // surveillanceDueDate__a: row.surveillanceDueDate,
      // expiryDate__a: row.expiryDate
    };
  };

  const generatePDFs = async (drafts: Draft[], clientNames: string[], rows: ProcessedRow[]) => {
    if (useCustomTemplate && !templateFile) {
      throw new Error('Custom template file is required when using custom template mode');
    }

    const pdfResults = [];
    
    for (let i = 0; i < drafts.length; i++) {
              const draft = drafts[i];
        const clientName = clientNames[i];
        const row = rows[i];
        
        setProgress({current: i + 1, total: drafts.length, stage: 'Generating PDFs'});
      
      // Sanitize filename (removed duplicate - will be handled in PDF generation)
      
      const formData = new FormData();
      
      if (useCustomTemplate) {
        // Use custom uploaded template
        formData.append('form', templateFile!);
      } else {
        // Create a dummy form file for automatic template selection
        // The Python service will ignore this and use Supabase templates
        const dummyForm = new File([''], 'dummy.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        formData.append('form', dummyForm);
      }
      
      formData.append('fields', JSON.stringify({
        // ✅ Core fields from draft
        'Company Name': draft.company_name,
        'Address': draft.address__a,
        'Address alignment': rows[i].addressAlignment || '',
        'Scope': draft.scope__a,
        'ISO Standard': draft.isoStandard__a,
        'Size': draft.size__a,
        'Accreditation': draft.accreditation__a,
        'Logo': draft.logo__a,
        'Country': rows[i].country || '',  // ✅ ADDED: Country field
        
        // ✅ REQUIRED fields from Excel (with proper backend mapping)
        'Certificate Number': rows[i].certificateNumber || '',
        'Original Issue Date': rows[i].originalIssueDate || '',
        'Issue Date': rows[i].issueDate || '',
        'Surveillance/ Expiry Date': rows[i].surveillanceExpiryDate || '',
        'Recertification Date': rows[i].recertificationDate || '',
        
        // ✅ OPTIONAL fields from Excel (with proper backend mapping)
        'Initial Registration Date': rows[i].initialRegistrationDate || '',
        'Surveillance Due Date': rows[i].surveillanceDueDate || '',
        'Expiry Date': rows[i].expiryDate || '',
        
        // ✅ ADDED: Extra fields
        'Extra Line': rows[i].extraLine || '',
        'Language': rows[i].language || ''  // ✅ ADDED: Language field (S or blank)
      }));

      // ✅ ADDED: Add logo files to form data
      logoFiles.forEach(file => {
        formData.append('logo_files', file);
        console.log(`🔍 [CERTIFICATE] Added logo file to form data: ${file.name}`);
      });
      
      // ✅ REQUIRED fields logging from Excel row data
      console.log(`🔍 [CERTIFICATE] Certificate Number: ${rows[i].certificateNumber || ''}`);
      console.log(`🔍 [CERTIFICATE] Original Issue Date: ${rows[i].originalIssueDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Issue Date: ${rows[i].issueDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Surveillance/ Expiry Date: ${rows[i].surveillanceExpiryDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Recertification Date: ${rows[i].recertificationDate || ''}`);
      
      // ✅ OPTIONAL fields logging from Excel row data
      console.log(`🔍 [CERTIFICATE] Initial Registration Date: ${rows[i].initialRegistrationDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Country: ${rows[i].country || ''}`);  // ✅ ADDED: Country field logging
      console.log(`🔍 [CERTIFICATE] Surveillance Due Date: ${rows[i].surveillanceDueDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Expiry Date: ${rows[i].expiryDate || ''}`);
      console.log(`🔍 [CERTIFICATE] Extra Line: ${rows[i].extraLine || ''}`);
      console.log(`🔍 [CERTIFICATE] Language: ${rows[i].language || ''}`);  // ✅ ADDED: Language field logging
      
      // ✅ DEBUG: Log the complete form data being sent
      console.log(`🔍 [CERTIFICATE] Sending form data to backend:`, {
        template: useCustomTemplate ? templateFile?.name : 'Auto template',
        fields: {
          'Company Name': draft.company_name,
          'Address': draft.address__a,
          'Scope': draft.scope__a,
          'ISO Standard': draft.isoStandard__a,
          'Size': draft.size__a,
          'Accreditation': draft.accreditation__a,
          'Logo': draft.logo__a,
          'Certificate Number': rows[i].certificateNumber || '',
          'Original Issue Date': rows[i].originalIssueDate || '',
          'Issue Date': rows[i].issueDate || '',
          'Surveillance/ Expiry Date': rows[i].surveillanceExpiryDate || '',
          'Recertification Date': rows[i].recertificationDate || '',
          'Initial Registration Date': rows[i].initialRegistrationDate || '',
          'Surveillance Due Date': rows[i].surveillanceDueDate || '',
          'Expiry Date': rows[i].expiryDate || ''
        },
        logoFiles: logoFiles.map(f => f.name)
      });
      
      const response = await fetch('/api/pdf/generate', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        let errorMessage = `PDF generation failed: ${response.status}`;
        
        try {
          // Try to parse as JSON first
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          // If JSON parsing fails, try to get text content
          try {
            const errorText = await response.text();
            errorMessage = errorText || errorMessage;
          } catch (textError) {
            // If both fail, use the status-based message
            console.error('Failed to parse error response:', parseError, textError);
          }
        }
        
        throw new Error(errorMessage);
      }
      
              const pdfBlob = await response.blob();
        
        // ✅ UPDATED: New filename format with ISO standard
        const sanitizedClientName = clientName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
        const sanitizedISOStandard = (row.isoStandard || 'Unknown').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
        
        // Extract just the number from ISO standard (e.g., "9001" from "ISO 9001:2015")
        const isoNumber = sanitizedISOStandard.match(/\d+/)?.[0] || 'Unknown';
        
        const filename = `${sanitizedClientName}_${isoNumber}_draft.pdf`;
        
        pdfResults.push({
          blob: pdfBlob,
          filename: filename
        });
    }
    
    return pdfResults;
  };

  const createAndDownloadZIP = async (pdfResults: Array<{blob: Blob, filename: string}>) => {
    try {
      // Dynamic import of JSZip to avoid SSR issues
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      pdfResults.forEach(({ blob, filename }) => {
        zip.file(filename, blob);
      });
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bulk_certificates.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error creating ZIP file:', error);
      throw new Error('Failed to create ZIP file');
    }
  };

  const processExcelRows = async (rows: ProcessedRow[]) => {
    if (!tenant?.id) {
      throw new Error('Tenant context not available');
    }
    
    if (!userProfile?.id) {
      throw new Error('User profile not available');
    }

    console.log(`🔍 [PROCESS] Starting to process ${rows.length} rows`);
    console.log(`🔍 [PROCESS] Tenant ID: ${tenant.id}`);
    console.log(`🔍 [PROCESS] User ID: ${userProfile.id}`);


    const validRows = rows.filter(row => row.isValid);
    console.log(`🔍 [PROCESS] Valid rows: ${validRows.length}, Skipped: ${rows.length - validRows.length}`);
    
    const results = {
      clients: [] as any[],
      drafts: [] as any[],
      clientNames: [] as string[],
      skipped: rows.length - validRows.length
    };

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      console.log(`🔍 [PROCESS] Processing row ${i + 1}/${validRows.length}: ${row.name}`);

      
      try {
        setProgress({current: i + 1, total: validRows.length, stage: 'Creating records'});
        
        // Create/Update client record
        console.log(`🔍 [PROCESS] Creating/updating client for: ${row.name}`);
        const clientId = await createOrUpdateClient(row, tenant.id, userProfile.id);
        console.log(`✅ [PROCESS] Client created/updated successfully: ${clientId}`);
        
        // Create draft record
        console.log(`🔍 [PROCESS] Creating draft for client: ${clientId}`);
        const draft = await createDraft(clientId, row, tenant.id, userProfile.id);
        console.log(`✅ [PROCESS] Draft created successfully: ${draft.id}`);
        
        results.clients.push({ id: clientId, name: row.name });
        results.drafts.push(draft);
        results.clientNames.push(row.name);
        
        console.log(`✅ [PROCESS] Row ${i + 1} completed successfully`);
      } catch (err) {
        console.error(`❌ [PROCESS] Error processing row for ${row.name}:`, err);
        // Continue with other rows
      }
    }

    console.log(`🔍 [PROCESS] Final results: ${results.clients.length} clients, ${results.drafts.length} drafts`);
    return results;
  };

  const handleGenerate = async () => {
    
    if (!excelFile) {
      setError('Please upload an Excel file');
      return;
    }
    
    if (useCustomTemplate && !templateFile) {
      setError('Please upload a custom template file');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProgress({current: 0, total: 0, stage: 'Starting...'});
    
    try {
      // 1. Parse Excel with column normalization and validation
      setProgress({current: 0, total: 1, stage: 'Parsing Excel file'});
      const parsedData = await parseExcelFile(excelFile);
      setParsedRows(parsedData.rows);
      
      // 2. Process each row (create clients and drafts)
      const results = await processExcelRows(parsedData.rows);
      
      if (results.skipped > 0) {
        setError(`Skipped ${results.skipped} invalid rows (missing Company Name/Client Name)`);
      }
      
      if (results.drafts.length === 0) {
        setError('No valid records found to process');
        return;
      }
      
      // 3. Generate PDFs with custom naming
      const pdfResults = await generatePDFs(results.drafts, results.clientNames, parsedData.rows);
      
      // 4. Create ZIP and download
      setProgress({current: 1, total: 1, stage: 'Creating ZIP file'});
      await createAndDownloadZIP(pdfResults);
      
      setSuccess(`Successfully generated ${pdfResults.length} certificates. ${results.skipped > 0 ? `${results.skipped} rows skipped.` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process Excel file');
    } finally {
      setIsProcessing(false);
      setProgress({current: 0, total: 0, stage: ''});
    }
  };

  const handleReset = () => {
    setExcelFile(null);
    setTemplateFile(null);
    setParsedRows([]);
    setError(null);
    setSuccess(null);
    setProgress({current: 0, total: 0, stage: ''});
    setUseCustomTemplate(false);
    
    // Reset file inputs
    const excelInput = document.getElementById('excel-upload') as HTMLInputElement;
    const templateInput = document.getElementById('template-upload') as HTMLInputElement;
    if (excelInput) excelInput.value = '';
    if (templateInput) templateInput.value = '';
  };

  // Show loading state if tenant is not yet available
  if (!tenant) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Loading tenant information...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-green-600" />
          Bulk Certificate Generation
        </h3>

      </div>

      {/* Status Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-5 w-5" />
            <span>{success}</span>
          </div>
        </div>
      )}

      {/* Template Mode Info */}
      {!useCustomTemplate && excelFile && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center gap-2 text-blue-700">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Automatic Template Mode</span>
          </div>
          <p className="text-sm text-blue-600 mt-2">
            The system will automatically select the best template based on your content length. No template upload needed.
          </p>
        </div>
      )}

      {/* Excel Upload */}
      <div className="mb-8">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-400 transition-colors">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelUpload}
            className="hidden"
            id="excel-upload"
          />
          <label htmlFor="excel-upload" className="cursor-pointer">
            {excelFile ? (
              <div className="flex items-center gap-2 text-green-600">
                <FileSpreadsheet className="h-5 w-5" />
                <span>{excelFile.name}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-500">
                <Upload className="h-8 w-8" />
                <span>Click to upload Excel file</span>
                <span className="text-sm">Supports .xlsx and .xls files</span>
              </div>
            )}
          </label>
        </div>
      </div>

      {/* Logo Files Upload */}
      <div className="mb-8">
        <div className="border-2 border-dashed border-orange-300 rounded-lg p-6 text-center hover:border-orange-400 transition-colors">
            <input
              type="file"
              accept=".zip"
              onChange={handleLogoFilesUpload}
              className="hidden"
              id="logo-upload"
            />
            <label htmlFor="logo-upload" className="cursor-pointer">
              {logoFiles.length > 0 ? (
                <div className="space-y-2">
                  <ImageIcon className="h-8 w-8" />
                  <span>{logoFiles.length} logo file(s) uploaded</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <ImageIcon className="h-8 w-8" />
                  <span>Click to upload logo files (Optional)</span>
                  <span className="text-sm">Upload a ZIP file containing logo images</span>
                  <span className="text-xs text-gray-500">Supports PNG, JPG, JPEG, GIF, BMP, or WebP images. Max 5MB per image</span>
                </div>
              )}
            </label>
        </div>
                  {logoFiles.length > 0 && (
            <div className="mt-2 text-xs text-gray-600">
              <strong>Uploaded logos:</strong> {logoFiles.map(f => f.name).join(', ')}
            </div>
          )}
        </div>

        {/* Logo Matching Status */}
        {logoFiles.length > 0 && parsedRows.length > 0 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-medium text-blue-800 mb-2">Logo Matching Status</h4>
            <div className="space-y-1 text-xs text-blue-700">
              {parsedRows.map((row, index) => {
                const logoFile = findLogoForRow(row.logo);
                return (
                  <div key={index} className="flex justify-between items-center">
                    <span className="truncate max-w-[200px]">{row.name}</span>
                    <span className={`px-2 py-1 rounded text-xs ${
                      logoFile 
                        ? 'bg-green-100 text-green-800' 
                        : row.logo 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {logoFile 
                        ? `✅ ${logoFile.name}` 
                        : row.logo 
                          ? `❌ Logo not found: ${row.logo}` 
                          : 'No logo specified'
                      }
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

             {/* Template Selection Toggle */}
       <div className="mb-8">
         <div className="flex items-center justify-end mb-4">
           <label className="relative inline-flex items-center cursor-pointer">
             <input
               type="checkbox"
               checked={useCustomTemplate}
               onChange={(e) => setUseCustomTemplate(e.target.checked)}
               className="sr-only peer"
             />
             <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
             <span className="ml-3 text-sm font-medium text-gray-900">
               {useCustomTemplate ? 'Custom Template' : 'Auto Templates'}
             </span>
           </label>
         </div>
         
         {useCustomTemplate && (
           <div className="border-2 border-dashed border-blue-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
             <input
               type="file"
               accept=".docx"
               onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
               className="hidden"
               id="template-upload"
             />
             <label htmlFor="template-upload" className="cursor-pointer">
               {templateFile ? (
                 <div className="flex items-center gap-2 text-blue-600">
                   <FileText className="h-5 w-5" />
                   <span>{templateFile.name}</span>
                 </div>
               ) : (
                 <div className="flex flex-col items-center gap-2 text-blue-500">
                   <Upload className="h-8 w-8" />
                   <span>Click to upload custom template</span>
                   <span className="text-sm">Supports .docx files</span>
                 </div>
               )}
             </label>
           </div>
         )}
       </div>




            {/* Generate Button */}
      <div className="mb-8">
        <h4 className="text-md font-medium text-gray-900 mb-4">
          Generate Certificates
        </h4>
        <div className="bg-gray-50 rounded-lg p-6">
          <p className="text-gray-600 mb-4">
            {parsedRows.length > 0
              ? `Ready to generate certificates. ${parsedRows.filter(r => r.isValid).length} valid rows found.`
              : !excelFile 
                ? 'Upload an Excel file to generate certificates in bulk.'
                : useCustomTemplate && !templateFile
                  ? 'Upload a custom template file to proceed.'
                  : 'Processing Excel data...'
            }
          </p>
          
          {/* Progress Indicator */}
          {isProcessing && progress.total > 0 && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center gap-2 text-blue-700 mb-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">{progress.stage}</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
              <div className="text-xs text-blue-600 mt-1">
                {progress.current} of {progress.total} completed
              </div>
            </div>
          )}

          {/* Data Preview - Show after progress or when data is available */}
          {parsedRows.length > 0 && (
            <div className="mb-4">
              <h5 className="text-sm font-medium text-gray-900 mb-3">
                Preview Data ({parsedRows.length} rows)
              </h5>
              <div className="bg-gray-50 rounded-lg p-4 max-h-40 overflow-y-auto">
                <div className="text-sm text-gray-600">
                  {parsedRows.slice(0, 3).map((row, index) => (
                    <div key={index} className={`mb-2 p-2 rounded ${row.isValid ? 'bg-green-50' : 'bg-red-50'}`}>
                      <div className="font-medium">
                        {row.isValid ? '✅' : '❌'} {row.name || 'Missing Name'}
                      </div>
                      <div className="text-xs text-gray-500">
                        <div><strong>ISO:</strong> {row.isoStandard}</div>
                        <div><strong>Type:</strong> {row.type}</div>
                        <div><strong>Scope:</strong> {row.scope}</div>
                        <div><strong>Size:</strong> {row.size || 'Not provided'}</div>
                        <div><strong>Accreditation:</strong> {row.accreditation || 'Not provided'}</div>
                        
                        {/* ✅ REQUIRED fields for certificate generation */}
                        <div><strong>Certificate Number:</strong> {row.certificateNumber || 'Not provided'}</div>
                        <div><strong>Original Issue Date:</strong> {row.originalIssueDate || 'Not provided'}</div>
                        <div><strong>Issue Date:</strong> {row.issueDate || 'Not provided'}</div>
                        <div><strong>Surveillance/Expiry Date:</strong> {row.surveillanceExpiryDate || 'Not provided'}</div>
                        <div><strong>Recertification Date:</strong> {row.recertificationDate || 'Not provided'}</div>
                        
                        {/* ✅ OPTIONAL fields */}
                        <div><strong>Initial Registration Date:</strong> {row.initialRegistrationDate || 'Not provided'}</div>
                        <div><strong>Surveillance Due Date:</strong> {row.surveillanceDueDate || 'Not provided'}</div>
                        <div><strong>Expiry Date:</strong> {row.expiryDate || 'Not provided'}</div>
                      </div>
                      {!row.isValid && row.errors.length > 0 && (
                        <div className="text-xs text-red-500">
                          Errors: {row.errors.join(', ')}
                        </div>
                      )}
                      {row.isValid && (
                        <div className="text-xs text-gray-500">
                          {/* ✅ UPDATED: Show new filename format */}
                          PDF: {row.name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')}_{row.isoStandard?.match(/\d+/)?.[0] || 'Unknown'}_draft.pdf
                        </div>
                      )}
                    </div>
                  ))}
                  {parsedRows.length > 3 && (
                    <div className="text-gray-500">... and {parsedRows.length - 3} more</div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={!excelFile || (useCustomTemplate && !templateFile) || isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {progress.stage}... ({progress.current}/{progress.total})
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  Generate {parsedRows.filter(r => r.isValid).length > 0 ? `${parsedRows.filter(r => r.isValid).length} ` : ''}Certificates
                </>
              )}
            </button>
            
            <button
              onClick={handleReset}
              disabled={isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-5 w-5" />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* File Info */}
      {excelFile && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center gap-2 text-green-700">
            <FileSpreadsheet className="h-4 w-4" />
            <span className="text-sm">
              Excel file loaded: {excelFile.name} ({(excelFile.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
