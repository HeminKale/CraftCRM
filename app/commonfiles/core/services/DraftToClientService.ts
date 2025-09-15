'use client';

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface DraftRecord {
  record_id: string;
  fields: {
    approved__a?: string | boolean;
    Client_name__a?: string;
    scope__a?: string;
    address__a?: string;
    [key: string]: any;
  };
}

interface CopyResult {
  success: boolean;
  message: string;
  copiedFields: string[];
  error?: any;
}

export class DraftToClientService {
  private supabase;

  constructor() {
    this.supabase = createClientComponentClient();
  }

  /**
   * Copy scope and address from draft to client when approved
   */
  async copyDraftDataToClient(
    draftRecord: DraftRecord,
    tenantId: string,
    userId?: string
  ): Promise<CopyResult> {
    try {
      console.log('🔄 DraftToClientService: Copying draft data to client...', draftRecord);
      
      // Check if draft is approved
      console.log('🔍 Checking draft approval status...');
      console.log('🔍 approved__a value:', draftRecord.fields?.approved__a);
      console.log('🔍 approved__a type:', typeof draftRecord.fields?.approved__a);
      
      const isApproved = draftRecord.fields?.approved__a === 'Yes' || 
                        draftRecord.fields?.approved__a === true ||
                        draftRecord.fields?.approved__a === 'true';
      
      console.log('🔍 Is approved result:', isApproved);
      
      if (!isApproved) {
        console.log('❌ Draft is not approved, skipping data copy');
        return {
          success: false,
          message: 'Draft is not approved',
          copiedFields: []
        };
      }

      // Get the client ID from the draft
      const clientId = draftRecord.fields?.Client_name__a;
      if (!clientId) {
        console.log('❌ No client ID found in draft record');
        return {
          success: false,
          message: 'No client ID found in draft record',
          copiedFields: []
        };
      }

      // Get the scope and address from the draft
      const scopeValue = draftRecord.fields?.scope__a;
      const addressValue = draftRecord.fields?.address__a;

      console.log('📋 Draft data to copy:', {
        clientId,
        scopeValue,
        addressValue,
        draftId: draftRecord.record_id
      });

      // Validate field names match schema
      console.log('🔍 Schema validation:');
      console.log('🔍 Draft fields available:', Object.keys(draftRecord.fields || {}));
      console.log('🔍 Client_name__a (client reference):', clientId);
      console.log('🔍 scope__a (scope field):', scopeValue);
      console.log('🔍 address__a (address field):', addressValue);

      // Check if there's anything to copy
      if (!scopeValue && !addressValue) {
        console.log('❌ No scope or address to copy');
        return {
          success: false,
          message: 'No scope or address data to copy',
          copiedFields: []
        };
      }

      // Prepare update data
      // Note: updated_at is automatically set by the RPC function
      const updateData: any = {};

      if (userId) {
        updateData.updated_by = userId;
      }

      const copiedFields: string[] = [];

      // Add scope if it exists
      if (scopeValue) {
        updateData.scope__a = scopeValue;
        copiedFields.push('scope');
      }

      // Add address if it exists
      if (addressValue) {
        updateData.address__a = addressValue;
        copiedFields.push('address');
      }

      // Set status to "draft approved" to indicate the data came from an approved draft
      updateData.status__a = 'draft approved';
      copiedFields.push('status (set to draft approved)');

      console.log('📤 Updating client with data:', updateData);

      // Update the client record with scope, address, and status using RPC
      console.log('📤 Updating client using RPC function');
      console.log('📤 Client ID:', clientId);
      console.log('📤 Tenant ID:', tenantId);
      console.log('📤 Update data:', updateData);
      console.log('📤 RPC function: update_tenant_record');
      console.log('📤 Table name: clients__a (will become tenant.clients__a)');
      
      // Use RPC function to update client - direct table access not allowed in multi-tenant setup
      console.log('📤 Using RPC function to update client...');
      
      let updateResult, error;
      try {
        // Try the generic update_tenant_record RPC function
        console.log('📤 Calling update_tenant_record RPC...');
        const result = await this.supabase
          .rpc('update_tenant_record', {
            p_table_name: 'clients__a',
            p_record_id: clientId,
            p_tenant_id: tenantId,
            p_update_data: {
              scope__a: scopeValue,
              address__a: addressValue,
              status__a: 'draft approved',
              updated_by: userId
            }
          });
        
        updateResult = result.data;
        error = result.error;
        
      } catch (rpcError) {
        console.error('📤 RPC update failed:', rpcError);
        error = rpcError;
      }

      console.log('📤 RPC update result:', updateResult);
      console.log('📤 RPC update error:', error);

      if (error) {
        console.error('❌ Error updating client data:', error);
        console.error('❌ Error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        return {
          success: false,
          message: `Error updating client data: ${error.message || 'Unknown error'}`,
          copiedFields: [],
          error
        };
      }

      // The update_tenant_record function returns VOID, so no data is returned
      // If we reach here without error, the update was successful
      console.log('✅ Client update completed successfully (no error returned)!');
      console.log('✅ Updated fields:', ['scope__a', 'address__a', 'status__a', 'updated_by']);
      console.log('✅ Client ID:', clientId);

      // Let's verify by fetching the updated client record
      console.log('🔍 Verifying client record was actually updated...');
      try {
        const { data: verifyData, error: verifyError } = await this.supabase
          .rpc('get_object_records_with_references', {
            p_object_id: '848fab47-b9de-436f-830d-8f9a55de413e', // Clients object UUID from logs
            p_tenant_id: tenantId,
            p_limit: 1000,
            p_offset: 0
          });

        if (verifyError) {
          console.error('❌ Error verifying client update:', verifyError);
        } else if (verifyData && verifyData.records) {
          const updatedClient = verifyData.records.find((r: any) => r.record_id === clientId);
          if (updatedClient) {
            console.log('🔍 Updated client record:', updatedClient.record_data);
            console.log('🔍 Client scope__a:', updatedClient.record_data.scope__a);
            console.log('🔍 Client address__a:', updatedClient.record_data.address__a);
            console.log('🔍 Client status__a:', updatedClient.record_data.status__a);
          } else {
            console.warn('⚠️ Could not find updated client record in verification');
          }
        }
      } catch (verifyErr) {
        console.error('❌ Verification error:', verifyErr);
      }

      console.log('✅ Successfully copied draft data to client');
      
      const message = `Successfully copied ${copiedFields.join(' and ')} from draft to client!`;
      
      return {
        success: true,
        message,
        copiedFields
      };
      
    } catch (error) {
      console.error('❌ Error in copyDraftDataToClient:', error);
      return {
        success: false,
        message: 'Error copying draft data to client',
        copiedFields: [],
        error
      };
    }
  }

  /**
   * Handle draft approval and automatic copying
   */
  async handleDraftApproval(
    draftRecordId: string,
    tenantId: string,
    userId?: string,
    objectId?: string
  ): Promise<CopyResult> {
    try {
      console.log('🎯 DraftToClientService: Handling draft approval for:', draftRecordId);
      
      // Get the full draft record using RPC function
      console.log('🔍 Fetching draft record using RPC...');
      console.log('🔍 Using objectId:', objectId);
      
      const { data: recordsData, error: fetchError } = await this.supabase
        .rpc('get_object_records_with_references', {
          p_object_id: objectId || 'drafts', // Use the actual object UUID if provided
          p_tenant_id: tenantId,
          p_limit: 1000,
          p_offset: 0
        });

      if (fetchError) {
        console.error('❌ Error fetching draft records via RPC:', fetchError);
        return {
          success: false,
          message: 'Error fetching draft record',
          copiedFields: [],
          error: fetchError
        };
      }

      // Find the specific record
      const fullRecord = recordsData?.find((record: any) => record.record_id === draftRecordId);
      
      if (!fullRecord) {
        console.error('❌ Draft record not found in RPC results');
        return {
          success: false,
          message: 'Draft record not found',
          copiedFields: []
        };
      }

      console.log('✅ Found draft record via RPC:', fullRecord);

      // Copy data from draft to client
      // The RPC returns records in a different format, so we need to adapt it
      return await this.copyDraftDataToClient({
        record_id: draftRecordId,
        fields: fullRecord.record_data || fullRecord.fields || fullRecord
      }, tenantId, userId);
      
    } catch (error) {
      console.error('❌ Error in handleDraftApproval:', error);
      return {
        success: false,
        message: 'Error handling draft approval',
        copiedFields: [],
        error
      };
    }
  }

  /**
   * Check if a record update should trigger draft approval
   */
  async shouldTriggerDraftApproval(objectId: string, updatedFields: any, tenantId: string): Promise<boolean> {
    console.log('🔍 DraftToClientService: Checking if should trigger draft approval...');
    console.log('🔍 ObjectId:', objectId);
    console.log('🔍 UpdatedFields:', updatedFields);
    console.log('🔍 approved__a value:', updatedFields.approved__a);
    console.log('🔍 approved__a type:', typeof updatedFields.approved__a);
    
    try {
      // Get the object details to check its name
      const { data: objectData, error: objectError } = await this.supabase
        .rpc('get_tenant_objects', { p_tenant_id: tenantId });

      if (objectError) {
        console.error('❌ Error fetching tenant objects:', objectError);
        return false;
      }

      // Find the object by ID and check its name
      const currentObject = objectData?.find((obj: any) => obj.id === objectId);
      const objectName = currentObject?.name || currentObject?.object_name;
      
      console.log('🔍 Current object:', currentObject);
      console.log('🔍 Object name:', objectName);
      
      const isDraftsObject = objectName === 'drafts__a' || objectName === 'drafts';
      const isApproved = updatedFields.approved__a === 'Yes' || 
                        updatedFields.approved__a === true ||
                        updatedFields.approved__a === 'true';
      
      console.log('🔍 Is drafts object:', isDraftsObject);
      console.log('🔍 Is approved:', isApproved);
      console.log('🔍 Should trigger:', isDraftsObject && isApproved);
      
      return isDraftsObject && isApproved;
    } catch (error) {
      console.error('❌ Error in shouldTriggerDraftApproval:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const draftToClientService = new DraftToClientService();
