'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Download, AlertCircle, CheckCircle, Loader2, Users, Tag, Eye, Edit3, Trash2 } from 'lucide-react';
import { createClientSupabaseClient } from '../../lib/supabase';
import { useSupabase } from '../../providers/SupabaseProvider';

interface CertificateSoftCopyProps {
  tabId: string;
  tabLabel: string;
}



interface Client {
  id: string;
  name: string;
  "ISO standard__a": string | null;
  channelPartner__a: string | null;
  type__a: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function CertificateSoftCopy({ tabId, tabLabel }: CertificateSoftCopyProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New state for dropdowns and search
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedIsoStandard, setSelectedIsoStandard] = useState<string>('');
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  // Get tenant context
  const { userProfile, tenant } = useSupabase();

  // Certificate types - now using actual values from clients__a.type__a
  const certificateTypes = [
    { value: '', label: 'All Types' },
    { value: 'new', label: 'New' },
    { value: 'renewal', label: 'Renewal' }
  ];

  // ISO Standards (hardcoded for now)
  const isoStandards = [
    { value: '', label: 'All ISO Standards' },
    { value: '9001:2015', label: 'ISO 9001:2015' },
    { value: '14001:2015', label: 'ISO 14001:2015' },
    { value: '45001:2018', label: 'ISO 45001:2018' }
  ];



  // Fetch data when tenant is available
  useEffect(() => {
    if (tenant?.id) {
      fetchClients();
    }
  }, [tenant]);

  const fetchClients = async () => {
    if (!tenant?.id) return;

    try {
      const supabase = createClientSupabaseClient();
      
      const { data, error } = await supabase
        .rpc('get_tenant_clients', { p_tenant_id: tenant.id });

      if (error) {
        console.error('Error fetching clients:', error);
        return;
      }

      if (data) {
        setClients(data);
      }
    } catch (err) {
      console.error('Error fetching clients:', err);
    }
  };





  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString();
  };



  // Show all clients by default, filter based on dropdown selections
  const [showClientsTable, setShowClientsTable] = useState(true);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [selectedClientRecord, setSelectedClientRecord] = useState<string>('');
  
  // Multi-step form state
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [certificateDetails, setCertificateDetails] = useState({
    companyName: '',
    isoStandard: '',
    scope: '',
    address: '',
    certificateNo: '',
    originalIssueDate: '',
    issueDate: '',
    surveillanceExpiryDate: '',
    recertificationDate: ''
  });
  const [selectedFields, setSelectedFields] = useState({
    certificateNo: false,
    originalIssueDate: false,
    issueDate: false,
    surveillanceExpiryDate: false,
    recertificationDate: false
  });
  
  // Edit mode state for all fields
  const [editMode, setEditMode] = useState({
    companyName: false,
    isoStandard: false,
    scope: false,
    address: false,
    certificateNo: false,
    originalIssueDate: false,
    issueDate: false,
    surveillanceExpiryDate: false,
    recertificationDate: false
  });

  // Initialize filtered clients with all clients
  useEffect(() => {
    setFilteredClients(clients);
  }, [clients]);

  // Filter clients based on dropdown selections
  const getFilteredClients = () => {
    return clients.filter(client => {
      // Client filter (if specific client selected)
      const matchesClient = !selectedClient || client.id === selectedClient;
      
      // ISO Standard filter
      const matchesIso = !selectedIsoStandard || client["ISO standard__a"] === selectedIsoStandard;
      
      // Type filter - use actual type__a field from clients__a
      const matchesType = !selectedType || client.type__a === selectedType;
      
      return matchesClient && matchesIso && matchesType;
    });
  };

  // Update filtered clients when dropdowns change
  useEffect(() => {
    setFilteredClients(getFilteredClients());
  }, [selectedClient, selectedType, selectedIsoStandard, clients]);

  // Handle Next button click
  const handleNext = async () => {
    if (selectedClientRecord) {
      const selectedClient = clients.find(c => c.id === selectedClientRecord);
      if (selectedClient) {
        console.log('🔍 handleNext - Selected Client:', {
          id: selectedClient.id,
          name: selectedClient.name,
          isoStandard: selectedClient["ISO standard__a"],
          type: selectedClient.type__a
        });
        
        setIsLoadingDraft(true);
        try {
          // First, try to fetch existing draft data for this client
          const supabase = createClientSupabaseClient();
          console.log('🔍 handleNext - Fetching draft for client ID:', selectedClient.id);
          
                     const { data: draftData, error: draftError } = await supabase
             .rpc('get_tenant_draft_for_client', { 
               p_tenant_id: tenant?.id, 
               p_client_id: selectedClient.id 
             });

          console.log('🔍 handleNext - Draft Query Result:', {
            draftData,
            draftError,
            errorCode: draftError?.code,
            errorMessage: draftError?.message
          });

                     if (draftError) {
             console.error('❌ Error fetching draft:', draftError);
           } else if (!draftData || draftData.length === 0) {
             console.log('ℹ️ No draft found for this client');
           } else {
             console.log('✅ Draft found successfully');
           }

                     // Get the first (and only) draft record
           const draftRecord = draftData && draftData.length > 0 ? draftData[0] : null;
           
           // Log the specific fields we're extracting
           console.log('🔍 handleNext - Extracting fields from draft:', {
             scope: draftRecord?.scope__a,
             address: draftRecord?.address__a,
             certificateNumber: draftRecord?.certificateNumber__a,
             originalIssueDate: draftRecord?.originalIssueDate__a,
             issueDate: draftRecord?.issueDate__a,
             surveillanceDate: draftRecord?.surveillanceDate__a,
             recertificationDate: draftRecord?.recertificationDate__a
           });

           // Populate certificate details with client data and existing draft data if available
           const populatedDetails = {
             companyName: selectedClient.name,
             isoStandard: selectedClient["ISO standard__a"] || '',
             scope: draftRecord?.scope__a || '', // Use existing draft scope or empty
             address: draftRecord?.address__a || '', // Use existing draft address or empty
             certificateNo: draftRecord?.certificateNumber__a || '',
             originalIssueDate: draftRecord?.originalIssueDate__a || '',
             issueDate: draftRecord?.issueDate__a || '',
             surveillanceExpiryDate: draftRecord?.surveillanceDate__a || '',
             recertificationDate: draftRecord?.recertificationDate__a || ''
           };

          console.log('🔍 handleNext - Final populated certificate details:', populatedDetails);

          setCertificateDetails(populatedDetails);

                     // Update selected fields based on existing draft data
           const selectedFieldsData = {
             certificateNo: !!draftRecord?.certificateNumber__a,
             originalIssueDate: !!draftRecord?.originalIssueDate__a,
             issueDate: !!draftRecord?.issueDate__a,
             surveillanceExpiryDate: !!draftRecord?.surveillanceDate__a,
             recertificationDate: !!draftRecord?.recertificationDate__a
           };

          console.log('🔍 handleNext - Selected fields state:', selectedFieldsData);
          setSelectedFields(selectedFieldsData);

          setCurrentStep(2);
          console.log('✅ handleNext - Successfully moved to Step 2');
        } catch (err) {
          console.error('❌ Error in handleNext:', err);
          // Fallback to basic client data if draft fetch fails
          const fallbackDetails = {
            companyName: selectedClient.name,
            isoStandard: selectedClient["ISO standard__a"] || '',
            scope: '',
            address: '',
            certificateNo: '',
            originalIssueDate: '',
            issueDate: '',
            surveillanceExpiryDate: '',
            recertificationDate: ''
          };
          
          console.log('🔍 handleNext - Using fallback details:', fallbackDetails);
          setCertificateDetails(fallbackDetails);
          setCurrentStep(2);
        } finally {
          setIsLoadingDraft(false);
          console.log('🔍 handleNext - Loading state set to false');
        }
      }
    }
  };

  // Handle Back button click
  const handleBack = () => {
    setCurrentStep(1);
    setSelectedClientRecord('');
    setCertificateDetails({
      companyName: '',
      isoStandard: '',
      scope: '',
      address: '',
      certificateNo: '',
      originalIssueDate: '',
      issueDate: '',
      surveillanceExpiryDate: '',
      recertificationDate: ''
    });
    setSelectedFields({
      certificateNo: false,
      originalIssueDate: false,
      issueDate: false,
      surveillanceExpiryDate: false,
      recertificationDate: false
    });
    // Reset edit mode
    setEditMode({
      companyName: false,
      isoStandard: false,
      scope: false,
      address: false,
      certificateNo: false,
      originalIssueDate: false,
      issueDate: false,
      surveillanceExpiryDate: false,
      recertificationDate: false
    });
  };

  // Handle field selection checkbox changes
  const handleFieldSelection = (field: string, checked: boolean) => {
    setSelectedFields(prev => ({
      ...prev,
      [field]: checked
    }));
  };

  // Handle certificate details input changes
  const handleInputChange = (field: string, value: string) => {
    setCertificateDetails(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Toggle edit mode for all fields
  const toggleEditMode = (field: keyof typeof editMode) => {
    setEditMode(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-8">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">Loading clients...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
                           {/* Header - Dynamic based on step */}
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {currentStep === 1 ? 'Client Management' : 'Certificate Details'}
                  </h1>
                  <p className="text-gray-600">
                    {currentStep === 1 
                      ? 'View and manage all clients with search and filtering'
                      : 'Fill in certificate information for the selected client'
                    }
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {currentStep === 1 && (
                    <span className="text-sm text-gray-500">Total: {filteredClients.length} clients</span>
                  )}
                  {currentStep === 2 && (
                    <span className="text-sm text-gray-500">
                      Client: {clients.find(c => c.id === selectedClientRecord)?.name}
                    </span>
                  )}
                </div>
              </div>

                               {/* Dropdowns and Filtering - Only show on Step 1 */}
                {currentStep === 1 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Users className="h-5 w-5 text-blue-600" />
                      Filter Clients
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Client Dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Client
                        </label>
                        <select 
                          value={selectedClient}
                          onChange={(e) => setSelectedClient(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          disabled={isLoadingClients}
                        >
                          <option value="">All Clients</option>
                          {clients.map(client => (
                            <option key={client.id} value={client.id}>
                              {client.name} - {client["ISO standard__a"] || 'No ISO Standard'}
                            </option>
                          ))}
                        </select>
                        {isLoadingClients && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading clients...
                          </div>
                        )}
                      </div>
                      
                      {/* Type Dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Certificate Type
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

                      {/* ISO Standard Dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          ISO Standard
                        </label>
                        <select 
                          value={selectedIsoStandard}
                          onChange={(e) => setSelectedIsoStandard(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        >
                          {isoStandards.map(iso => (
                            <option key={iso.value} value={iso.value}>
                              {iso.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Selected Options Info */}
                    {(selectedClient || selectedType || selectedIsoStandard) && (
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <div className="flex items-center gap-2 text-blue-700">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm">
                            Filter Criteria: 
                            {selectedClient && ` Client: ${clients.find(c => c.id === selectedClient)?.name}`}
                            {selectedType && ` Type: ${selectedType}`}
                            {selectedIsoStandard && ` ISO: ${selectedIsoStandard}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

             

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="h-5 w-5" />
            <span>{success}</span>
          </div>
        </div>
      )}

                           {/* Clients Table - Only show on Step 1 */}
              {currentStep === 1 && (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Select
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Client Name
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            ISO Standard
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Certificate Type
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Channel Partner
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Created
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredClients.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                              <div className="flex flex-col items-center gap-2">
                                <Users className="h-12 w-12 text-gray-300" />
                                <p className="text-lg font-medium">No clients found</p>
                                <p className="text-sm">No clients match the selected criteria</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredClients.map((client) => (
                            <tr key={client.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <input
                                  type="radio"
                                  name="selectedClient"
                                  value={client.id}
                                  checked={selectedClientRecord === client.id}
                                  onChange={(e) => setSelectedClientRecord(e.target.value)}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                                />
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{client.name}</div>
                                <div className="text-sm text-gray-500">ID: {client.id.slice(0, 8)}...</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {client["ISO standard__a"] || 'No ISO Standard'}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {client.type__a ? (
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      client.type__a === 'new' 
                                        ? 'bg-blue-100 text-blue-800' 
                                        : 'bg-purple-100 text-purple-800'
                                    }`}>
                                      {client.type__a.charAt(0).toUpperCase() + client.type__a.slice(1)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-500">Not specified</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {client.channelPartner__a ? client.channelPartner__a.slice(0, 8) + '...' : 'No Partner'}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  client.is_active 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {client.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {formatDate(client.created_at)}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

                               {/* Selected Client Info - Only show on Step 1 */}
                {currentStep === 1 && selectedClientRecord && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <div className="flex items-center gap-2 text-blue-700">
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Selected Client: {clients.find(c => c.id === selectedClientRecord)?.name}
                      </span>
                    </div>
                  </div>
                )}

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center">
          <button
            onClick={handleBack}
            disabled={currentStep === 1}
            className={`px-4 py-2 rounded-md ${
              currentStep === 1
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            Back
          </button>
          
          <button
            onClick={handleNext}
            disabled={!selectedClientRecord || isLoadingDraft}
            className={`px-6 py-2 rounded-md ${
              !selectedClientRecord || isLoadingDraft
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isLoadingDraft ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading Draft...
              </div>
            ) : (
              'Next'
            )}
          </button>
        </div>

        {/* Certificate Details Form - Step 2 */}
        {currentStep === 2 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Certificate Details
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                                 {/* Company Name */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className="block text-sm font-medium text-gray-700">
                       Company Name
                     </label>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('companyName')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.companyName ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="text"
                     value={certificateDetails.companyName}
                     onChange={(e) => handleInputChange('companyName', e.target.value)}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       editMode.companyName 
                         ? 'focus:border-blue-500 bg-white' 
                         : 'bg-gray-50 cursor-not-allowed'
                     }`}
                     readOnly={!editMode.companyName}
                   />
                 </div>

                                 {/* ISO Standard */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className="block text-sm font-medium text-gray-700">
                       ISO Standard
                     </label>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('isoStandard')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.isoStandard ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="text"
                     value={certificateDetails.isoStandard}
                     onChange={(e) => handleInputChange('isoStandard', e.target.value)}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       editMode.isoStandard 
                         ? 'focus:border-blue-500 bg-white' 
                         : 'bg-gray-50 cursor-not-allowed'
                     }`}
                     readOnly={!editMode.isoStandard}
                   />
                 </div>

                                 {/* Scope */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className="block text-sm font-medium text-gray-700">
                       Scope
                     </label>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('scope')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.scope ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <textarea
                     value={certificateDetails.scope}
                     onChange={(e) => handleInputChange('scope', e.target.value)}
                     rows={3}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       editMode.scope 
                         ? 'focus:border-blue-500 bg-white' 
                         : 'bg-gray-50 cursor-not-allowed'
                     }`}
                     placeholder="Enter scope of certification"
                     readOnly={!editMode.scope}
                   />
                 </div>

                                 {/* Address */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className="block text-sm font-medium text-gray-700">
                       Address
                     </label>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('address')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.address ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <textarea
                     value={certificateDetails.address}
                     onChange={(e) => handleInputChange('address', e.target.value)}
                     rows={3}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       editMode.address 
                         ? 'focus:border-blue-500 bg-white' 
                         : 'bg-gray-50 cursor-not-allowed'
                     }`}
                     placeholder="Enter company address"
                     readOnly={!editMode.address}
                   />
                 </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                                 {/* Certificate No. */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <div className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={selectedFields.certificateNo}
                         onChange={(e) => handleFieldSelection('certificateNo', e.target.checked)}
                         className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                       />
                       <label className="text-sm font-medium text-gray-700">
                         Certificate No.
                       </label>
                     </div>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('certificateNo')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.certificateNo ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="text"
                     value={certificateDetails.certificateNo}
                     onChange={(e) => handleInputChange('certificateNo', e.target.value)}
                     disabled={!selectedFields.certificateNo}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       selectedFields.certificateNo 
                         ? (editMode.certificateNo ? 'focus:border-blue-500 bg-white' : 'focus:border-blue-500') 
                         : 'bg-gray-100 cursor-not-allowed'
                     }`}
                     placeholder="Enter certificate number"
                     readOnly={!editMode.certificateNo}
                   />
                 </div>

                                 {/* Original Issue Date */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <div className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={selectedFields.originalIssueDate}
                         onChange={(e) => handleFieldSelection('originalIssueDate', e.target.checked)}
                         className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                       />
                       <label className="text-sm font-medium text-gray-700">
                         Original Issue Date
                       </label>
                     </div>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('originalIssueDate')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.originalIssueDate ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="date"
                     value={certificateDetails.originalIssueDate}
                     onChange={(e) => handleInputChange('originalIssueDate', e.target.value)}
                     disabled={!selectedFields.originalIssueDate}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       selectedFields.originalIssueDate 
                         ? (editMode.originalIssueDate ? 'focus:border-blue-500 bg-white' : 'focus:border-blue-500') 
                         : 'bg-gray-100 cursor-not-allowed'
                     }`}
                     readOnly={!editMode.originalIssueDate}
                   />
                 </div>

                                 {/* Issue Date */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <div className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={selectedFields.issueDate}
                         onChange={(e) => handleFieldSelection('issueDate', e.target.checked)}
                         className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                       />
                       <label className="text-sm font-medium text-gray-700">
                         Issue Date
                       </label>
                     </div>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('issueDate')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.issueDate ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="date"
                     value={certificateDetails.issueDate}
                     onChange={(e) => handleInputChange('issueDate', e.target.value)}
                     disabled={!selectedFields.issueDate}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       selectedFields.issueDate 
                         ? (editMode.issueDate ? 'focus:border-blue-500 bg-white' : 'focus:border-blue-500') 
                         : 'bg-gray-100 cursor-not-allowed'
                     }`}
                     readOnly={!editMode.issueDate}
                   />
                 </div>

                                 {/* Surveillance/Expiry Date */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <div className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={selectedFields.surveillanceExpiryDate}
                         onChange={(e) => handleFieldSelection('surveillanceExpiryDate', e.target.checked)}
                         className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                       />
                       <label className="text-sm font-medium text-gray-700">
                         Surveillance/Expiry Date
                       </label>
                     </div>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('surveillanceExpiryDate')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.surveillanceExpiryDate ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="date"
                     value={certificateDetails.surveillanceExpiryDate}
                     onChange={(e) => handleInputChange('surveillanceExpiryDate', e.target.value)}
                     disabled={!selectedFields.surveillanceExpiryDate}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       selectedFields.surveillanceExpiryDate 
                         ? (editMode.surveillanceExpiryDate ? 'focus:border-blue-500 bg-white' : 'focus:border-blue-500') 
                         : 'bg-gray-100 cursor-not-allowed'
                     }`}
                     readOnly={!editMode.surveillanceExpiryDate}
                   />
                 </div>

                                 {/* Recertification Date */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <div className="flex items-center gap-2">
                       <input
                         type="checkbox"
                         checked={selectedFields.recertificationDate}
                         onChange={(e) => handleFieldSelection('recertificationDate', e.target.checked)}
                         className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                       />
                       <label className="text-sm font-medium text-gray-700">
                         Recertification Date
                       </label>
                     </div>
                     <button
                       type="button"
                       onClick={() => toggleEditMode('recertificationDate')}
                       className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                     >
                       {editMode.recertificationDate ? (
                         <>
                           <CheckCircle className="h-4 w-4" />
                           Done
                         </>
                       ) : (
                         <>
                           <Edit3 className="h-4 w-4" />
                           Edit
                         </>
                       )}
                     </button>
                   </div>
                   <input
                     type="date"
                     value={certificateDetails.recertificationDate}
                     onChange={(e) => handleInputChange('recertificationDate', e.target.value)}
                     disabled={!selectedFields.recertificationDate}
                     className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 ${
                       selectedFields.recertificationDate 
                         ? (editMode.recertificationDate ? 'focus:border-blue-500 bg-white' : 'focus:border-blue-500') 
                         : 'bg-gray-100 cursor-not-allowed'
                       }`}
                     readOnly={!editMode.recertificationDate}
                   />
                 </div>
              </div>
            </div>
          </div>
        )}

      

      {/* Tab Info */}
      <div className="mt-8 p-4 bg-gray-50 rounded-md">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Tab Information</h3>
        <div className="text-xs text-gray-500 space-y-1">
          <p><strong>Tab ID:</strong> {tabId}</p>
          <p><strong>Component Path:</strong> custom/certificateSoftCopy</p>
          <p><strong>Type:</strong> Custom Tab</p>
          <p><strong>Features:</strong> Certificate Management, Search & Filtering, PDF Download, CRUD Operations</p>
        </div>
      </div>
    </div>
  );
}
