'use client';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type FieldMeta = {
  name: string;
  type: string;                      // 'reference'
  reference_table?: string;          // e.g. 'channel_partner'
  reference_display_field?: string;  // e.g. 'name'
};

type RecordWithFields = { 
  record_id: string; 
  fields: Record<string, any>;
  [key: string]: any; // Allow additional properties like created_at, updated_at
};

export function useReferenceLabels(tenantId: string) {
  const supabase = createClientComponentClient();

  // Enhanced batch resolve function with better error handling and validation
  const resolveReferenceFields = async (records: RecordWithFields[], fields: FieldMeta[]): Promise<RecordWithFields[]> => {
    console.log('🔍 [useReferenceLabels] === BATCH RESOLVE START ===');
    console.log('🔍 Records to resolve:', records.length);
    console.log('🔍 Fields to check:', fields.length);
    console.log('🔍 Tenant ID:', tenantId);
    
    if (!tenantId) {
      console.error('❌ No tenant ID provided for reference field resolution');
      return records; // Return original records unchanged
    }
    
    // Create a deep copy of records to avoid mutations
    const resolvedRecords = records.map(record => ({
      ...record, // This preserves all properties including created_at, updated_at
      fields: { ...record.fields }
    }));
    
    // NEW: Auto-fix reference fields before processing
    const fixedFields = fields.map(field => {
      if (field.type === 'reference' && field.reference_table) {
        let fixedField = { ...field };
        
        // Fix reference_display_field if missing
        if (!field.reference_display_field) {
          console.log(`🔧 [useReferenceLabels] AUTO-FIXING: Setting reference_display_field to 'name' for field: ${field.name}`);
          fixedField.reference_display_field = 'name'; // Default to 'name' field
        }
        
        // Fix reference_table by removing __a suffix if it exists
        if (field.reference_table.endsWith('__a')) {
          const correctTableName = field.reference_table.replace(/__a$/, '');
          console.log(`🔧 [useReferenceLabels] AUTO-FIXING: Fixing reference_table from '${field.reference_table}' to '${correctTableName}' for field: ${field.name}`);
          fixedField.reference_table = correctTableName;
        }
        
        return fixedField;
      }
      return field;
    });
    
    console.log('🔍 [useReferenceLabels] === AUTO-FIXING COMPLETE ===');
    console.log('🔍 Original fields:', fields.length);
    console.log('🔍 Fixed fields:', fixedFields.length);
    console.log('🔍 Fixed reference fields:', fixedFields.filter(f => f.type === 'reference').map(f => ({
      name: f.name,
      reference_table: f.reference_table,
      reference_display_field: f.reference_display_field
    })));
    
    const referenceFields = fixedFields.filter(f => f.type === 'reference' && f.reference_table);
    console.log('🔍 Reference fields found:', referenceFields.length);
    console.log('🔍 Reference fields details:', referenceFields.map(f => ({
      name: f.name,
      reference_table: f.reference_table,
      reference_display_field: f.reference_display_field
    })));
    
    if (referenceFields.length === 0) {
      console.log('🔍 No reference fields to resolve');
      return resolvedRecords; // Return records unchanged
    }

    // Process each reference field
    for (const field of referenceFields) {
      console.log(`🔍 [useReferenceLabels] === PROCESSING FIELD: ${field.name} ===`);
      console.log(`🔍 Field details:`, field);
      
      // Handle missing reference_display_field
      let displayField = field.reference_display_field;
      if (!displayField) {
        console.warn(`⚠️ Field ${field.name} has no reference_display_field, trying common fallbacks`);
        // Try common display field names
        const commonDisplayFields = ['name', 'title', 'label', 'description'];
        displayField = commonDisplayFields[0]; // Default to 'name'
        console.log(`🔍 Using fallback display field: ${displayField}`);
      }
      
      // Collect all unique IDs for this reference field
      const allValues = resolvedRecords.map(r => r.fields[field.name]);
      console.log(`🔍 All values for ${field.name}:`, allValues);
      
      const ids = Array.from(new Set(
        allValues.filter(Boolean) // Remove null/undefined values
      ));
      
      console.log(`🔍 Found ${ids.length} unique IDs for ${field.name}:`, ids);
      
      if (ids.length === 0) {
        console.log(`🔍 No IDs to resolve for ${field.name}, skipping`);
        continue;
      }
      
      try {
        console.log(`🔍 [useReferenceLabels] Querying parent table: ${field.reference_table}`);
        console.log(`🔍 [useReferenceLabels] Using display field: ${displayField}`);
        console.log(`🔍 [useReferenceLabels] Querying for IDs:`, ids);
        
        // Query the parent table to get names for these IDs
        // Use tenant schema, not public schema
        const { data, error } = await supabase
          .from(field.reference_table) // This queries tenant.{table_name}
          .select(`id, ${displayField}`)
          .in('id', ids)
          .eq('tenant_id', tenantId);
        
        console.log(`🔍 [useReferenceLabels] Query result:`, { data, error });
        
        if (error) {
          console.error(`❌ Error querying ${field.reference_table}:`, error);
          console.error(`❌ Error details:`, {
            table: field.reference_table,
            displayField: displayField,
            ids: ids,
            tenantId: tenantId
          });
          continue;
        }
        
        if (!data || data.length === 0) {
          console.warn(`⚠️ No data returned from ${field.reference_table} for IDs:`, ids);
          continue;
        }
        
        console.log(`✅ Got ${data.length} records from ${field.reference_table}`);
        console.log(`✅ Raw data from parent table:`, data);
        
        // Create a map of ID to display name
        const idToNameMap = new Map();
        (data as any[]).forEach(item => {
          console.log(`🔍 Processing parent record:`, item);
          const displayValue = item[displayField!];
          console.log(`🔍 Display value for ${displayField}:`, displayValue);
          if (displayValue !== null && displayValue !== undefined) {
            idToNameMap.set(item.id, displayValue);
          }
        });
        
        console.log(`🔍 ID to name mapping:`, Object.fromEntries(idToNameMap));
        
        // Replace IDs with names in the copied records (not the original)
        let resolvedCount = 0;
        resolvedRecords.forEach((record, index) => {
          const originalValue = record.fields[field.name];
          console.log(`🔍 Record ${index} - ${field.name}:`, {
            originalValue,
            hasMapping: idToNameMap.has(originalValue),
            mappedValue: idToNameMap.get(originalValue)
          });
          
          if (originalValue && idToNameMap.has(originalValue)) {
            const resolvedName = idToNameMap.get(originalValue);
            const beforeValue = record.fields[field.name];
            record.fields[field.name] = resolvedName;
            resolvedCount++;
            console.log(`✅ Resolved ${field.name}: ${beforeValue} -> ${resolvedName}`);
          } else if (originalValue) {
            console.log(`⚠️ Could not resolve ${field.name}: ${originalValue} (no mapping found)`);
          }
        });
        
        console.log(`✅ Resolved ${resolvedCount} values for ${field.name}`);
        
      } catch (err) {
        console.error(`❌ Exception resolving ${field.name}:`, err);
        console.error(`❌ Exception details:`, {
          field: field.name,
          table: field.reference_table,
          displayField: displayField,
          ids: ids,
          tenantId: tenantId
        });
      }
    }
    
    console.log('🔍 [useReferenceLabels] === BATCH RESOLVE COMPLETE ===');
    console.log('🔍 Final resolved records state:', resolvedRecords.map(r => ({
      id: r.record_id,
      fields: Object.fromEntries(
        Object.entries(r.fields).map(([key, value]) => [
          key, 
          typeof value === 'string' && value.length === 36 ? `${value} (UUID)` : value
        ])
      )
    })));
    
    return resolvedRecords; // Return the resolved records
  };

  return { resolveReferenceFields };
}
