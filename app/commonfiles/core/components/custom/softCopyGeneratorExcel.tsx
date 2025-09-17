'use client';

import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, Download, Loader2, AlertCircle, CheckCircle, FileText, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { useSupabase } from '../../providers/SupabaseProvider';

interface ExcelRow {
  "Company Name"?: string;
  "Client Name"?: string;
  "Address"?: string;
  "ISO Standard"?: string;
  "Standard"?: string;
  "Scope"?: string;
  "Channel Partner"?: string;
  "Type"?: string;
  "Size"?: string;
  "Accreditation"?: string;
  "Logo"?: string;
  "Extra Line"?: string;  // ✅ ADDED: Extra Line field
  "Language"?: string;  // ✅ ADDED: Language field (S or blank)
  "Address Font Size"?: string;  // ✅ ADDED: Address font size field (1, -1 text format)
  "Address Adjustment"?: string;  // ✅ ADDED: Address adjustment field (1, -1 text format)
  "Scope Font Size"?: string;  // ✅ ADDED: Scope font size field (1, -2 text format)
  "Scope Adjustment"?: string;  // ✅ ADDED: Scope adjustment field (1, -1 text format)
  "Name Font Size"?: string;  // ✅ ADDED: Name font size field (1, -1 text format)
  "Name Adjustment"?: string;  // ✅ ADDED: Name adjustment field (1, -1 text format)
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
  // ✅ ADDED: The 5 optional fields
  certificateNumber: string;
  originalIssueDate: string;
  issueDate: string;
  surveillanceDate: string;
  recertificationDate: string;
  // ✅ ADDED: Extra Line field
  extraLine: string;
  // ✅ ADDED: The 3 new optional fields
  initialRegistrationDate: string;
  surveillanceDueDate: string;
  expiryDate: string;
  // ✅ ADDED: Revision field
  revision: string;
  // ✅ ADDED: Country field for template selection
  country: string;
  // ✅ ADDED: Language field (S or blank)
  language: string;
  // ✅ ADDED: Font size and adjustment fields
  addressFontSize: string;  // Address font size (1, -1 text format)
  addressAdjustment: string;  // Address adjustment (1, -1 text format)
  scopeFontSize: string;  // Scope font size (1, -2 text format)
  scopeAdjustment: string;  // Scope adjustment (1, -1 text format)
  nameFontSize: string;  // Name font size (1, -1 text format)
  nameAdjustment: string;  // Name adjustment (1, -1 text format)
  isValid: boolean;
  errors: string[];
}

export default function softCopyGeneratorExcel() {
  // State management
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  const [customTemplate, setCustomTemplate] = useState<File | null>(null);
  const [useCustomTemplate, setUseCustomTemplate] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedRows, setParsedRows] = useState<ProcessedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string}>({current: 0, total: 0, stage: ''});

  // Get tenant context
  const { userProfile, tenant } = useSupabase();

  // ✅ ADDED: Refs for file input elements
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  // Helper function to extract standard name from ISO standard
  const getStandardName = (isoStandard: string): string => {
    if (!isoStandard || isoStandard === 'N/A') return 'Unknown';
    // Remove year if present (e.g., "ISO 27001:2022" -> "ISO_27001")
    return isoStandard.replace(/:\d{4}$/, '').replace(/\s+/g, '_');
  };

  // ✅ FIXED: Helper function to display Excel dates as text (no conversion)
  const convertExcelDate = (value: string): string => {
    if (!value || value.trim() === '') return '';
    
    // ✅ NEW: Return all date values as text to avoid 1900 year issues
    // This ensures dates display exactly as entered in Excel
    const textValue = value.trim();
    
    // Log date-like values for debugging
    if (textValue.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/) || textValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      console.log(`🔍 [SOFTCOPY] Date value preserved as text: '${textValue}'`);
    }
    
    return textValue;
  };

  // File upload handlers
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                 file.type === 'application/vnd.ms-excel')) {
      setExcelFile(file);
      setError(null);
      setSuccess(null);
      setWarning(null);
      setParsedRows([]);
    }
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      setCustomTemplate(file);
      setError(null);
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

  // Column name normalization with specific mappings
  const normalizeColumnName = (columnName: string): string => {
    return columnName.toLowerCase().replace(/\s+/g, '');
  };

  const getColumnMapping = (headers: string[]) => {
    const mapping: { [key: string]: string } = {};
    
    console.log('🔍 [EXCEL] Headers received:', headers);
    
    headers.forEach(header => {
      const normalized = normalizeColumnName(header);
      console.log(`🔍 [EXCEL] Mapping header: "${header}" → normalized: "${normalized}"`);
      
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
        // ✅ ADDED: Map the 5 optional fields
        case 'certificatenumber':
          mapping[header] = 'certificateNumber';
          break;
        case 'originalissuedate':
          mapping[header] = 'originalIssueDate';
          break;
        case 'issuedate':
          mapping[header] = 'issueDate';
          break;
        case 'surveillancedate':
        case 'surveillance/expirydate':  // ✅ ADDED: Handle "Surveillance/ Expiry Date"
          mapping[header] = 'surveillanceDate';
          console.log(`🔍 [EXCEL] ✅ Mapped "${header}" to surveillanceDate`);
          break;
        case 'recertificationdate':
          mapping[header] = 'recertificationDate';
          break;
        // ✅ ADDED: Map the 3 new optional fields
        case 'initialregistrationdate':
          mapping[header] = 'initialRegistrationDate';
          break;
        case 'surveillanceduedate':
          mapping[header] = 'surveillanceDueDate';
          break;
        case 'expirydate':
          mapping[header] = 'expiryDate';
          break;
        // ✅ ADDED: Map the Revision field
        case 'revision':
          mapping[header] = 'revision';
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
        case 'country':
          mapping[header] = 'country';
          break;
        // ✅ ADDED: Map Extra Line field
        case 'extraline':
          mapping[header] = 'extraLine';
          break;
        // ✅ ADDED: Map Language field (S or blank)
        case 'language':
          mapping[header] = 'language';
          break;
        // ✅ ADDED: Map font size and adjustment fields
        case 'addressfontsize':
        case 'address_font_size':
          mapping[header] = 'addressFontSize';
          break;
        case 'addressadjustment':
        case 'address_adjustment':
          mapping[header] = 'addressAdjustment';
          break;
        case 'scopefontsize':
        case 'scope_font_size':
          mapping[header] = 'scopeFontSize';
          break;
        case 'scopeadjustment':
        case 'scope_adjustment':
          mapping[header] = 'scopeAdjustment';
          break;
        // ✅ ADDED: Map name font size and adjustment fields
        case 'namefontsize':
        case 'name_font_size':
          mapping[header] = 'nameFontSize';
          break;
        case 'nameadjustment':
        case 'name_adjustment':
          mapping[header] = 'nameAdjustment';
          break;
        default:
          // Ignore unknown columns
          break;
      }
    });
    
    console.log('🔍 [EXCEL] Final column mapping:', mapping);
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
      // ✅ ADDED: Initialize the 5 optional fields
      certificateNumber: '',
      originalIssueDate: '',
      issueDate: '',
      surveillanceDate: '',
      recertificationDate: '',
      // ✅ ADDED: Initialize the 3 new optional fields
      initialRegistrationDate: '',
      surveillanceDueDate: '',
      expiryDate: '',
      // ✅ ADDED: Initialize the Revision field
      revision: '',
      // ✅ ADDED: Initialize the Country field
      country: '',
      // ✅ ADDED: Initialize Extra Line field
      extraLine: '',
      // ✅ ADDED: Initialize Language field (S or blank)
      language: '',
      // ✅ ADDED: Initialize font size and adjustment fields
      addressFontSize: '',
      addressAdjustment: '',
      scopeFontSize: '',
      scopeAdjustment: '',
      nameFontSize: '',
      nameAdjustment: '',
      isValid: false,
      errors: []
    };

    // Process each mapped column
    Object.keys(columnMapping).forEach(originalHeader => {
      const fieldName = columnMapping[originalHeader];
      const value = row[originalHeader] || '';
      
      // ✅ ADDED: Debug logging for surveillance fields
      if (fieldName === 'surveillanceDate') {
        console.log(`🔍 [EXCEL] Processing surveillance field: "${originalHeader}" → "${fieldName}" = "${value}"`);
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
        // ✅ ADDED: Map the 5 optional fields
        case 'certificateNumber':
          processed.certificateNumber = value.trim();
          break;
        case 'originalIssueDate':
          processed.originalIssueDate = convertExcelDate(value);
          break;
        case 'issueDate':
          processed.issueDate = convertExcelDate(value);
          break;
        case 'surveillanceDate':
          processed.surveillanceDate = convertExcelDate(value);
          break;
        case 'recertificationDate':
          processed.recertificationDate = convertExcelDate(value);
          break;
        // ✅ ADDED: Map the 3 new optional fields
        case 'initialRegistrationDate':
          processed.initialRegistrationDate = convertExcelDate(value);
          break;
        case 'surveillanceDueDate':
          processed.surveillanceDueDate = convertExcelDate(value);
          break;
        case 'expiryDate':
          processed.expiryDate = convertExcelDate(value);
          break;
        // ✅ ADDED: Map the Revision field
        case 'revision':
          processed.revision = value.trim();
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
        case 'country':
          processed.country = value.trim();
          break;
        // ✅ ADDED: Process Extra Line field
        case 'extraLine':
          processed.extraLine = value.trim();
          break;
        // ✅ ADDED: Process Language field (S or blank)
        case 'language':
          processed.language = value.trim();
          break;
        // ✅ ADDED: Process font size and adjustment fields
        case 'addressFontSize':
          processed.addressFontSize = value.trim();
          break;
        case 'addressAdjustment':
          processed.addressAdjustment = value.trim();
          break;
        case 'scopeFontSize':
          processed.scopeFontSize = value.trim();
          break;
        case 'scopeAdjustment':
          processed.scopeAdjustment = value.trim();
          break;
        // ✅ ADDED: Process name font size and adjustment fields
        case 'nameFontSize':
          processed.nameFontSize = value.trim();
          break;
        case 'nameAdjustment':
          processed.nameAdjustment = value.trim();
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
    if (!processed.country) processed.country = '';  // ✅ ADDED: Default country to empty string

    // Row is valid if it has a name
    processed.isValid = !!processed.name;

    return processed;
  };

  // Process Excel data
  const processExcelData = async (file: File): Promise<ProcessedRow[]> => {
    const formData = new FormData();
    formData.append('excel', file);
    
    const response = await fetch('/api/excel/parse', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (parseError) {
        // If we can't parse JSON, try to get text content
        try {
          const errorText = await response.text();
          if (errorText.includes('Internal Server Error')) {
            errorMessage = 'Server error occurred while parsing Excel file. Please try again.';
          } else {
            errorMessage = `Server error: ${errorText.substring(0, 100)}...`;
          }
        } catch (textError) {
        }
      }
      throw new Error(errorMessage);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to parse Excel file');
    }
    
    // Normalize column names
    const columnMapping = getColumnMapping(data.headers);
    
    // Process rows with validation
    const processedRows = data.rows.map((row: any) => 
      validateAndProcessRow(row, columnMapping)
    );
    return processedRows;
  };

  // Main processing function
  const handleGenerate = async () => {
    if (!excelFile) {
      setError('Please upload an Excel file');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Step 1: Parse Excel file
      setProgress({current: 1, total: 3, stage: 'Parsing Excel file...'});
      const rows = await processExcelData(excelFile);
      setParsedRows(rows);
      
      // Step 2: Validate data
      setProgress({current: 2, total: 3, stage: 'Validating data...'});
      const invalidRows = rows.filter(row => !row.isValid);
      if (invalidRows.length > 0) {
        setError(`${invalidRows.length} rows have validation errors. Please fix them before proceeding.`);
        setIsProcessing(false);
        return;
      }

      // Step 3: Generate soft copies
      setProgress({current: 3, total: 3, stage: 'Starting PDF generation...'});
      
      // Call the Python service for each row
      const results = [];
      const pdfBlobs: Blob[] = [];
      const successfulRows: ProcessedRow[] = []; // ✅ ADDED: Track successful rows
      const overflowWarnings: string[] = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setProgress({current: i + 1, total: rows.length, stage: `Generating PDF ${i + 1} of ${rows.length}...`});
        
        try {
          const result = await generateSoftCopy(row);
          results.push(result);
          
          if (result.success && result.pdfBlob) {
            pdfBlobs.push(result.pdfBlob);
            successfulRows.push(row); // ✅ ADDED: Track successful row
            // Collect overflow warnings
            if (result.overflowWarnings) {
              overflowWarnings.push(result.overflowWarnings);
            }
          }
        } catch (error) {
          results.push({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Complete
      setProgress({current: rows.length, total: rows.length, stage: 'Finalizing...'});
      
      const successfulResults = results.filter(r => r.success);
      const failedResults = results.filter(r => !r.success);
      
      if (successfulResults.length > 0) {
        // Check for overflow warnings
        if (overflowWarnings.length > 0) {
          const warningMessage = overflowWarnings.join(' | ');
          setWarning(`⚠️ Some certificates had scope overflow issues and were generated with reduced font sizes. Check the generated PDFs for: ${warningMessage}`);
        }
        
        setSuccess(`Successfully generated ${successfulResults.length} soft copies!${failedResults.length > 0 ? ` ${failedResults.length} failed.` : ''}${overflowWarnings.length > 0 ? ' Some may have reduced font sizes due to scope overflow.' : ''}`);
        
        // If we have multiple PDFs, offer to download them as a ZIP
        if (pdfBlobs.length > 1) {
          // Create a ZIP file with all PDFs
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          
          pdfBlobs.forEach((blob, index) => {
            const row = successfulRows[index]; // ✅ FIXED: Use successfulRows instead of rows
            const filename = `${row.name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')}_SoftCopy_${getStandardName(row.isoStandard)}.pdf`;
            zip.file(filename, blob);
          });
          
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'soft_copies.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else if (pdfBlobs.length === 1) {
          // Download single PDF
          const url = URL.createObjectURL(pdfBlobs[0]);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${successfulRows[0].name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')}_SoftCopy_${getStandardName(successfulRows[0].isoStandard)}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } else {
        setError('Failed to generate any soft copies. Please check the logs for details.');
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process Excel file');
    } finally {
      setIsProcessing(false);
      setProgress({current: 0, total: 0, stage: ''});
    }
  };

  // Generate soft copy using Python service
  const generateSoftCopy = async (row: ProcessedRow): Promise<{success: boolean, error?: string, pdfBlob?: Blob, overflowWarnings?: string | null}> => {
    try {
      // ENHANCED LOGGING: Log the row data being processed

      // ✅ FIXED: Create JSON data object that matches backend expectations
      const jsonData = {
        "Company Name": row.name,
        "Address": row.address,
        "Address alignment": row.addressAlignment,
        "ISO Standard": row.isoStandard,
        "Scope": row.scope,
        "Size": row.size || '',
        "Accreditation": row.accreditation || '',
        "Logo": row.logo || '',
        "Country": row.country || '',  // ✅ ADDED: Country field
        "Certificate Number": row.certificateNumber || `SOFT-${row.name.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`,
        "Original Issue Date": row.originalIssueDate || '',
        "Issue Date": row.issueDate || '',
        "Surveillance/ Expiry Date": row.surveillanceDate || '',
        "Recertification Date": row.recertificationDate || '',
        "Initial Registration Date": row.initialRegistrationDate || '',
        "Surveillance Due Date": row.surveillanceDueDate || '',
        "Expiry Date": row.expiryDate || '',
        "Revision": row.revision || '',
        "Extra Line": row.extraLine || '',
        "Language": row.language || '',  // ✅ ADDED: Language field (S or blank)
        "Address Font Size": row.addressFontSize || '',  // ✅ ADDED: Address font size field
        "Address Adjustment": row.addressAdjustment || '',  // ✅ ADDED: Address adjustment field
        "Scope Font Size": row.scopeFontSize || '',  // ✅ ADDED: Scope font size field
        "Scope Adjustment": row.scopeAdjustment || '',  // ✅ ADDED: Scope adjustment field
        "Name Font Size": row.nameFontSize || '',  // ✅ ADDED: Name font size field
        "Name Adjustment": row.nameAdjustment || ''  // ✅ ADDED: Name adjustment field
      };


      const formData = new FormData();
      formData.append('data', JSON.stringify(jsonData));

      // ✅ ADDED: Add logo files (same as printable)
      if (logoFiles.length > 0) {
        logoFiles.forEach(file => {
          formData.append('logo_files', file);
        });
      }

      // ENHANCED LOGGING: Log what's being sent to the API

      const response = await fetch('/api/pdf/generate-softcopy', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate soft copy');
      }

      // Check for overflow warnings in response headers
      const overflowWarnings = response.headers.get('X-Overflow-Warnings');
      
      // The API now returns a PDF blob
      const pdfBlob = await response.blob();
      return { 
        success: true, 
        pdfBlob,
        overflowWarnings: overflowWarnings || null
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };


  // Generate printable using Python service
  const handleGeneratePrintable = async () => {
    if (!excelFile) {
      setError('Please upload an Excel file');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    
    try {
      // Step 1: Parse Excel file
      setProgress({current: 1, total: 3, stage: 'Parsing Excel file...'});
      const rows = await processExcelData(excelFile);
      setParsedRows(rows);
      
      // Step 2: Validate data
      setProgress({current: 2, total: 3, stage: 'Validating data...'});
      const invalidRows = rows.filter(row => !row.isValid);
      if (invalidRows.length > 0) {
        setError(`Found ${invalidRows.length} invalid rows. Please fix the errors and try again.`);
        setIsProcessing(false);
        return;
      }
      
      // Step 3: Generate printable certificates
      setProgress({current: 3, total: 3, stage: 'Generating printable certificates...'});
      
      const results = await generatePrintable(rows);
      
      if (results.success) {
        const successMessage = results.failedRows && results.failedRows > 0 
          ? `Successfully generated ${results.count} printable certificates! (${results.failedRows} rows failed)`
          : `Successfully generated ${results.count} printable certificates!`;
        setSuccess(successMessage);
        
        try {
          // Download ZIP file containing all PDFs
          if (results.zipBlob && results.zipBlob.size > 0) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(results.zipBlob);
            link.download = `printable_certificates_${new Date().toISOString().split('T')[0]}.zip`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Show user-friendly message
            setTimeout(() => {
              setSuccess(`Download started! Look for: ${link.download} in your downloads folder.`);
            }, 100);
            
            // Clean up the blob URL
            setTimeout(() => URL.revokeObjectURL(link.href), 100);
          } else {
            setWarning('PDFs generated successfully but there was an issue with ZIP creation. Please check the console for details.');
          }
        } catch (downloadError) {
          setWarning('PDFs generated successfully but there was an issue with ZIP download. Please check the console for details.');
        }
      } else {
        setError(results.error || 'Failed to generate printable certificates');
      }
    } catch (error) {
      
      // Provide more specific error messages
      let errorMessage = 'An unexpected error occurred';
      if (error instanceof Error) {
        if (error.message.includes('Server error occurred while parsing Excel file')) {
          errorMessage = 'Excel file parsing failed due to server error. Please try again.';
        } else if (error.message.includes('HTTP error! status: 500')) {
          errorMessage = 'Server error occurred. Please try again later.';
        } else if (error.message.includes('Failed to parse Excel file')) {
          errorMessage = 'Excel file could not be parsed. Please check the file format and try again.';
        } else {
          errorMessage = error.message;
        }
      }
      
      setError(errorMessage);
    } finally {
      setIsProcessing(false);
      setProgress({current: 0, total: 0, stage: ''});
    }
  };

  // Generate printable certificates using Python service
  const generatePrintable = async (rows: ProcessedRow[]): Promise<{success: boolean, count?: number, zipBlob?: Blob, error?: string, totalRows?: number, failedRows?: number}> => {
    try {
      const results = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          
          const formData = new FormData();
          formData.append('company_name', row.name);                    // ✅ Single value
          formData.append('address', row.address);                      // ✅ Single value
          formData.append('address_alignment', row.addressAlignment || '');  // ✅ ADDED: Address alignment support
          formData.append('iso_standard', row.isoStandard);             // ✅ Single value
          formData.append('scope', row.scope);                          // ✅ Single value
          formData.append('size', row.size || '');                      // ✅ Single value
          formData.append('accreditation', row.accreditation || '');    // ✅ Single value
          formData.append('logo', row.logo || '');                      // ✅ Single value
          formData.append('country', row.country || '');                // ✅ NEW: Add country field
          formData.append('certificate_number', row.certificateNumber || `PRINT-${row.name.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`);
          formData.append('original_issue_date', row.originalIssueDate || '');
          formData.append('issue_date', row.issueDate || '');
          formData.append('surveillance_date', row.surveillanceDate || '');
          formData.append('recertification_date', row.recertificationDate || '');
          
          // ✅ ADDED: Add the 3 new optional fields
          formData.append('initial_registration_date', row.initialRegistrationDate || '');
          formData.append('surveillance_due_date', row.surveillanceDueDate || '');
          formData.append('expiry_date', row.expiryDate || '');
          
          formData.append('revision', row.revision || '');
          formData.append('extra_line', row.extraLine || '');  // ✅ ADDED: Extra Line field
          formData.append('address_font_size', row.addressFontSize || '');  // ✅ ADDED: Address font size field
          formData.append('address_adjustment', row.addressAdjustment || '');  // ✅ ADDED: Address adjustment field
          formData.append('scope_font_size', row.scopeFontSize || '');  // ✅ ADDED: Scope font size field
          formData.append('scope_adjustment', row.scopeAdjustment || '');  // ✅ ADDED: Scope adjustment field
          formData.append('name_font_size', row.nameFontSize || '');  // ✅ ADDED: Name font size field
          formData.append('name_adjustment', row.nameAdjustment || '');  // ✅ ADDED: Name adjustment field
          
          // ✅ ADDED: Add logo files (same as soft copy)
          if (logoFiles.length > 0) {
            logoFiles.forEach(file => {
              formData.append('logo_files', file);
            });
          }
          
          // Add custom template if provided
          if (customTemplate) {
            formData.append('template', customTemplate);
          }
          
          const response = await fetch('/api/pdf/generate-printable', {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
              const errorData = await response.json();
              errorMessage = errorData.detail || errorMessage;
            } catch (parseError) {
            }
            throw new Error(errorMessage);
          }
          
          const blob = await response.blob();
          
          if (blob.size === 0) {
            throw new Error(`Generated PDF for ${row.name} is empty (0 bytes)`);
          }
          
          if (blob.type !== 'application/pdf') {
            // Log warning for unexpected blob type
          }
          
          results.push({ row: row.name, blob, isoStandard: row.isoStandard });
          
        } catch (error) {
          // Continue processing other rows instead of stopping
          continue;
        }
      }
      
      // Create ZIP file with proper naming
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      // Add each PDF to ZIP with proper filename format: <Company Name>_<ISO Standard>_Printable
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        
        // Sanitize filename for ZIP
        const sanitizeFilename = (name: string) => {
          return name.replace(/[\r\n\t]/g, '_').replace(/[<>:"|?*\\/]/g, '_').replace(/_+/g, '_');
        };
        
        const cleanRowName = sanitizeFilename(result.row);
        const cleanIsoStandard = sanitizeFilename(result.isoStandard);
        const filename = `${cleanRowName}_${cleanIsoStandard}_Printable.pdf`;
        
        // Add to ZIP
        zip.file(filename, result.blob);
      }
      
      // Generate ZIP blob
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Check if we have any successful results
      if (results.length === 0) {
        return {
          success: false,
          error: 'No printable certificates were generated successfully. All rows failed.'
        };
      }
      
      // Show success with count of successful vs total rows
      const totalRows = rows.length;
      const successfulRows = results.length;
      const failedRows = totalRows - successfulRows;
      
      return {
        success: true,
        count: successfulRows,
        zipBlob: zipBlob,
        totalRows: totalRows,
        failedRows: failedRows
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  };

  // Helper to find a logo file by name
  const findLogoForRow = (logoName: string): File | null => {
    if (!logoName) return null;
    return logoFiles.find(file => file.name.toLowerCase().includes(logoName.toLowerCase()));
  };

  // ✅ FIXED: Reset function now properly resets file inputs
  const handleReset = () => {
    setExcelFile(null);
    setCustomTemplate(null);
    setUseCustomTemplate(false);
    setParsedRows([]);
    setError(null);
    setSuccess(null);
    setProgress({current: 0, total: 0, stage: ''});
    
    // ✅ ADDED: Reset the actual file input elements
    if (excelFileInputRef.current) {
      excelFileInputRef.current.value = '';
    }
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = '';
    }
  };

  // Loading state
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
          <FileSpreadsheet className="h-5 w-5 text-blue-600" />
          Soft Copy Generator
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

      {warning && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center gap-2 text-yellow-700">
            <AlertCircle className="h-5 w-5" />
            <span>{warning}</span>
          </div>
        </div>
      )}

      {/* Template Selection */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useCustomTemplate}
              onChange={(e) => setUseCustomTemplate(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Use Custom Template</span>
          </label>
        </div>

        {useCustomTemplate && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
            <input
              ref={templateFileInputRef}
              type="file"
              accept=".docx"
              onChange={handleTemplateUpload}
              className="hidden"
              id="template-upload"
            />
            <label htmlFor="template-upload" className="cursor-pointer">
              {customTemplate ? (
                <div className="flex items-center gap-2 text-blue-600">
                  <FileText className="h-5 w-5" />
                  <span>{customTemplate.name}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <Upload className="h-8 w-8" />
                  <span>Click to upload custom template</span>
                  <span className="text-sm">Supports .docx files</span>
                </div>
              )}
            </label>
          </div>
        )}
      </div>

      {/* Excel Upload */}
      <div className="mb-8">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <input
            ref={excelFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelUpload}
            className="hidden"
            id="excel-upload"
          />
          <label htmlFor="excel-upload" className="cursor-pointer">
            {excelFile ? (
              <div className="flex items-center gap-2 text-blue-600">
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
            accept="image/*"
            multiple
            onChange={handleLogoFilesUpload}
            className="hidden"
            id="logo-upload"
          />
          <label htmlFor="logo-upload" className="cursor-pointer">
            {logoFiles.length > 0 ? (
              <div className="flex items-center gap-2 text-orange-600">
                <ImageIcon className="h-5 w-5" />
                <span>{logoFiles.length} logo file(s) uploaded</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-orange-500">
                <ImageIcon className="h-8 w-8" />
                <span>Click to upload logo files (Optional)</span>
                <span className="text-sm">Upload logos that match Excel "Logo" column filenames</span>
                <span className="text-xs text-gray-500">Supports PNG, JPG, JPEG. Max 5MB per file</span>
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


      {/* Generate Button */}
      <div className="mb-8">
        <div className="bg-gray-50 rounded-lg p-6">
          <p className="text-gray-600 mb-4">
            {!excelFile ? 'Upload an Excel file to process data.' : 'Ready to process Excel file.'}
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
              <h5 className="text-sm font-medium text-gray-900 mb-3">Data Preview</h5>
              <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
                <div className="grid grid-cols-1 gap-2">
                  {parsedRows.map((row, index) => (
                    <div key={index} className={`p-3 rounded border ${row.isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {row.isValid ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span className="font-medium">Row {index + 1}</span>
                      </div>
                      <div className="text-sm text-gray-700">
                        <div><strong>Company:</strong> {row.name}</div>
                        <div><strong>Address:</strong> {row.address}</div>
                        <div><strong>ISO Standard:</strong> {row.isoStandard}</div>
                        <div><strong>Scope:</strong> {row.scope}</div>
                        <div><strong>Channel Partner:</strong> {row.channelPartner}</div>
                        <div><strong>Type:</strong> {row.type}</div>
                        <div><strong>Size:</strong> {row.size || 'Not provided'}</div>
                        <div><strong>Accreditation:</strong> {row.accreditation || 'Not provided'}</div>
                        <div><strong>Logo:</strong> {row.logo || 'Not provided'}</div>
                        {/* ✅ ADDED: Display the 5 optional fields */}
                        <div><strong>Certificate Number:</strong> {row.certificateNumber || 'Auto-generated'}</div>
                        <div><strong>Original Issue Date:</strong> {row.originalIssueDate || 'Not provided'}</div>
                        <div><strong>Issue Date:</strong> {row.issueDate || 'Not provided'}</div>
                        <div><strong>Surveillance Date:</strong> {row.surveillanceDate || 'Not provided'}</div>
                        <div><strong>Recertification Date:</strong> {row.recertificationDate || 'Not provided'}</div>
                      </div>
                      {row.errors.length > 0 && (
                        <div className="mt-2 text-sm text-red-600">
                          <strong>Errors:</strong>
                          <ul className="list-disc list-inside ml-2">
                            {row.errors.map((error, errorIndex) => (
                              <li key={errorIndex}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={!excelFile || isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  Generate Soft Copies
                </>
              )}
            </button>
            
            <button
              onClick={handleGeneratePrintable}
              disabled={!excelFile || isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  Generate Printable
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
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center gap-2 text-blue-700">
            <FileSpreadsheet className="h-4 w-4" />
            <span className="text-sm">
              Excel file loaded: {excelFile.name} ({(excelFile.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        </div>
      )}

      {customTemplate && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center gap-2 text-green-700">
            <FileText className="h-4 w-4" />
            <span className="text-sm">
              Custom template loaded: {customTemplate.name} ({(customTemplate.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
