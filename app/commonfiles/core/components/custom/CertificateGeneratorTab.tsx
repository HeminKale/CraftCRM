'use client';

import React, { useState, useEffect } from 'react';
import { Upload, FileText, Download, AlertCircle, CheckCircle, Settings, Loader2, Users, Tag, Image as ImageIcon, Edit } from 'lucide-react';
import FieldEditor from './FieldEditor';
import CertificateGeneratorTabExcel from './CertificateGeneratorTabExcel';
import { createClientSupabaseClient } from '../../lib/supabase';
import { useSupabase } from '../../providers/SupabaseProvider';

interface CertificateGeneratorTabProps {
  tabId: string;
  tabLabel: string;
}

interface ExtractedField {
  name: string;
  value: string;
}

interface ExtractedFields extends Array<ExtractedField> {}

interface ExtractedFieldsObject {
  [key: string]: string;
}

interface Client {
  id: string;
  name: string;
  "ISO standard__a": string | null;
  channelPartner__a: string | null;
  type__a: string | null;
  is_active: boolean;
}

export default function CertificateGeneratorTab({ tabId, tabLabel }: CertificateGeneratorTabProps) {
  const [formDoc, setFormDoc] = useState<File | null>(null);
  const [extractedFields, setExtractedFields] = useState<ExtractedFields>([]);
  const [extractedFieldsObject, setExtractedFieldsObject] = useState<ExtractedFieldsObject>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isEditingFields, setIsEditingFields] = useState(false);
  
  // New state for client and type selection
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('new');
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  
  // ✅ ADDED: State for dynamic client creation (like Excel flow)
  const [createdClient, setCreatedClient] = useState<Client | null>(null);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  
  // ✅ ADDED: Channel partner selection state
  const [channelPartners, setChannelPartners] = useState<any[]>([]);
  const [selectedChannelPartner, setSelectedChannelPartner] = useState<string>('');
  const [isLoadingChannelPartners, setIsLoadingChannelPartners] = useState(false);
  
  // ✅ ADDED: Logo files support for Word flow
  const [logoFiles, setLogoFiles] = useState<File[]>([]);

  // Get tenant context
  const { userProfile, tenant } = useSupabase();

      // Draft types (hardcoded)
    const certificateTypes = [
    { value: 'new', label: 'New' },
    { value: 'renewal', label: 'Renewal' }
  ];

  // Fetch clients and channel partners when tenant is available
  useEffect(() => {
    if (tenant?.id) {
      fetchClients();
      fetchChannelPartners();
    }
  }, [tenant]);

  const fetchClients = async () => {
    console.log('🔍 [WORD-FLOW] Fetch clients triggered:', {
      hasTenant: !!tenant?.id,
      tenantId: tenant?.id,
      timestamp: new Date().toISOString()
    });

    if (!tenant?.id) {
      const errorMsg = 'No tenant available';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] No tenant available for client fetching');
      return;
    }

    setIsLoadingClients(true);
    try {
      const supabase = createClientSupabaseClient();
      
      console.log('🔍 [WORD-FLOW] Sending request to get_tenant_clients RPC:', {
        tenantId: tenant.id,
        timestamp: new Date().toISOString()
      });
      
      const { data, error } = await supabase
        .rpc('get_tenant_clients', { p_tenant_id: tenant.id });

      console.log('🔍 [WORD-FLOW] get_tenant_clients RPC response:', {
        hasData: !!data,
        dataLength: data?.length || 0,
        hasError: !!error,
        error: error,
        timestamp: new Date().toISOString()
      });

      if (error) {
        console.error('❌ [WORD-FLOW] Error fetching clients:', error);
        setError('Failed to fetch clients');
        return;
      }

      if (data) {
        setClients(data);
        console.log('✅ [WORD-FLOW] Clients loaded successfully:', {
          clientCount: data.length,
          clientNames: data.map(c => c.name),
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('⚠️ [WORD-FLOW] No client data returned from RPC');
        setClients([]);
      }
    } catch (err) {
      console.error('❌ [WORD-FLOW] Error fetching clients:', {
        error: err,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      setError('Failed to fetch clients');
    } finally {
      setIsLoadingClients(false);
      console.log('🔍 [WORD-FLOW] Client fetching process finished, isLoadingClients set to false');
    }
  };

  const fetchChannelPartners = async () => {
    console.log('🔍 [WORD-FLOW] Fetch channel partners triggered:', {
      hasTenant: !!tenant?.id,
      tenantId: tenant?.id,
      timestamp: new Date().toISOString()
    });

    if (!tenant?.id) {
      const errorMsg = 'No tenant available';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] No tenant available for channel partner fetching');
      return;
    }

    setIsLoadingChannelPartners(true);
    try {
      const supabase = createClientSupabaseClient();
      
      console.log('🔍 [WORD-FLOW] Sending request to get_tenant_channel_partners RPC:', {
        tenantId: tenant.id,
        timestamp: new Date().toISOString()
      });

      const { data, error } = await supabase
        .rpc('get_tenant_channel_partners', { p_tenant_id: tenant.id });

      console.log('🔍 [WORD-FLOW] get_tenant_channel_partners RPC response:', {
        hasData: !!data,
        dataLength: data?.length || 0,
        hasError: !!error,
        error: error,
        timestamp: new Date().toISOString()
      });

      if (error) {
        console.error('❌ [WORD-FLOW] Error fetching channel partners:', error);
        setError('Failed to fetch channel partners');
        return;
      }

      if (data) {
        setChannelPartners(data);
        console.log('✅ [WORD-FLOW] Channel partners loaded successfully:', {
          partnerCount: data.length,
          partnerNames: data.map(cp => cp.name),
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('⚠️ [WORD-FLOW] No channel partner data returned from RPC');
        setChannelPartners([]);
      }
    } catch (err) {
      console.error('❌ [WORD-FLOW] Error fetching channel partners:', {
        error: err,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      setError('Failed to fetch channel partners');
    } finally {
      setIsLoadingChannelPartners(false);
      console.log('🔍 [WORD-FLOW] Channel partner fetching process finished, isLoadingChannelPartners set to false');
    }
  };

  const handleFormUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('🔍 [WORD-FLOW] Form upload triggered:', {
      file: file ? {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      } : null,
      timestamp: new Date().toISOString()
    });
    
    const supportedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/pdf', // .pdf
      'image/png', // .png
      'image/jpeg', // .jpg, .jpeg
      'image/jpg' // .jpg
    ];
    
    if (file && supportedTypes.includes(file.type)) {
      setFormDoc(file);
      setError(null);
      setSuccess(null);
      setExtractedFields([]); // Reset extracted fields
      console.log('✅ [WORD-FLOW] Document uploaded successfully:', file.name);
    } else {
      const errorMsg = 'Please select a valid document (.docx, .pdf, .png, .jpg, or .jpeg)';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] Invalid file type:', file?.type || 'No file');
    }
  };

  // ✅ ADDED: Logo files upload handler
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

  // ✅ ADDED: Client creation function (similar to Excel flow)
  const createOrUpdateClient = async (clientData: {
    name: string;
    isoStandard: string;
    type: string;
  }) => {
    if (!tenant?.id || !userProfile?.id) {
      throw new Error('Tenant or user profile not available');
    }

    console.log('🔍 [WORD-FLOW] Creating/updating client:', {
      name: clientData.name,
      isoStandard: clientData.isoStandard,
      type: clientData.type,
      selectedChannelPartner: selectedChannelPartner,
      timestamp: new Date().toISOString()
    });

    const supabase = createClientSupabaseClient();
    
    try {
      // Check if client exists by name
      console.log('🔍 [WORD-FLOW] Checking for existing client...');
      const { data: existingClients, error: fetchError } = await supabase
        .rpc('get_tenant_clients', {
          p_tenant_id: tenant.id
        });
      
      if (fetchError) {
        console.error('❌ [WORD-FLOW] Error fetching clients:', fetchError);
        throw fetchError;
      }
      
      console.log('🔍 [WORD-FLOW] Found existing clients:', existingClients?.length || 0);
      
      // Find existing client by name AND ISO Standard (updated duplicate logic)
      const existingClient = existingClients?.find(client => 
        client.name.toLowerCase() === clientData.name.toLowerCase() &&
        client["ISO standard__a"] === clientData.isoStandard
      );
      
      if (existingClient) {
        console.log('✅ [WORD-FLOW] Found existing client:', {
          id: existingClient.id,
          name: existingClient.name,
          timestamp: new Date().toISOString()
        });
        return existingClient;
      }
      
      // Handle channel partner from dropdown selection
      let channelPartnerId: string | null = null;
      if (selectedChannelPartner && selectedChannelPartner !== '') {
        console.log('🔍 [WORD-FLOW] Using selected channel partner:', selectedChannelPartner);
        channelPartnerId = selectedChannelPartner;
      } else {
        console.log('🔍 [WORD-FLOW] No channel partner selected, using null');
        channelPartnerId = null;
      }
      
      // Create new client
      console.log('🔍 [WORD-FLOW] Creating new client...');
      const { data: newClientResult, error } = await supabase
        .rpc('create_tenant_client', {
          p_tenant_id: tenant.id,
          p_name: clientData.name,
          p_iso_standard: clientData.isoStandard,
          p_channel_partner: channelPartnerId,
          p_type: clientData.type,
          p_created_by: userProfile.id
        });
      
      if (error) {
        console.error('❌ [WORD-FLOW] Error creating client:', error);
        throw error;
      }
      
      // Handle table return format: {id, success, error}
      if (!newClientResult || !Array.isArray(newClientResult) || newClientResult.length === 0) {
        console.error('❌ [WORD-FLOW] No result returned from create_tenant_client');
        throw new Error('Failed to create client - no result returned');
      }
      
      const result = newClientResult[0];
      if (!result.success) {
        console.error('❌ [WORD-FLOW] Client creation failed:', result.error);
        throw new Error(`Failed to create client: ${result.error}`);
      }
      
      if (!result.id) {
        console.error('❌ [WORD-FLOW] No client ID returned from create_tenant_client');
        throw new Error('Failed to create client - no ID returned');
      }
      
      console.log('✅ [WORD-FLOW] Successfully created new client:', result.id);
      
      // Return client object
      return {
        id: result.id,
        name: clientData.name,
        "ISO standard__a": clientData.isoStandard,
        channelPartner__a: channelPartnerId,
        type__a: clientData.type,
        is_active: true
      } as Client;
      
    } catch (error) {
      console.error('❌ [WORD-FLOW] Unexpected error in createOrUpdateClient:', error);
      throw error;
    }
  };

  const extractFields = async () => {
    console.log('🔍 [WORD-FLOW] Extract fields triggered:', {
      hasFormDoc: !!formDoc,
      formDocName: formDoc?.name,
      selectedClient,
      selectedType,
      timestamp: new Date().toISOString()
    });

    if (!formDoc) {
      const errorMsg = 'Please select a form file first';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] No form document selected');
      return;
    }

    // Note: Client will be created from Word document data, no need to select

    if (!selectedType) {
      const errorMsg = 'Please select a draft type first';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] No draft type selected');
      return;
    }

    console.log('✅ [WORD-FLOW] All validation checks passed, starting field extraction...');
    setIsExtracting(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('form', formDoc);

      console.log('🔍 [WORD-FLOW] Sending request to /api/pdf/extract-fields:', {
        formDocName: formDoc.name,
        formDocSize: formDoc.size,
        formDocType: formDoc.type,
        timestamp: new Date().toISOString()
      });

      const response = await fetch('/api/pdf/extract-fields', {
        method: 'POST',
        body: formData,
      });

      console.log('🔍 [WORD-FLOW] API Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ [WORD-FLOW] API Error:", errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('🔍 [WORD-FLOW] API Response data:', {
        hasFields: !!data.fields,
        fieldsCount: data.fields?.length || 0,
        fieldNames: data.fields?.map((f: any) => f.name) || [],
        timestamp: new Date().toISOString()
      });
      
      setExtractedFields(data.fields || []);
      
      // Transform array to object for FieldEditor
      const fieldsObject: ExtractedFieldsObject = {};
      if (data.fields && Array.isArray(data.fields)) {
        data.fields.forEach((field: ExtractedField) => {
          fieldsObject[field.name] = field.value;
        });
      }
      setExtractedFieldsObject(fieldsObject);
      
      console.log('🔍 [WORD-FLOW] Fields transformation completed:', {
        originalFieldsArray: data.fields,
        transformedFieldsObject: fieldsObject,
        objectKeys: Object.keys(fieldsObject),
        objectValues: Object.values(fieldsObject),
        timestamp: new Date().toISOString()
      });
      
      // ✅ ENHANCED: Debug logging for field extraction
      console.log('🔍 [WORD-FLOW] Raw extracted fields:', data.fields);
      console.log('🔍 [WORD-FLOW] Transformed fields object:', fieldsObject);
      console.log('🔍 [WORD-FLOW] Field extraction summary:', {
        totalFields: data.fields?.length || 0,
        fieldNames: data.fields?.map((f: any) => f.name) || [],
        hasRequiredFields: {
          'Certificate Number': !!fieldsObject['Certificate Number'],
          'Original Issue Date': !!fieldsObject['Original Issue Date'],
          'Issue Date': !!fieldsObject['Issue Date'],
          'Surveillance/ Expiry Date': !!fieldsObject['Surveillance/ Expiry Date'],
          'Recertification Date': !!fieldsObject['Recertification Date']
        },
        hasOptionalFields: {
          'Initial Registration Date': !!fieldsObject['Initial Registration Date'],
          'Surveillance Due Date': !!fieldsObject['Surveillance Due Date'],
          'Expiry Date': !!fieldsObject['Expiry Date']
        },
        hasTemplateFields: {
          'Size': !!fieldsObject['Size'],
          'Accreditation': !!fieldsObject['Accreditation'],
          'Logo': !!fieldsObject['Logo'],
          'Address alignment': !!fieldsObject['Address alignment']
        }
      });
      
      setSuccess('Fields extracted successfully! You can now edit them and generate a draft.');
      console.log('✅ [WORD-FLOW] Field extraction completed successfully!');
      
    } catch (err) {
      console.error("❌ [WORD-FLOW] Field extraction failed:", {
        error: err,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        errorStack: err instanceof Error ? err.stack : undefined,
        timestamp: new Date().toISOString()
      });
      setError(err instanceof Error ? err.message : 'Failed to extract fields');
    } finally {
      setIsExtracting(false);
      console.log('🔍 [WORD-FLOW] Field extraction process finished, isExtracting set to false');
    }
  };

  const handleFieldsChange = (fields: ExtractedFieldsObject) => {
    console.log('🔧 [WORD-FLOW] Field changes received:', {
      newFields: fields,
      previousFields: extractedFieldsObject,
      changedKeys: Object.keys(fields).filter(key => fields[key] !== extractedFieldsObject[key]),
      timestamp: new Date().toISOString()
    });
    setExtractedFieldsObject(fields);
    console.log('🔧 [WORD-FLOW] Fields object updated successfully');
  };

  const handleFieldsSave = () => {
    setSuccess('Fields updated successfully!');
    setIsEditingFields(false);
    console.log('✅ [WORD-FLOW] Fields saved successfully:', {
      extractedFieldsObject,
      timestamp: new Date().toISOString()
    });
  };

  const handleGenerateCertificate = async () => {
    console.log('🔍 [WORD-FLOW] Generate certificate triggered:', {
      hasFormDoc: !!formDoc,
      formDocName: formDoc?.name,
      hasExtractedFields: !!extractedFieldsObject,
      extractedFieldsCount: Object.keys(extractedFieldsObject || {}).length,
      selectedClient,
      selectedType,
      hasUserProfile: !!userProfile?.id,
      timestamp: new Date().toISOString()
    });

    if (!formDoc || !extractedFieldsObject || Object.keys(extractedFieldsObject).length === 0) {
      const errorMsg = 'Please upload a form and extract fields first';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] Missing form document or extracted fields');
      return;
    }

    if (!selectedType) {
      const errorMsg = 'Please select draft type';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] Missing draft type selection');
      return;
    }

    if (!userProfile?.id) {
      const errorMsg = 'User profile not available';
      setError(errorMsg);
      console.error('❌ [WORD-FLOW] User profile not available');
      return;
    }

    console.log('✅ [WORD-FLOW] All validation checks passed, starting certificate generation...');
    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      // Step 1: Create/update client from Word document data (like Excel flow)
      const supabase = createClientSupabaseClient();
      
      // Extract client data from Word document fields
      const companyName = extractedFieldsObject['Company Name'] || 
                         extractedFieldsObject['Company'] || 
                         extractedFieldsObject['Organization'] ||
                         extractedFieldsObject['Client Name'] ||
                         'Unknown Company';
      
      const isoStandard = extractedFieldsObject['ISO Standard'] || 
                         extractedFieldsObject['ISO'] ||
                         extractedFieldsObject['Standard'] ||
                         'N/A';
      
      // Channel partner is now selected from dropdown, not extracted from Word document
      
      const clientType = selectedType; // Use selected type (new/renewal)
      
      console.log('🔍 [WORD-FLOW] Extracted client data from Word document:', {
        companyName,
        isoStandard,
        clientType,
        selectedChannelPartner,
        timestamp: new Date().toISOString()
      });

      // Create or update client
      setIsCreatingClient(true);
      const clientData = await createOrUpdateClient({
        name: companyName,
        isoStandard: isoStandard,
        type: clientType
      });
      
      setCreatedClient(clientData);
      setIsCreatingClient(false);
      
      console.log('✅ [WORD-FLOW] Client created/updated successfully:', {
        clientId: clientData.id,
        clientName: clientData.name,
        timestamp: new Date().toISOString()
      });

      // Extract additional data for draft creation
      const address = extractedFieldsObject['Address'] || 
                     extractedFieldsObject['Company Address'] || 
                     extractedFieldsObject['Business Address'] ||
                     extractedFieldsObject['Location'] ||
                     'N/A';
      
      const scope = extractedFieldsObject['Scope'] || 
                   extractedFieldsObject['Certification Scope'] ||
                   extractedFieldsObject['Audit Scope'] ||
                   extractedFieldsObject['Service Scope'] ||
                   'N/A';

      console.log('🎯 [DRAFT] Creating draft with:', {
        tenant_id: tenant.id,
        client_id: clientData.id,
        type: clientType,
        company_name: companyName,
        address,
        iso_standard: isoStandard,
        scope,
        created_by: userProfile.id
      });

      // Debug: Log all extracted fields to see what we're working with
      console.log('🔍 [DEBUG] All extracted fields:', extractedFieldsObject);
      console.log('🔍 [DEBUG] Company name sources:', {
        'Company Name': extractedFieldsObject['Company Name'],
        'Company': extractedFieldsObject['Company'],
        'Organization': extractedFieldsObject['Organization'],
        'Client Name': extractedFieldsObject['Client Name'],
        'final_company_name': companyName
      });

      // Create draft record
      console.log('🔍 [WORD-FLOW] Sending request to create_tenant_draft RPC:', {
        p_tenant_id: tenant.id,
        p_client_id: clientData.id,
        p_type: clientType,
        p_company_name: companyName,
        p_address: address,
        p_iso_standard: isoStandard,
        p_scope: scope,
        p_created_by: userProfile.id,
        timestamp: new Date().toISOString()
      });

      const { data: draftResult, error: draftError } = await supabase
        .rpc('create_tenant_draft', {
          p_tenant_id: tenant.id,
          p_client_id: clientData.id,
          p_type: clientType,
          p_company_name: companyName,
          p_address: address,
          p_iso_standard: isoStandard,
          p_scope: scope,
          p_created_by: userProfile.id
        });

      console.log('🔍 [WORD-FLOW] create_tenant_draft RPC response:', {
        hasData: !!draftResult,
        hasError: !!draftError,
        draftResult: draftResult,
        draftError: draftError,
        timestamp: new Date().toISOString()
        });

      if (draftError) {
        console.error('❌ [WORD-FLOW] Draft creation failed:', {
          error: draftError,
          errorMessage: draftError.message || 'Unknown error',
          timestamp: new Date().toISOString()
        });
        // Continue with PDF generation even if draft fails
        setError('Draft creation failed, but continuing with PDF generation...');
      } else if (draftResult) {
        console.log('✅ [WORD-FLOW] Draft result received:', {
          success: draftResult.success,
          is_existing: draftResult.is_existing,
          draft_id: draftResult.draft_id,
          draft_name: draftResult.draft_name,
          error: draftResult.error,
          timestamp: new Date().toISOString()
        });
        
        if (draftResult.success) {
          if (draftResult.is_existing) {
            const successMsg = `Existing draft found: ${draftResult.draft_name}`;
            setSuccess(successMsg);
            console.log('✅ [WORD-FLOW] Existing draft found:', draftResult.draft_name);
          } else {
            const successMsg = `New draft created: ${draftResult.draft_name}`;
            setSuccess(successMsg);
            console.log('✅ [WORD-FLOW] New draft created:', draftResult.draft_name);
          }
        } else {
          console.warn('⚠️ [WORD-FLOW] Draft creation warning:', {
            error: draftResult.error,
            timestamp: new Date().toISOString()
          });
          // Continue with PDF generation even if draft fails
          setError(`Draft creation warning: ${draftResult.error}, but continuing with PDF generation...`);
        }
      } else {
        console.warn('⚠️ [WORD-FLOW] No draft result returned from RPC');
      }

      // Step 2: Generate PDF (existing functionality)
      console.log('🔍 [WORD-FLOW] Starting PDF generation process...');
      const formData = new FormData();
      formData.append('form', formDoc);
      
      // ✅ FIXED: Create processed fields object with ALL required fields (same as Excel flow)
      const processedFields = {
        ...extractedFieldsObject, // Keep all original extracted fields
        'Address': address,        // Override with cleaned address
        'Company Name': companyName, // Override with cleaned company name
        'Scope': scope,            // Override with cleaned scope
        'ISO Standard': isoStandard, // Override with cleaned ISO standard
        
        // ✅ ADDED: Required fields for certificate generation (same as Excel flow)
        'Certificate Number': extractedFieldsObject['Certificate Number'] || extractedFieldsObject['Cert No'] || extractedFieldsObject['Cert Number'] || 'AMERXX',
        'Original Issue Date': extractedFieldsObject['Original Issue Date'] || extractedFieldsObject['Original Date'] || 'dd/mm/yyyy',
        'Issue Date': extractedFieldsObject['Issue Date'] || extractedFieldsObject['Current Issue Date'] || 'dd/mm/yyyy',
        'Surveillance/ Expiry Date': extractedFieldsObject['Surveillance/ Expiry Date'] || extractedFieldsObject['Surveillance Date'] || extractedFieldsObject['Expiry Date'] || 'dd/mm/yyyy',
        'Recertification Date': extractedFieldsObject['Recertification Date'] || extractedFieldsObject['Recert Date'] || 'dd/mm/yyyy',
        
        // ✅ ADDED: Optional fields for certificate generation (same as Excel flow)
        'Initial Registration Date': extractedFieldsObject['Initial Registration Date'] || extractedFieldsObject['Initial Date'] || '',
        'Surveillance Due Date': extractedFieldsObject['Surveillance Due Date'] || extractedFieldsObject['Due Date'] || '',
        'Expiry Date': extractedFieldsObject['Expiry Date'] || extractedFieldsObject['Certificate Expiry'] || '',
        
        // ✅ ADDED: Template selection fields (same as Excel flow)
        'Size': extractedFieldsObject['Size'] || '',
        'Accreditation': extractedFieldsObject['Accreditation'] || '',
        'Logo': extractedFieldsObject['Logo'] || '',
        'Address alignment': extractedFieldsObject['Address alignment'] || extractedFieldsObject['Address Alignment'] || '',
        
        // ✅ ADDED: Extra line field (same as Excel flow)
        'Extra line': extractedFieldsObject['Extra line'] || extractedFieldsObject['Extra Line'] || ''
      };
      
      console.log('🔍 [WORD-FLOW] Processed fields object created:', {
        processedFields,
        fieldCount: Object.keys(processedFields).length,
        requiredFields: {
          'Certificate Number': processedFields['Certificate Number'],
          'Original Issue Date': processedFields['Original Issue Date'],
          'Issue Date': processedFields['Issue Date'],
          'Surveillance/ Expiry Date': processedFields['Surveillance/ Expiry Date'],
          'Recertification Date': processedFields['Recertification Date']
        },
        timestamp: new Date().toISOString()
      });
      
      // Add processed field data as JSON string
      formData.append('fields', JSON.stringify(processedFields));
      console.log('🔍 [WORD-FLOW] Fields JSON added to form data');
      
      // ✅ ADDED: Add logo files to form data (same as Excel flow)
      logoFiles.forEach(file => {
        formData.append('logo_files', file);
        console.log(`🔍 [WORD-FLOW] Added logo file to form data: ${file.name}`);
      });
      
      // ✅ ENHANCED: Debug logging (same as Excel flow)
      console.log('🔍 [WORD-FLOW] Sending processed fields to PDF generation:', processedFields);
      console.log('🔍 [WORD-FLOW] Required fields check:', {
        'Certificate Number': processedFields['Certificate Number'],
        'Original Issue Date': processedFields['Original Issue Date'],
        'Issue Date': processedFields['Issue Date'],
        'Surveillance/ Expiry Date': processedFields['Surveillance/ Expiry Date'],
        'Recertification Date': processedFields['Recertification Date']
      });
      console.log('🔍 [WORD-FLOW] Optional fields check:', {
        'Initial Registration Date': processedFields['Initial Registration Date'],
        'Surveillance Due Date': processedFields['Surveillance Due Date'],
        'Expiry Date': processedFields['Expiry Date']
      });
      console.log('🔍 [WORD-FLOW] Template selection fields:', {
        'Size': processedFields['Size'],
        'Accreditation': processedFields['Accreditation'],
        'Logo': processedFields['Logo'],
        'Address alignment': processedFields['Address alignment']
      });
      console.log('🔍 [WORD-FLOW] Logo files count:', logoFiles.length);

      console.log('🔍 [WORD-FLOW] Sending request to /api/pdf/generate:', {
        formDocName: formDoc.name,
        formDocSize: formDoc.size,
        processedFieldsCount: Object.keys(processedFields).length,
        logoFilesCount: logoFiles.length,
        timestamp: new Date().toISOString()
      });

      const response = await fetch('/api/pdf/generate', {
        method: 'POST',
        body: formData,
      });

      console.log('🔍 [WORD-FLOW] PDF Generation API Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ [WORD-FLOW] PDF Generation failed:", errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      console.log('🔍 [WORD-FLOW] PDF blob received:', {
        blobSize: blob.size,
        blobType: blob.type,
        timestamp: new Date().toISOString()
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Create filename in format: CompanyName_ISOStandard_draft.pdf
      const downloadCompanyName = processedFields['Company Name'] || processedFields['Company'] || 'Unknown';
      const downloadISOStandard = processedFields['ISO Standard'] || 'Unknown';
      
      // Clean company name and ISO standard for filename
      const cleanDownloadCompanyName = downloadCompanyName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
      const cleanDownloadISOStandard = downloadISOStandard.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
      
      a.download = `${cleanDownloadCompanyName}_${cleanDownloadISOStandard}_draft.pdf`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccess('Draft generated successfully!');
      console.log('✅ [WORD-FLOW] Certificate generation completed successfully!');
    } catch (err) {
      console.error("❌ [WORD-FLOW] Certificate generation error:", {
        error: err,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        errorStack: err instanceof Error ? err.stack : undefined,
        timestamp: new Date().toISOString()
      });
      setError(err instanceof Error ? err.message : 'Failed to generate draft');
    } finally {
      setIsProcessing(false);
      console.log('🔍 [WORD-FLOW] Certificate generation process finished, isProcessing set to false');
    }
  };

  const resetForm = () => {
    console.log('🔍 [WORD-FLOW] Reset form triggered:', {
      timestamp: new Date().toISOString()
    });
    setFormDoc(null);
    setExtractedFields([]);
    setExtractedFieldsObject({});
    setSelectedType('new');
    setSelectedChannelPartner(''); // ✅ ADDED: Reset channel partner selection
    setCreatedClient(null); // ✅ ADDED: Reset created client
    setLogoFiles([]); // ✅ ADDED: Reset logo files
    setError(null);
    setSuccess(null);
    console.log('✅ [WORD-FLOW] Form reset completed');
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="h-6 w-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">{tabLabel}</h2>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          <strong>Current Tenant:</strong> {tenant.name}
        </div>
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

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Column - Existing Content */}
        <div>
          {/* Step 1: Draft Type Selection */}
          <div className="mb-8">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
              Select Draft Type
              </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Type Dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Draft Type <span className="text-red-500">*</span>
                </label>
                <select 
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {certificateTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Channel Partner Dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Channel Partner (Optional)
                </label>
                <select 
                  value={selectedChannelPartner}
                  onChange={(e) => setSelectedChannelPartner(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  disabled={isLoadingChannelPartners}
                >
                  <option value="">
                    {isLoadingChannelPartners ? 'Loading partners...' : 'Select a channel partner...'}
                  </option>
                  {channelPartners.map(partner => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
                {isLoadingChannelPartners && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading channel partners...
                  </div>
                )}
              </div>
            </div>


            {/* Created Client Info */}
            {createdClient && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">
                    Client created: {createdClient.name} - {createdClient["ISO standard__a"] || 'No ISO Standard'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Form Upload */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Tag className="h-5 w-5 text-green-600" />
              Upload Form Document
            </h3>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept=".docx,.pdf,.png,.jpg,.jpeg"
                onChange={handleFormUpload}
                className="hidden"
                id="form-upload"
                disabled={!selectedType}
              />
              <label htmlFor="form-upload" className={`cursor-pointer ${!selectedType ? 'opacity-50' : ''}`}>
                {formDoc ? (
                  <div className="flex items-center gap-2 text-blue-600">
                    <FileText className="h-5 w-5" />
                    <span>{formDoc.name}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-500">
                    <Upload className="h-8 w-8" />
                    <span>
                      {!selectedType 
                        ? 'Please select draft type first' 
                        : 'Click to upload form document'
                      }
                    </span>
                    <span className="text-sm">Supports .docx, .pdf, .png, .jpg, and .jpeg files</span>
                  </div>
                )}
              </label>
            </div>
            
            {formDoc && (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={extractFields}
                  disabled={isExtracting || !selectedType}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Extracting Fields...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Extract Fields
                    </>
                  )}
                </button>
                
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Reset
                </button>
              </div>
            )}
          </div>

          {/* ✅ ADDED: Logo Files Upload */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-orange-600" />
              Upload Logo Files (Optional)
            </h3>
            <div className="border-2 border-dashed border-orange-300 rounded-lg p-6 text-center hover:border-orange-400 transition-colors">
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.bmp,.webp"
                onChange={handleLogoFilesUpload}
                className="hidden"
                id="logo-upload-word"
                multiple
              />
              <label htmlFor="logo-upload-word" className="cursor-pointer">
                {logoFiles.length > 0 ? (
                  <div className="space-y-2">
                    <ImageIcon className="h-8 w-8 text-orange-600" />
                    <span className="text-orange-600">{logoFiles.length} logo file(s) uploaded</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <ImageIcon className="h-8 w-8 text-gray-500" />
                    <span className="text-gray-500">Click to upload logo files (Optional)</span>
                    <span className="text-sm text-gray-400">Supports PNG, JPG, JPEG, GIF, BMP, or WebP images. Max 5MB per image</span>
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

          {/* Extracted Fields */}
          {extractedFields.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                  Review & Edit Fields
              </h2>
                <button
                  onClick={() => {
                    if (isEditingFields) {
                      handleFieldsSave();
                    } else {
                      setIsEditingFields(true);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {isEditingFields ? (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Edit className="h-4 w-4" />
                      Edit Fields
                    </>
                  )}
                </button>
              </div>
              
              {/* Custom Field Display - Only specific fields */}
              <div className="space-y-4">
                {/* Row 1: Company Name and ISO Standard (Side by side) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Company Name
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Company Name'] || extractedFieldsObject['Company'] || extractedFieldsObject['Organization'] || extractedFieldsObject['Client Name'] || ''}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Company Name'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="Company Name"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Company Name'] || extractedFieldsObject['Company'] || extractedFieldsObject['Organization'] || extractedFieldsObject['Client Name'] || 'Not specified'}
            </div>
          )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ISO Standard
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['ISO Standard'] || extractedFieldsObject['ISO'] || extractedFieldsObject['Standard'] || ''}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['ISO Standard'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="ISO Standard"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['ISO Standard'] || extractedFieldsObject['ISO'] || extractedFieldsObject['Standard'] || 'Not specified'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Address
                  </label>
                  {isEditingFields ? (
                    <textarea
                      value={extractedFieldsObject['Address'] || extractedFieldsObject['Company Address'] || extractedFieldsObject['Business Address'] || extractedFieldsObject['Location'] || ''}
                      onChange={(e) => {
                        const newFields = { ...extractedFieldsObject };
                        newFields['Address'] = e.target.value;
                        handleFieldsChange(newFields);
                      }}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="Company Address"
                    />
                  ) : (
                    <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700 min-h-[76px]">
                      {extractedFieldsObject['Address'] || extractedFieldsObject['Company Address'] || extractedFieldsObject['Business Address'] || extractedFieldsObject['Location'] || 'Not specified'}
                    </div>
                  )}
                </div>

                {/* Row 3: Scope */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Scope
                  </label>
                  {isEditingFields ? (
                    <textarea
                      value={extractedFieldsObject['Scope'] || extractedFieldsObject['Certification Scope'] || extractedFieldsObject['Audit Scope'] || extractedFieldsObject['Service Scope'] || ''}
                      onChange={(e) => {
                        const newFields = { ...extractedFieldsObject };
                        newFields['Scope'] = e.target.value;
                        handleFieldsChange(newFields);
                      }}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="Certification Scope"
                    />
                  ) : (
                    <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700 min-h-[76px]">
                      {extractedFieldsObject['Scope'] || extractedFieldsObject['Certification Scope'] || extractedFieldsObject['Audit Scope'] || extractedFieldsObject['Service Scope'] || 'Not specified'}
                    </div>
                  )}
                </div>

                {/* Row 4: Certificate Number and Original Issue Date (Side by side) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Certificate Number
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Certificate Number'] || extractedFieldsObject['Cert No'] || extractedFieldsObject['Cert Number'] || 'AMERXX'}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Certificate Number'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="AMERXX"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Certificate Number'] || extractedFieldsObject['Cert No'] || extractedFieldsObject['Cert Number'] || 'AMERXX'}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Original Issue Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Original Issue Date'] || extractedFieldsObject['Original Date'] || 'dd/mm/yyyy'}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Original Issue Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Original Issue Date'] || extractedFieldsObject['Original Date'] || 'dd/mm/yyyy'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 5: Issue Date and Surveillance/Expiry Date (Side by side) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Issue Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Issue Date'] || extractedFieldsObject['Current Issue Date'] || 'dd/mm/yyyy'}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Issue Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Issue Date'] || extractedFieldsObject['Current Issue Date'] || 'dd/mm/yyyy'}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Surveillance/Expiry Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Surveillance/ Expiry Date'] || extractedFieldsObject['Surveillance Date'] || extractedFieldsObject['Expiry Date'] || 'dd/mm/yyyy'}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Surveillance/ Expiry Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Surveillance/ Expiry Date'] || extractedFieldsObject['Surveillance Date'] || extractedFieldsObject['Expiry Date'] || 'dd/mm/yyyy'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 6: Recertification Date and Initial Registration Date (Side by side) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recertification Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Recertification Date'] || extractedFieldsObject['Recert Date'] || 'dd/mm/yyyy'}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Recertification Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Recertification Date'] || extractedFieldsObject['Recert Date'] || 'dd/mm/yyyy'}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Initial Registration Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Initial Registration Date'] || extractedFieldsObject['Initial Date'] || ''}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Initial Registration Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy (Optional)"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Initial Registration Date'] || extractedFieldsObject['Initial Date'] || 'Not specified'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 7: Surveillance Due Date and Expiry Date (Side by side) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Surveillance Due Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Surveillance Due Date'] || extractedFieldsObject['Due Date'] || ''}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Surveillance Due Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy (Optional)"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Surveillance Due Date'] || extractedFieldsObject['Due Date'] || 'Not specified'}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Expiry Date
                    </label>
                    {isEditingFields ? (
                      <input
                        type="text"
                        value={extractedFieldsObject['Expiry Date'] || extractedFieldsObject['Certificate Expiry'] || ''}
                        onChange={(e) => {
                          const newFields = { ...extractedFieldsObject };
                          newFields['Expiry Date'] = e.target.value;
                          handleFieldsChange(newFields);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="dd/mm/yyyy (Optional)"
                      />
                    ) : (
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                        {extractedFieldsObject['Expiry Date'] || extractedFieldsObject['Certificate Expiry'] || 'Not specified'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 8: Extra Line (Full Width) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Extra Line (Optional)
                  </label>
                  {isEditingFields ? (
                    <input
                      type="text"
                      value={extractedFieldsObject['Extra line'] || extractedFieldsObject['Extra Line'] || ''}
                      onChange={(e) => {
                        const newFields = { ...extractedFieldsObject };
                        newFields['Extra line'] = e.target.value;
                        handleFieldsChange(newFields);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="Additional information (Optional)"
                    />
                  ) : (
                    <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                      {extractedFieldsObject['Extra line'] || extractedFieldsObject['Extra Line'] || 'Not specified'}
                    </div>
                  )}
                </div>

                {/* Generate Certificate Button */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="flex items-center justify-end">
                <button
                  onClick={handleGenerateCertificate}
                      disabled={isProcessing || isCreatingClient}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                          {isCreatingClient ? 'Creating Client...' : 'Generating Certificate...'}
                    </>
                  ) : (
                    <>
                      <Download className="h-5 w-5" />
                          Generate Certificate
                    </>
                  )}
                </button>
                  </div>
                  
                  {/* Created Client Info */}
                  {createdClient && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-sm">
                          Client created: {createdClient.name} - {createdClient["ISO standard__a"] || 'No ISO Standard'}
                        </span>
              </div>
            </div>
          )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right Column - Excel Component */}
        <div>
          <CertificateGeneratorTabExcel />
        </div>
      </div>

    </div>
  );
}
