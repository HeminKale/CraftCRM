import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export interface FieldMetadata {
  id: string;
  name: string;
  label: string;
  type: string;
  is_required: boolean;
  reference_table?: string;
  reference_display_field?: string;
  tenant_id: string;
}

export interface ResolvedFieldValue {
  [fieldName: string]: string;
}

export interface ResolvedRecordValues {
  [recordId: string]: ResolvedFieldValue;
}

export const useFieldResolution = (tenantId: string) => {
  console.log(`🔍 HOOK INITIALIZED: useFieldResolution with tenantId: ${tenantId}`);
  
  const [resolvedValues, setResolvedValues] = useState<ResolvedRecordValues>({});
  const [loading, setLoading] = useState<{ [key: string]: boolean }>({});
  const [referenceOptions, setReferenceOptions] = useState<{ [key: string]: any[] }>({});
  const [referenceLoading, setReferenceLoading] = useState<{ [key: string]: boolean }>({});
  const supabase = createClientComponentClient();

  // Load reference options for a specific field when needed
  const loadReferenceOptions = async (fieldName: string, referenceTable: string) => {
    console.log(`🚀 === loadReferenceOptions CALLED ===`);
    console.log(`🚀 Parameters: fieldName=${fieldName}, referenceTable=${referenceTable}, tenantId=${tenantId}`);
    
    if (!tenantId || !referenceTable || referenceOptions[fieldName]) {
      console.log(`⚠️ SKIPPING: ${!tenantId ? 'No tenantId' : !referenceTable ? 'No referenceTable' : 'Already loaded'}`);
      return; // Already loaded or missing required data
    }

    console.log(`🔍 LOADING: ${fieldName} from ${referenceTable}`);
    console.log(`🔍 REFERENCE TABLE DETAILS:`);
    console.log(`  - Original referenceTable: ${referenceTable}`);
    console.log(`  - Has __a suffix: ${referenceTable.includes('__a')}`);
    console.log(`  - Tenant ID: ${tenantId}`);
    
    // INVESTIGATE: Let's try both with and without __a suffix to see which works
    const tableNameWithoutSuffix = referenceTable.endsWith('__a') ? referenceTable.replace(/__a$/, '') : referenceTable;
    const tableNameWithSuffix = referenceTable.endsWith('__a') ? referenceTable : referenceTable + '__a';
    
    console.log(`🔍 INVESTIGATING: Will try multiple table name variations:`);
    console.log(`  - Original: ${referenceTable}`);
    console.log(`  - Without __a: ${tableNameWithoutSuffix}`);
    console.log(`  - With __a: ${tableNameWithSuffix}`);
    
    setReferenceLoading(prev => ({ ...prev, [fieldName]: true }));
    
    try {
      // First try the original table name as provided
      console.log(`🔍 TESTING RPC: get_reference_options with ORIGINAL table: ${referenceTable}, tenant: ${tenantId}`);
      
      const { data: originalData, error: originalError } = await supabase
        .rpc('get_reference_options', {
          p_table_name: referenceTable,
          p_tenant_id: tenantId,
          p_limit: 100
        });

      if (originalError) {
        console.log(`❌ ORIGINAL failed: ${originalError.message}`);
        
        // Try without __a suffix
        console.log(`🔍 TESTING RPC: get_reference_options with NO SUFFIX table: ${tableNameWithoutSuffix}, tenant: ${tenantId}`);
        
        const { data: noSuffixData, error: noSuffixError } = await supabase
          .rpc('get_reference_options', {
            p_table_name: tableNameWithoutSuffix,
            p_tenant_id: tenantId,
            p_limit: 100
          });

        if (noSuffixError) {
          console.log(`❌ NO SUFFIX also failed: ${noSuffixError.message}`);
          
          // Try with __a suffix
          console.log(`🔍 TESTING RPC: get_reference_options with SUFFIX table: ${tableNameWithSuffix}, tenant: ${tenantId}`);
          
          const { data: withSuffixData, error: withSuffixError } = await supabase
            .rpc('get_reference_options', {
              p_table_name: tableNameWithSuffix,
              p_tenant_id: tenantId,
              p_limit: 100
            });

          if (withSuffixError) {
            console.log(`❌ WITH SUFFIX also failed: ${withSuffixError.message}`);
            console.error(`❌ ALL TABLE NAME VARIATIONS FAILED for ${fieldName}`);
            console.error(`❌ This suggests a deeper issue than table naming`);
          } else if (withSuffixData) {
            console.log(`✅ WITH SUFFIX SUCCEEDED: ${fieldName} - ${withSuffixData.length} options`);
            setReferenceOptions(prev => ({ ...prev, [fieldName]: withSuffixData }));
          }
        } else if (noSuffixData) {
          console.log(`✅ NO SUFFIX SUCCEEDED: ${fieldName} - ${noSuffixData.length} options`);
          setReferenceOptions(prev => ({ ...prev, [fieldName]: noSuffixData }));
        }
      } else if (originalData) {
        console.log(`✅ ORIGINAL SUCCEEDED: ${fieldName} - ${originalData.length} options`);
        setReferenceOptions(prev => ({ ...prev, [fieldName]: originalData }));
      }
      
    } catch (err) {
      console.error(`❌ EXCEPTION loading ${fieldName}:`, err);
    } finally {
      setReferenceLoading(prev => ({ ...prev, [fieldName]: false }));
    }
  };

  // Simple function to get display value for a reference field
  const getReferenceDisplayValue = (fieldName: string, fieldValue: any): string => {
    if (!fieldValue || !referenceOptions[fieldName]) {
      return fieldValue || '-';
    }

    const options = referenceOptions[fieldName];
    const option = options.find((opt: any) => opt.id === fieldValue);
    
    if (option) {
      const displayValue = option.display_name || option.record_name || option.name || option.label || `Record ${option.id}`;
      console.log(`🔍 RESOLVED: ${fieldName} = ${fieldValue} -> ${displayValue}`);
      return displayValue;
    }

    console.log(`⚠️ NO MATCH: ${fieldName} = ${fieldValue} in ${options.length} options`);
    return fieldValue || '-';
  };

  // Universal function to get field display value
  const getFieldDisplayValue = (record: any, fieldName: string, fieldValue: any, recordId?: string): string => {
    // For reference fields, use the pre-loaded options
    if (referenceOptions[fieldName] && referenceOptions[fieldName].length > 0) {
      return getReferenceDisplayValue(fieldName, fieldValue);
    }
    
    // For non-reference fields, return the value as-is
    return fieldValue || '-';
  };

  // Smart field lookup - tries multiple variations
  const getSmartFieldValue = (record: any, fieldName: string): any => {
    let fieldValue = record[fieldName];
    
    // If not found, try with __a suffix
    if (fieldValue === undefined && !fieldName.endsWith('__a')) {
      fieldValue = record[`${fieldName}__a`];
    }
    
    // If still not found, try with _a suffix
    if (fieldValue === undefined && !fieldName.endsWith('_a')) {
      fieldValue = record[`${fieldName}_a`];
    }
    
    // If still not found, try snake_case version
    if (fieldValue === undefined) {
      const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
      fieldValue = record[snakeCase];
    }
    
    // If still not found, try snake_case with __a suffix
    if (fieldValue === undefined) {
      const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
      fieldValue = record[`${snakeCase}__a`];
    }
    
    return fieldValue;
  };

  // Check if a field is a reference field
  const isReferenceField = (fieldName: string): boolean => {
    return referenceOptions[fieldName] && referenceOptions[fieldName].length > 0;
  };

  // Get reference options for a field
  const getReferenceOptions = (fieldName: string): any[] => {
    return referenceOptions[fieldName] || [];
  };

  // Check if reference options are loading for a field
  const isReferenceLoading = (fieldName: string): boolean => {
    return referenceLoading[fieldName] || false;
  };

  return {
    resolvedValues,
    loading,
    referenceOptions,
    referenceLoading,
    getFieldDisplayValue,
    getSmartFieldValue,
    getReferenceDisplayValue,
    isReferenceField,
    getReferenceOptions,
    isReferenceLoading,
    loadReferenceOptions
  };
};
