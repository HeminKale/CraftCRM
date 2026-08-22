'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import { usePermissions } from '../../providers/PermissionsProvider';
import { UniversalFieldDisplay, formatColumnLabel } from '../ui/UniversalFieldDisplay';
import CustomTabRenderer from './CustomTabRenderer';
import { draftToClientService } from '../../services/DraftToClientService';
import FileUploadField, { type UploadedFileInfo } from './FileUploadField';
import ClientWorkflowBar from '../custom/External_Client/ClientWorkflowBar';
import ReviewActionPanel from '../custom/External_Client/ReviewActionPanel';
import StageAuditActionPanel from '../custom/External_Client/StageAuditActionPanel';
import RenewalWorkflowBar from '../custom/Renewal_Client/RenewalWorkflowBar';
import RenewalActionPanel from '../custom/Renewal_Client/RenewalActionPanel';
import RecertificationWorkflowBar from '../custom/Recertification_Client/RecertificationWorkflowBar';
import RecertificationActionPanel from '../custom/Recertification_Client/RecertificationActionPanel';
import toast from 'react-hot-toast';
import { useUserMap, resolveUserValue } from '../../hooks/useUserMap';

interface RecordDetailViewProps {
  recordId: string;
  objectId: string;
  recordName: string;
  objectLabel: string;
  onBackToList: () => void;
}

interface LayoutBlock {
  id: string;
  object_id: string;
  block_type: 'field' | 'related_list' | 'button';
  field_id?: string;
  related_list_id?: string;
  label: string;
  section: string;
  display_order: number;
  width?: 'half' | 'full';
  is_visible: boolean;
  created_at?: string;
  updated_at?: string;
  tab_type?: 'main' | 'related_list';
  display_columns?: string[];
  button_id?: string;
}

interface FieldMetadata {
  id: string;
  object_id: string;
  name: string;
  label: string;
  type: string;
  is_required: boolean;
  is_nullable: boolean;
  default_value: string | null;
  validation_rules: any[];
  display_order: number;
  section: string;
  width: 'half' | 'full';
  is_visible: boolean;
  is_system_field: boolean;
  reference_table: string | null;
  reference_display_field: string | null;
  lookup_role_pattern: string | null;
}

interface RecordData {
  [key: string]: any;
}

interface RelatedListData {
  record_id: string;
  record_data: RecordData;
  created_at: string;
  updated_at: string;
}

interface ChildObject {
  object_id: string;
  object_name: string;
  object_label: string;
  relationship_type: string;
  is_active: boolean;
  display_order: number;
}

type TabType = 'information' | string; // 'information' or child object ID

// Helper function to check if a field is a system field
const isSystemField = (fieldName: string): boolean => {
  const systemFields = ['created_at', 'updated_at', 'created_by', 'updated_by', 'record_owner__a'];
  return systemFields.includes(fieldName);
};

// Stage 1/2 Audit Report fields (external_clients__a.stage1_report /
// stage2_report) stay hidden from the linked client until the Tech Reviewer
// has submitted findings for that stage. Previously this was an enumerated
// "locked while status is one of these" allowlist — found (2026-08-02) to
// fail OPEN for any status not in the list (e.g. a manually-set test status
// like 'Client_Registered'), which is the wrong default for a security gate.
// Rewritten as a canonical status order + "unlocked once rank >= threshold"
// check, so an unrecognized/never-seen status__a defaults to LOCKED instead.
const STAGE_STATUS_ORDER: string[] = [
  'Client_Registered',
  'Application_Sent', 'Application_Accepted', 'Quotation_Received', 'Client_Agreement_Signed',
  'Team_Assigned', 'Stage_one_plan_Sent', 'Stage1_Plan_Accepted', 'Stage1_Report_Sent',
  'Stage1_NCR_RCA_Uploaded', 'Stage1_Auditor_Accepted', 'Stage1_Tech_Findings_Given',
  'Stage1_Closed', 'Stage1_Complete',
  'Stage2_Plan_Sent', 'Stage2_Plan_Accepted', 'Stage2_Report_Sent',
  'Stage2_NCR_RCA_Uploaded', 'Stage2_Auditor_Accepted',
  'Stage2_Evidences_Uploaded', 'Stage2_Evidences_Accepted', 'Stage2_Tech_Findings_Given',
  'Stage2_Closed', 'Stage2_Complete', 'CDC_Approved',
];

// Surveillance 1 (renewal_clients__a) — Sprint 4 audit fix (SURV1 rights
// matrix row 9: "surv audit report — view only after tech review
// acceptance"). Kept as its OWN array rather than appended to
// STAGE_STATUS_ORDER above: 'Team_Assigned' and 'CDC_Approved' are real
// status__a values on BOTH objects (External Client's own picklist already
// contains both), so a shared array would have silently ranked Surveillance
// 1's 'Team_Assigned' at External Client's position for that name instead
// of its own — accidentally harmless for this one threshold check today,
// but a landmine for the next one. Two independent arrays, keyed by their
// own object's field, avoids the collision entirely.
const SURV_STATUS_ORDER: string[] = [
  'Intimation_Sent', 'Intimation_Accepted', 'Team_Assigned',
  'Surv_Plan_Sent', 'Surv_Plan_Accepted', 'Surv_NCR_Sent', 'Surv_NCR_RCA_Uploaded',
  'Surv_Auditor_Accepted', 'Surv_Report_Sent', 'Surv_Tech_Findings_Given',
  'Surv_Closed', 'CDC_Approved', 'Certificate_Issued',
];

// Recertification (recertification_clients__a) — Sprint 5, same lock
// mechanism as Surveillance 1's SURV_STATUS_ORDER above, applied to
// recert_audit_report per the sprint plan's explicit "build the client-
// visibility lock in from the start" note (Surveillance 1 missed this on
// its first pass and needed a follow-up audit to catch it — not repeating
// that gap here). Kept as its OWN array for the same reason SURV_STATUS_ORDER
// is its own array, not appended to it or STAGE_STATUS_ORDER: 'Team_Assigned'
// is a real status__a value on ALL THREE objects now, so a shared array
// would silently rank Recertification's 'Team_Assigned' at whichever other
// object's position for that name happened to be defined first — harmless
// today, a landmine the next time this threshold check is touched.
const RECERT_STATUS_ORDER: string[] = [
  'Recert_Intimation_Sent', 'Recert_Application_Sent', 'Recert_Application_Accepted',
  'Recert_Quotation_Received', 'Recert_Agreement_Sent', 'Recert_Agreement_Signed',
  'Recert_Team_Assigned', 'Recert_Plan_Sent', 'Recert_Plan_Accepted',
  'Recert_NCR_Sent', 'Recert_NCR_RCA_Uploaded', 'Recert_Auditor_Accepted',
  'Recert_Evidences_Uploaded', 'Recert_Evidences_Accepted',
  'Recert_Report_Sent', 'Recert_Tech_Findings_Given', 'Recert_Closed',
  'Recert_CDC_Approved', 'Recert_Certificate_Issued',
];

const STAGE_REPORT_UNLOCK_AT: Record<string, { order: string[]; unlockAt: string }> = {
  stage1_report:             { order: STAGE_STATUS_ORDER, unlockAt: 'Stage1_Tech_Findings_Given' },
  stage2_report:             { order: STAGE_STATUS_ORDER, unlockAt: 'Stage2_Tech_Findings_Given' },
  surveillance_audit_report: { order: SURV_STATUS_ORDER,  unlockAt: 'Surv_Tech_Findings_Given' },
  recert_audit_report:       { order: RECERT_STATUS_ORDER, unlockAt: 'Recert_Tech_Findings_Given' },
};

const isStageReportLockedForClient = (fieldName: string, recordData: RecordData | null, currentUserId?: string): boolean => {
  const rule = STAGE_REPORT_UNLOCK_AT[fieldName];
  if (!rule) return false;
  if (!currentUserId || recordData?.['client_user_id__a'] !== currentUserId) return false;
  const status = recordData?.['status__a'];
  const currentRank = status ? rule.order.indexOf(status) : -1;
  const unlockRank = rule.order.indexOf(rule.unlockAt);
  return currentRank < unlockRank; // unknown/unranked status defaults to locked
};

// Hard floor on who may upload/replace these specific stage-workflow file
// fields, independent of Permission Set configuration. Needed because
// start_file_upload has no role check at all for most of these fields (only
// quotation / clientAgreement__c / stage_one_audit_plan's assignment-
// existence check are hard-blocked server-side — see 232/239/244) — so an
// unrestricted (default) Permission Set entry otherwise lets any role upload
// straight through the generic Page Layout form, bypassing the rights
// matrix's upload-role column entirely. A Permission Set `can_edit=false`
// can still narrow this further; it just can never widen past it.
type FileUploadRule = 'crm_or_auditor' | 'client_only' | 'crm_only' | 'tech_only' | 'cdc_only';

// External Client (external_clients__a) — untouched since it was first added.
// Kept as its own map, not shared with Surveillance 1 below: 'cdc_report' is
// a field name used by BOTH objects, and a single shared map briefly (Sprint
// 4) applied Surveillance 1's stricter cdc_report rule to External Client's
// too as an unintended side effect. Split back out per explicit instruction
// not to touch the External Client flow — this map's contents are exactly
// what they were before Sprint 4 ever ran.
const EXTERNAL_CLIENT_FILE_FIELD_UPLOAD_ROLE: Record<string, FileUploadRule> = {
  stage_one_audit_plan: 'crm_or_auditor',
  Stage_two_audit_plan: 'crm_or_auditor',
  stage1_report:        'crm_or_auditor',
  stage1_ncr:           'crm_or_auditor',
  stage2_report:        'crm_or_auditor',
  stage2_ncr:           'crm_or_auditor',
  stage1_ncr_rca:       'client_only',
  stage2_ncr_rca:       'client_only',
  stage2_evidences:     'client_only',
};

// Surveillance 1 (renewal_clients__a) — Sprint 4. Server-side twin lives in
// supabase/migrations/261_surv_start_upload_role_gates.sql; this is the
// matching frontend hard floor (PS `can_edit` alone can't stop a direct RPC
// call — see that migration's header for the full reasoning). Entirely
// separate map from External Client's above — selected by object identity
// at the call site, never merged.
const RENEWAL_FILE_FIELD_UPLOAD_ROLE: Record<string, FileUploadRule> = {
  surveillance_intimation_letter: 'crm_only',
  surveillance_certificates:      'crm_only',
  surv_audit_plan:                'crm_or_auditor',
  surv_ncr:                       'crm_or_auditor',
  surveillance_audit_report:      'crm_or_auditor',
  surv_ncr_rca:                   'client_only',
  surv_tech_findings_file:        'tech_only',
  cdc_report:                     'cdc_only',
  // Sprint 8 — Suspension & Withdrawal. Server-side twin lives in
  // supabase/migrations/278_surv_suspension_withdrawal_start_upload.sql.
  surv_suspension_intimation:     'crm_only',
  surv_suspension_decision:       'cdc_only',
  surv_suspension_letter:         'crm_only',
  surv_withdrawal_intimation:     'crm_only',
  surv_withdrawal_decision:       'cdc_only',
  surv_withdrawal_letter:         'crm_only',
};

// Sprint 8 — the CRM-uploaded fields whose upload triggers an email to the
// linked client (the two CDC-uploaded decision fields never trigger an
// email, confirmed — only rows with "get email" in the Client column of the
// rights matrix send mail). Field name → the notifications/send template
// name (see app/api/notifications/send/route.ts).
//
// surveillance_intimation_letter added after the fact (bug found in
// production use): the letter's email previously only fired from
// NewRenewalForm.tsx's one-time record-creation flow — if CRM created the
// record without attaching the letter (it's optional there) and uploaded
// it later from the record page, no email ever went out, even after an
// email__a was added to the record. Reuses the same 'surveillance_intimation'
// template the creation-flow path already uses, so both paths send an
// identical email.
const RENEWAL_EMAIL_ON_UPLOAD_FIELDS: Record<string, string> = {
  surveillance_intimation_letter: 'surveillance_intimation',
  surv_suspension_intimation:     'surveillance_suspension_intimation',
  surv_suspension_letter:         'surveillance_suspension_letter',
  surv_withdrawal_intimation:     'surveillance_withdrawal_intimation',
  surv_withdrawal_letter:         'surveillance_withdrawal_letter',
};

// Recertification (recertification_clients__a) — Sprint 5. Server-side twin
// lives across migrations 264/265/266/267/268's start_file_upload blocks;
// this is the matching frontend hard floor, same reasoning as
// RENEWAL_FILE_FIELD_UPLOAD_ROLE's header above. A THIRD, entirely
// independent map — never merged with either map above, selected by object
// identity at the call site only. Four more entries than Surveillance 1's
// map (application form, quotation, agreement, evidences) — the intake and
// evidences checkpoints Surveillance 1 doesn't have.
const RECERT_FILE_FIELD_UPLOAD_ROLE: Record<string, FileUploadRule> = {
  recert_intimation_letter: 'crm_only',
  recert_application_form:  'client_only',
  recert_quotation:         'crm_only',
  recert_agreement:         'crm_only',
  recert_audit_plan:        'crm_or_auditor',
  recert_ncr:               'crm_or_auditor',
  recert_ncr_rca:           'client_only',
  recert_evidences:         'client_only',
  recert_audit_report:      'crm_or_auditor',
  recert_tech_findings_file:'tech_only',
  recert_cdc_report:        'cdc_only',
  recert_certificates:      'crm_only',
};

// Recertification Sprint 9 — mirrors RENEWAL_EMAIL_ON_UPLOAD_FIELDS above,
// same bug class: previously there was NO map at all for Recertification,
// so a separately-uploaded recert_intimation_letter (not attached at
// creation time in NewRecertificationForm.tsx) never sent an email, ever —
// worse than Surveillance 1's version of this bug, which at least covered
// the Sprint 8 fields. Reuses the 'recertification_intimation' template
// NewRecertificationForm.tsx's one-time creation-flow email already uses,
// so both paths send an identical email.
const RECERT_EMAIL_ON_UPLOAD_FIELDS: Record<string, string> = {
  recert_intimation_letter: 'recertification_intimation',
};

const isFileUploadAllowedForRole = (
  fieldName: string,
  recordData: RecordData | null,
  currentUserId: string | undefined,
  userRole: string | undefined,
  customRoleName: string | null,
  isRenewalObject: boolean,
  isRecertObject: boolean = false,
): boolean => {
  const rule = (
    isRecertObject ? RECERT_FILE_FIELD_UPLOAD_ROLE :
    isRenewalObject ? RENEWAL_FILE_FIELD_UPLOAD_ROLE :
    EXTERNAL_CLIENT_FILE_FIELD_UPLOAD_ROLE
  )[fieldName];
  if (!rule) return true; // not one of the hard-floored fields — Permission Set decides alone

  if (userRole === 'admin') return true;

  if (rule === 'client_only') {
    return !!currentUserId && recordData?.['client_user_id__a'] === currentUserId;
  }

  const role = (customRoleName || '').toLowerCase();
  if (rule === 'crm_only')  return role.includes('crm');
  if (rule === 'tech_only') return role.includes('tech');
  if (rule === 'cdc_only')  return role.includes('cdc');
  return role.includes('crm') || role.includes('auditor'); // 'crm_or_auditor'
};

// Helper function to normalize field names by removing __a suffix
const normalizeFieldName = (fieldName: string): string => {
  // Remove __a suffix if present (e.g., hero__a -> hero)
  return fieldName.replace(/__a$/, '');
};

// Helper function to map display field names to database API names
const mapDisplayNameToApiName = (displayName: string, fieldMetadata: FieldMetadata[]): string => {
  // First try to find exact match by database column name (this is most common)
  const fieldByName = fieldMetadata.find(f => f.name === displayName);
  if (fieldByName) {
    return fieldByName.name; // This is already the corrected database column name
  }
  
  // Try to find by label (display name)
  const fieldByLabel = fieldMetadata.find(f => f.label === displayName);
  if (fieldByLabel) {
    return fieldByLabel.name; // This is the corrected database column name
  }
  
  // Try to find by normalized name (remove __a suffix) - for cases where display name doesn't have suffix
  const normalizedDisplayName = normalizeFieldName(displayName);
  const fieldByNormalizedName = fieldMetadata.find(f => normalizeFieldName(f.name) === normalizedDisplayName);
  if (fieldByNormalizedName) {
    return fieldByNormalizedName.name;
  }
  
  // If no match found, return the original display name
  // This handles system fields that don't have __a suffix
  console.warn(`⚠️ No field metadata found for display name: ${displayName}`);
  return displayName;
};

// Helper function to find field value using normalized field names
const findFieldValue = (recordData: RecordData, fieldName: string): any => {
  // First try exact match
  if (recordData[fieldName] !== undefined) {
    return recordData[fieldName];
  }
  
  // Then try with __a suffix
  const fieldNameWithSuffix = `${fieldName}__a`;
  if (recordData[fieldNameWithSuffix] !== undefined) {
    return recordData[fieldNameWithSuffix];
  }
  
  // Finally try normalized version
  const normalizedName = normalizeFieldName(fieldName);
  if (normalizedName !== fieldName && recordData[normalizedName] !== undefined) {
    return recordData[normalizedName];
  }

  // Try stripping a trailing __a suffix. get_object_records_with_references
  // stores a resolved reference field's display value under the BARE field
  // name (no __a) — fieldMetadata's `name` always has __a appended (see
  // correctedFieldData in fetchRecordDetail), so without this a reference
  // field's resolved value fell through to undefined and the raw ID never
  // got replaced by a label (migration 286 fix for external_client_id
  // surfaced this — same root cause as getSmartFieldValue below).
  if (fieldName.endsWith('__a')) {
    const bareName = fieldName.slice(0, -3);
    if (recordData[bareName] !== undefined) {
      return recordData[bareName];
    }
  }

  return undefined;
};

// Enhanced smart field value lookup that tries multiple field name variations
const getSmartFieldValue = (recordData: RecordData, fieldName: string): any => {
  // First try exact match
  if (recordData[fieldName] !== undefined) {
    return recordData[fieldName];
  }
  
  // Try with __a suffix
  const fieldNameWithSuffix = `${fieldName}__a`;
  if (recordData[fieldNameWithSuffix] !== undefined) {
    return recordData[fieldNameWithSuffix];
  }
  
  // Try with _a suffix
  const fieldNameWithSingleA = `${fieldName}_a`;
  if (recordData[fieldNameWithSingleA] !== undefined) {
    return recordData[fieldNameWithSingleA];
  }
  
  // Try snake_case version
  const snakeCaseName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (recordData[snakeCaseName] !== undefined) {
    return recordData[snakeCaseName];
  }
  
  // Try snake_case with __a suffix
  const snakeCaseWithSuffix = `${snakeCaseName}__a`;
  if (recordData[snakeCaseWithSuffix] !== undefined) {
    return recordData[snakeCaseWithSuffix];
  }
  
  // Try snake_case with _a suffix
  const snakeCaseWithSingleA = `${snakeCaseName}_a`;
  if (recordData[snakeCaseWithSingleA] !== undefined) {
    return recordData[snakeCaseWithSingleA];
  }

  // Try stripping a trailing __a suffix. get_object_records_with_references
  // stores a resolved reference field's display value under the BARE field
  // name (no __a) — only non-reference columns keep the __a-suffixed key —
  // but fieldMetadata's `name` always has __a appended (see the
  // correctedFieldData mapping in fetchRecordDetail), so a reference field's
  // resolved value was falling through to undefined without this check
  // (migration 286 fix for external_client_id surfaced this).
  if (fieldName.endsWith('__a')) {
    const bareName = fieldName.slice(0, -3);
    if (recordData[bareName] !== undefined) {
      return recordData[bareName];
    }
  }

  // If nothing found, return undefined
  return undefined;
};

export default function RecordDetailView({ 
  recordId, 
  objectId, 
  recordName, 
  objectLabel,
  onBackToList 
}: RecordDetailViewProps) {
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layoutBlocks, setLayoutBlocks] = useState<LayoutBlock[]>([]);
  const [fieldMetadata, setFieldMetadata] = useState<FieldMetadata[]>([]);
  const [recordData, setRecordData] = useState<RecordData | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('information');
  const [childObjects, setChildObjects] = useState<ChildObject[]>([]);
  const [relatedListData, setRelatedListData] = useState<{[key: string]: RelatedListData[]}>({});
  const [isEditing, setIsEditing] = useState(false);
  const [editingValues, setEditingValues] = useState<RecordData>({});
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // The object's real technical name (e.g. 'renewal_clients__a'), fetched in
  // fetchRecordDetail via get_tenant_objects. NOT the same as the
  // `objectLabel` prop — that's actually the clicked NAV TAB's display
  // label (see TabContent.tsx's `objectLabel: tabLabel`), which for
  // Surveillance 1 is literally "Surveillance 1", not "Renewal Clients" —
  // every `objectLabel?.toLowerCase().includes('renewal')` check in this
  // file was silently false for every user, always, meaning
  // RenewalWorkflowBar/RenewalActionPanel never rendered at all (found live
  // via Playwright, Surveillance 1 Sprint 9 follow-up). Use this instead
  // for any "which object is this" check.
  const [objectTechName, setObjectTechName] = useState<string>('');
  
  // Custom component state for modal display
  const [activeCustomComponent, setActiveCustomComponent] = useState<{
    componentPath: string;
    buttonDetail: any;
  } | null>(null);
  
  // NEW: Add picklist and reference options for edit mode (same as create modal)
  const [picklistOptions, setPicklistOptions] = useState<{ [key: string]: any[] }>({});
  const [referenceOptions, setReferenceOptions] = useState<{ [key: string]: any[] }>({});
  const [referenceLoading, setReferenceLoading] = useState<{ [key: string]: boolean }>({});
  const { tenant, user, userProfile } = useSupabase();
  const { can } = usePermissions();
  const supabase = createClientComponentClient();
  const userMap = useUserMap();

  // NEW: Load picklist field options for edit mode
  useEffect(() => {
    const loadPicklistOptions = async () => {
      const picklistFields = fieldMetadata.filter(f => f.type === 'picklist');
      
      for (const field of picklistFields) {
        try {
          // Fetch picklist values from database
          const { data, error } = await supabase
            .rpc('get_picklist_values', {
              p_field_id: field.id
            });

          if (error) {
            console.warn(`Warning loading picklist options for edit ${field.name}:`, error);
          } else if (data) {
            setPicklistOptions(prev => ({
              ...prev,
              [field.name]: data
            }));
          }
        } catch (err) {
          console.warn(`Error loading picklist options for edit ${field.name}:`, err);
        }
      }
    };

    if (fieldMetadata.length > 0) {
      loadPicklistOptions();
    }
  }, [fieldMetadata]);

  // NEW: Load reference field options for edit mode (also covers 'user_lookup'
  // fields like auditor_id/tech_reviewer_id — same referenceOptions state,
  // just sourced from get_tenant_users_by_role_pattern instead of
  // get_reference_options, filtered to the field's lookup_role_pattern so the
  // picklist can only ever offer users who actually hold the matching role)
  useEffect(() => {
    const loadReferenceOptions = async () => {
      const referenceFields = fieldMetadata.filter(f =>
        (f.type === 'reference' && f.reference_table) ||
        (f.type === 'user_lookup' && f.lookup_role_pattern)
      );

      if (referenceFields.length === 0) {
        return;
      }

      for (const field of referenceFields) {
        // Set loading state for this field
        setReferenceLoading(prev => ({ ...prev, [field.name]: true }));

        try {
          const { data, error } = field.type === 'user_lookup'
            ? await supabase.rpc('get_tenant_users_by_role_pattern', {
                p_role_pattern: field.lookup_role_pattern!
              })
            // Use the same RPC function as create modal
            : await supabase.rpc('get_reference_options', {
                p_table_name: field.reference_table!,
                p_tenant_id: tenant?.id || '',
                p_limit: 100
              });

          if (error) {
            console.error(`❌ Error loading reference options for edit ${field.name}:`, error);
            console.error(`❌ Error details:`, error);
          } else if (data) {
            if (Array.isArray(data) && data.length > 0) {
              setReferenceOptions(prev => ({
                ...prev,
                [field.name]: data
              }));
            } else {
              console.warn(`⚠️ No reference options returned for edit ${field.name}`);
              console.warn(`⚠️ This usually means the RPC function returned null or undefined`);
            }
          }
        } catch (err) {
          console.error(`💥 Exception loading reference options for edit ${field.name}:`, err);
          console.error(`💥 Exception type:`, typeof err);
          console.error(`💥 Exception message:`, err instanceof Error ? err.message : String(err));
        } finally {
          // Clear loading state for this field
          setReferenceLoading(prev => ({ ...prev, [field.name]: false }));
        }
      }
    };

    if (fieldMetadata.length > 0 && tenant?.id) {
      loadReferenceOptions();
    }
  }, [fieldMetadata, tenant?.id]);

  // NEW: Create tabs for child objects based on related lists
  const childObjectTabs = useMemo(() => {
    if (!childObjects || childObjects.length === 0) {
      return [];
    }
    
    const tabs = childObjects.map(childObj => {
      return {
        id: childObj.object_id,
        label: childObj.object_label, // Use display label, not name
        type: 'child_object',
        objectId: childObj.object_id
      };
    });
    
    return tabs;
  }, [childObjects]);

  // NEW: Map child objects to their related list blocks using proper database relationship
  const childObjectToRelatedListMap = useMemo(() => {
    if (!childObjects || !layoutBlocks) return new Map();
    
    const mapping = new Map();
    
    // Find related list blocks that correspond to child objects
    let relatedListBlockCount = 0;
    layoutBlocks.forEach((block, index) => {
      if (block.block_type === 'related_list') {
        relatedListBlockCount++;
        
        // The related_list_id in the block references related_list_metadata.id
        // We need to find which child object this related list represents
        // The relationship is: Layout Block -> Related List Metadata -> Child Object
        
        // For now, let's try to find the child object by looking at the block label
        // This is a temporary fix until we can properly query the related_list_metadata table
        const childObject = childObjects.find(child => {
          // Try to match by object label (case-insensitive)
          return child.object_label.toLowerCase() === block.label.toLowerCase();
        });
        
        if (childObject) {
          // Map the child object ID to the related list block
          mapping.set(childObject.object_id, block);
        } else {
          // Alternative: try to match by object name
          const childObjectByName = childObjects.find(child => {
            return child.object_name.toLowerCase() === block.label.toLowerCase();
          });
          
          if (childObjectByName) {
            mapping.set(childObjectByName.object_id, block);
          }
        }
      }
    });
    
    return mapping;
  }, [childObjects, layoutBlocks]);

  // Combine information tab with child object tabs
  const allTabs = useMemo(() => {
    const tabs = [
      { id: 'information', label: 'Information', type: 'information' }
    ];
    
    // Add child object tabs
    childObjectTabs.forEach(childTab => {
      tabs.push(childTab);
    });
    
    return tabs;
  }, [childObjectTabs]);

  // Set default active tab to information
  useEffect(() => {
    if (allTabs.length > 0 && !activeTab) {
      setActiveTab('information');
    }
  }, [allTabs, activeTab]);

  // Load button details for custom components
  const [buttonDetails, setButtonDetails] = useState<{[key: string]: any}>({});
  const [customRoleName, setCustomRoleName] = useState<string | null>(null);
  

  
  const loadButtonDetails = async () => {
    if (!tenant?.id || !objectId) return;

    try {
      const { data, error } = await supabase.rpc('get_object_buttons', {
        p_object_id: objectId,
        p_tenant_id: tenant.id,
      });

      if (!error && data) {
        const detailsMap: {[key: string]: any} = {};
        data.forEach((button: any) => {
          detailsMap[button.id] = button;
        });
        setButtonDetails(detailsMap);
      }
    } catch (error) {
      console.error('Error loading button details:', error);
    }
  };

  useEffect(() => {
    if (layoutBlocks.length > 0 && tenant?.id) {
      loadButtonDetails();
    }
  }, [layoutBlocks, tenant?.id]);

  // Load custom role name for the current user
  useEffect(() => {
    const loadCustomRole = async () => {
      if (!user?.id) return;
      try {
        const { data } = await supabase
          .rpc('get_tenant_users', { p_tenant_id: tenant?.id });
        const me = data?.find((u: any) => u.id === user.id);
        setCustomRoleName(me?.custom_role_name || null);
      } catch { /* non-critical */ }
    };
    if (tenant?.id && user?.id) loadCustomRole();
  }, [tenant?.id, user?.id]);





  // Fetch layout configuration and record data
  useEffect(() => {
    const fetchRecordDetail = async () => {
      if (!objectId || !recordId || !tenant?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // 0. Resolve the object's real technical name (e.g.
        // 'renewal_clients__a') — NOT derivable from the `objectLabel` prop,
        // which is actually the clicked nav tab's display label (see
        // objectTechName's own comment at its declaration). Every object-
        // identity check in this file should use this, not objectLabel.
        try {
          const { data: objectsData, error: objectsError } = await supabase
            .rpc('get_tenant_objects', { p_tenant_id: tenant.id });
          if (!objectsError) {
            const thisObject = objectsData?.find((obj: any) => obj.id === objectId);
            setObjectTechName(thisObject?.name || '');
          }
        } catch (objErr) {
          console.error('⚠️ Error resolving object technical name:', objErr);
        }

        // 1. Fetch layout blocks for the object
        const { data: layoutData, error: layoutError } = await supabase
          .rpc('get_layout_blocks', {
            p_object_id: objectId,
            p_tenant_id: tenant.id
          });

        if (layoutError) {
          console.error('❌ Error fetching layout blocks:', layoutError);
          throw new Error(`Failed to fetch layout blocks: ${layoutError.message}`);
        }
        
        // Check related list blocks specifically
        const relatedListBlocks = layoutData?.filter(block => block.block_type === 'related_list') || [];
        
        setLayoutBlocks(layoutData || []);

        // 2. Fetch field metadata for the object using bridge function
        const { data: fieldData, error: fieldError } = await supabase
          .rpc('get_tenant_fields', {
            p_object_id: objectId,
            p_tenant_id: tenant.id
          });

        if (fieldError) {
          console.error('❌ Error fetching field metadata:', fieldError);
          throw new Error(`Failed to fetch field metadata: ${fieldError.message}`);
        }

        // Add __a suffix to custom field names to get API names
        const correctedFieldData = (fieldData || []).map(field => {
          const systemFields = ['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'name', 'is_active', 'autonumber'];
          const isSystemField = systemFields.includes(field.name);
          
          if (!isSystemField && !field.name.endsWith('__a')) {
            return { ...field, name: field.name + '__a' };
          }
          
          return field;
        });
        
        setFieldMetadata(correctedFieldData);

        // 3. Fetch record data using bridge function
        const { data: recordsData, error: recordError } = await supabase
          .rpc('get_object_records_with_references', {
            p_object_id: objectId,
            p_tenant_id: tenant.id,
            p_limit: 100,
            p_offset: 0
          });

        if (recordError) {
          console.error('❌ Error fetching record data:', recordError);
          throw new Error(`Failed to fetch record data: ${recordError.message}`);
        }

        const targetRecord = recordsData?.find(r => r.record_id === recordId);
        if (!targetRecord) {
          throw new Error(`Record not found: ${recordId}`);
        }

        const extractedRecordData = targetRecord.record_data;
        setRecordData(extractedRecordData);
        setEditingValues(extractedRecordData); // Initialize editing values

        // 4. Extract unique sections from layout blocks
        const allSections = Array.from(
          new Set(layoutData?.map((block: LayoutBlock) => block.section) || [])
        );
        
        const uniqueSections = allSections
        .filter(section => section !== 'related_lists') // NEW: Filter out related_lists section
        .sort((a, b) => {
          // Prioritize "details" section at the top
          if (a === 'details') return -1;
          if (b === 'details') return 1;
          return String(a).localeCompare(String(b));
        }) as string[];
        
        setSections(uniqueSections);

        // 5. Fetch child objects for tabs
        const { data: childObjectData, error: childObjectError } = await supabase
          .rpc('get_child_objects_for_tabs', {
            p_parent_object_id: objectId,  // Correct parameter!
            p_tenant_id: tenant.id
          });

        if (childObjectError) {
          console.error('⚠️ Warning fetching child objects:', childObjectError);
          setChildObjects([]);
        } else {
          setChildObjects(childObjectData || []);
        }

        // 6. Fetch related list data for each related list block
        const relatedData: {[key: string]: RelatedListData[]} = {};
        
        for (const block of relatedListBlocks) {
          
          if (block.related_list_id) {
            try {
              const { data: relatedListData, error: relatedError } = await supabase
                .rpc('get_related_list_records', {
                  p_parent_object_id: objectId,
                  p_parent_record_id: recordId,
                  p_tenant_id: tenant.id,
                  p_related_list_id: block.related_list_id
                });

              if (relatedError) {
                console.error('⚠️ Warning fetching related list data:', relatedError);
                console.error('⚠️ Error details:', {
                  code: relatedError.code,
                  message: relatedError.message,
                  details: relatedError.details,
                  hint: relatedError.hint
                });
                relatedData[block.id] = [];
              } else {
                relatedData[block.id] = relatedListData || [];
              }
            } catch (err) {
              console.error('⚠️ Error fetching related list data for block:', block.id, err);
              console.error('⚠️ Exception details:', {
                type: typeof err,
                message: err instanceof Error ? err.message : String(err)
              });
              relatedData[block.id] = [];
            }
          } else {
            relatedData[block.id] = [];
          }
        }
        
        setRelatedListData(relatedData);

      } catch (err) {
        console.error('❌ Error in fetchRecordDetail:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchRecordDetail();
  }, [objectId, recordId, tenant?.id, refreshKey]);


  // NEW: Fetch related list data for a specific block
  const fetchRelatedListDataForBlock = async (blockId: string) => {
    if (!tenant?.id || !recordId || !objectId) {
      return;
    }
    
    try {
      const { data: relatedListData, error: relatedError } = await supabase
        .rpc('get_related_list_records', {
          p_parent_object_id: objectId,
          p_parent_record_id: recordId,
          p_tenant_id: tenant.id,
          p_related_list_id: blockId
        });

      if (relatedError) {
        console.error('❌ Error fetching related list data:', relatedError);
        console.error('❌ Error details:', {
          code: relatedError.code,
          message: relatedError.message,
          details: relatedError.details,
          hint: relatedError.hint
        });
        return;
      }

      // Update the related list data state
      setRelatedListData(prev => ({
        ...prev,
        [blockId]: relatedListData || []
      }));
      
    } catch (error) {
      console.error('💥 Exception fetching related list data:', error);
      console.error('💥 Exception type:', typeof error);
      console.error('💥 Exception message:', error instanceof Error ? error.message : String(error));
    }
  };

  // NEW: Fetch related list data when child object tab is clicked
  useEffect(() => {
    if (activeTab !== 'information' && childObjectTabs.some(tab => tab.id === activeTab)) {
      // Find the related list block for this child object
      const childObjectTab = childObjectTabs.find(tab => tab.id === activeTab);
      if (childObjectTab) {
        const relatedListBlock = layoutBlocks.find(block => 
          block.block_type === 'related_list' && 
          block.related_list_id === childObjectTab.id
        );
        
        if (relatedListBlock && !relatedListData[relatedListBlock.id]) {
          fetchRelatedListDataForBlock(relatedListBlock.id);
        }
        
      }
    }
  }, [activeTab, childObjectTabs, layoutBlocks, relatedListData]);


  // Handle edit mode toggle
  const handleEditToggle = () => {
    if (isEditing) {
      // Cancel editing - restore original values
      setEditingValues(recordData || {});
    }
    setIsEditing(!isEditing);
  };

  // Handle field value change
  const handleFieldChange = (fieldName: string, value: any) => {
    setEditingValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Handle save changes
  const handleSaveChanges = async () => {
    if (!recordData || !tenant?.id) return;

    setSaving(true);
    try {

      // Get the table name from the object
      const { data: objectData, error: objectError } = await supabase
        .rpc('get_tenant_objects', { p_tenant_id: tenant.id });

      if (objectError) {
        throw new Error(`Failed to get object info: ${objectError.message}`);
      }

      const object = objectData?.find((obj: any) => obj.id === objectId);
      if (!object) {
        throw new Error('Object not found');
      }

      // Use the object's name as the table name (not table_name field)
      const tableName = object.name; // This is 'hey_a__a'

      // Log the original editing values for debugging
      console.log('✏️ Original editing values:', editingValues);
      console.log('✏️ Available field metadata:', fieldMetadata.map(f => ({ name: f.name, label: f.label })));
      
      // Debug specific problematic fields
      const problematicFields = ['type', 'type__a', 'ISO standard', 'ISO standard__a'];
      problematicFields.forEach(fieldName => {
        const fieldMeta = fieldMetadata.find(f => f.name === fieldName || f.label === fieldName);
        if (fieldMeta) {
          console.log(`🔍 Field metadata for "${fieldName}":`, { name: fieldMeta.name, label: fieldMeta.label, is_system_field: fieldMeta.is_system_field });
        } else {
          console.log(`❌ No field metadata found for "${fieldName}"`);
        }
      });
      
      // Clean the editing values - remove system fields and empty values
      // CRITICAL FIX: Map display field names to database API names
      const cleanValues = Object.entries(editingValues).reduce((acc, [displayName, value]) => {
        // Skip system fields
        if (displayName === 'id' || displayName === 'tenant_id' || displayName === 'created_at' || displayName === 'updated_at') {
          return acc;
        }

        // Skip status__a — only the review RPCs should change workflow status
        if (displayName === 'status__a' || displayName === 'status') {
          return acc;
        }

        // Skip empty strings, null, and undefined values
        if (value === '' || value === null || value === undefined) {
          return acc;
        }
        
        // Map display name to actual database API name
        let apiName = mapDisplayNameToApiName(displayName, fieldMetadata);
        
        // FALLBACK FIX: If the field name has __a suffix but metadata doesn't, use the __a version
        if (displayName.endsWith('__a') && !apiName.endsWith('__a')) {
          console.log(`🔄 Fallback fix: Using original name with __a suffix: "${displayName}"`);
          apiName = displayName; // Use the original name with __a suffix
        }
        
        // Include only non-empty values with correct API names
        acc[apiName] = value;
        
        // Log the mapping for debugging
        if (displayName !== apiName) {
          console.log(`🔄 Field name mapping: "${displayName}" -> "${apiName}"`);
        } else {
          console.log(`✅ Field name unchanged: "${displayName}"`);
        }
        
        return acc;
      }, {} as RecordData);



      // Validate UUIDs before calling RPC
      if (!recordId || recordId === '') {
        throw new Error('Record ID is empty or invalid');
      }
      if (!tenant.id || tenant.id === '') {
        throw new Error('Tenant ID is empty or invalid');
      }

      // Check if we have any values to update
      if (Object.keys(cleanValues).length === 0) {
        alert('No changes to save');
        setIsEditing(false);
        return;
      }

      // ── Date order validation for Renewal Clients workflow ───────
      if (objectTechName === 'renewal_clients__a') {
        const merged: Record<string, string> = { ...recordData, ...cleanValues };
        const d = (key: string) => merged[key] ? new Date(merged[key]) : null;

        const stages: [string, string, string][] = [
          ['intimation_sent_date__a',     'intimation_accepted_date__a',  'Intimation Accepted date must be after Intimation Sent date'],
          ['intimation_accepted_date__a', 'audit_plan_sent_date__a',      'Audit Plan Sent date must be after Intimation Accepted date'],
          ['audit_plan_sent_date__a',     'audit_plan_accepted_date__a',  'Audit Plan Accepted date must be after Audit Plan Sent date'],
          ['audit_plan_accepted_date__a', 'surveillance_audit_date__a',   'Surveillance Audit date must be after Audit Plan Accepted date'],
          ['surveillance_audit_date__a',  'audit_report_sent_date__a',    'Audit Report Sent date must be after Surveillance Audit date'],
          ['audit_report_sent_date__a',   'certificates_sent_date__a',    'Certificates Sent date must be after Audit Report Sent date'],
        ];

        for (const [earlier, later, msg] of stages) {
          const dEarlier = d(earlier);
          const dLater   = d(later);
          if (dEarlier && dLater && dLater < dEarlier) {
            toast.error(msg);
            setSaving(false);
            return;
          }
        }
      }

      // ── Date order validation for External Clients workflow ──────
      if (objectTechName === 'external_clients__a') {
        // Merge saved record dates with the values being saved
        const merged: Record<string, string> = { ...recordData, ...cleanValues };
        const d = (key: string) => merged[key] ? new Date(merged[key]) : null;

        const stages: [string, string, string][] = [
          ['Date__a',                        'Application_Accpeted_Date__a',    'Application Accepted date must be after Application Sent date'],
          ['Application_Accpeted_Date__a',   'Quotation_Received_Date__a',      'Quotation Received date must be after Application Accepted date'],
          ['Quotation_Received_Date__a',     'Client_Agreement_Signed_Date__a', 'Client Agreement Signed date must be after Quotation Received date'],
          ['Client_Agreement_Signed_Date__a','Stage_one_plan_Sent_Date__a',     'Stage 1 Plan Sent date must be after Client Agreement Signed date'],
          ['Stage_one_plan_Sent_Date__a',    'Stage_one_Audit_Done_Date__a',    'Stage 1 Audit Done date must be after Stage 1 Plan Sent date'],
          ['Stage_one_Audit_Done_Date__a',   'Report_Sent_Date__a',             'Report Sent date must be after Stage 1 Audit Done date'],
        ];

        for (const [earlier, later, msg] of stages) {
          const dEarlier = d(earlier);
          const dLater   = d(later);
          if (dEarlier && dLater && dLater < dEarlier) {
            toast.error(msg);
            setSaving(false);
            return;
          }
        }
      }

      // Log the final values being sent to database
      console.log('💾 Saving record with values:', cleanValues);
      console.log('💾 Table name:', tableName);
      console.log('💾 Record ID:', recordId);
      console.log('💾 Tenant ID:', tenant.id);

      // Use the RPC function to update the tenant schema table
      const { error: updateError } = await supabase
        .rpc('update_tenant_record', {
          p_table_name: tableName,
          p_record_id: recordId,
          p_tenant_id: tenant.id,
          p_update_data: cleanValues
        });

      if (updateError) {
        console.error('❌ RPC update error:', updateError);
        console.error('❌ Error details:', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint
        });
        throw new Error(`Failed to update record: ${updateError.message}`);
      }

      // Check if this is a draft approval that should trigger data copying
      console.log('🔍 === POST-SAVE DRAFT CHECK ===');
      console.log('🔍 ObjectId:', objectId);
      console.log('🔍 RecordId:', recordId);
      console.log('🔍 CleanValues (what was saved):', cleanValues);
      console.log('🔍 EditingValues (current form state):', editingValues);
      console.log('🔍 RecordData (current record data):', recordData);
      console.log('🔍 === APPROVED FIELD ANALYSIS ===');
      console.log('🔍 CleanValues.approved__a:', cleanValues.approved__a);
      console.log('🔍 EditingValues.approved__a:', editingValues.approved__a);
      console.log('🔍 RecordData.approved__a:', recordData?.approved__a);

      const shouldTrigger = await draftToClientService.shouldTriggerDraftApproval(objectId, cleanValues, tenant.id);
      console.log('🔍 Should trigger draft approval:', shouldTrigger);

      if (shouldTrigger) {
        console.log('🎯 Draft approved via inline editing! Triggering data copy...');
        
        try {
          const result = await draftToClientService.handleDraftApproval(
            recordId,
            tenant.id,
            tenant.id, // Using tenant.id as user ID for now, could be improved with actual user context
            objectId // Pass the actual object UUID
          );

          console.log('🔍 Draft approval result:', result);

          if (result.success) {
            alert(`Record updated successfully! ${result.message}`);
          } else {
            console.error('❌ Draft approval failed:', result.message);
            alert('Record updated successfully, but failed to copy data to client. Please check console for details.');
          }
        } catch (draftError) {
          console.error('❌ Error in draft approval process:', draftError);
          alert('Record updated successfully, but there was an error in the draft approval process. Please check console for details.');
        }
      } else {
        console.log('🔍 Not triggering draft approval - conditions not met');
        // Show regular success message
        alert('Record updated successfully!');
      }
      
      // Update local state
      setRecordData(editingValues);
      setIsEditing(false);
      
    } catch (err) {
      console.error('❌ Error saving changes:', err);
      alert(`Failed to save changes: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  // Format field value for display
  const formatFieldValue = (value: any, fieldType: string, fieldName?: string): string => {
    // Date/timestamptz: show a placeholder date format instead of "-" when
    // empty, and never "Invalid Date" — new Date('') doesn't throw, so the
    // old try/catch below never caught it and .toLocaleDateString() on an
    // Invalid Date literally returns the string "Invalid Date".
    if (fieldType === 'date' || fieldType === 'timestamptz') {
      if (value === null || value === undefined || value === '') return 'm/d/yyyy';
      const d = new Date(value);
      return isNaN(d.getTime()) ? 'm/d/yyyy' : d.toLocaleDateString();
    }

    if (value === null || value === undefined) return '-';

    // Resolve user UUID → display name for audit, owner, and user-lookup fields
    // (auditor_id/tech_reviewer_id use userMap for display same as record_owner__a —
    // it's a tenant-wide id→name map, unfiltered by role, which is fine for read-only
    // display; edit mode uses the role-filtered picklist from referenceOptions instead)
    if (fieldName === 'created_by' || fieldName === 'updated_by' || fieldName === 'record_owner__a' || fieldType === 'user_lookup') {
      return resolveUserValue(value, userMap);
    }

    switch (fieldType) {
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'decimal':
      case 'money':
        return typeof value === 'number' ? value.toLocaleString() : value;
      case 'percent':
        return typeof value === 'number' ? `${value}%` : value;
      case 'picklist': {
        // Resolve stored value → display label
        const opts = fieldName
          ? (picklistOptions[fieldName] || picklistOptions[fieldName + '__a'] || [])
          : [];
        const match = opts.find((o: any) => o.value === value);
        return match?.label || String(value);
      }
      default:
        return String(value);
    }
  };

  // Fires a "get email" notification when one of the CRM-uploaded fields in
  // RENEWAL_EMAIL_ON_UPLOAD_FIELDS (Surveillance 1) or
  // RECERT_EMAIL_ON_UPLOAD_FIELDS (Recertification) is uploaded on the
  // matching object. Originally Renewal-only (just the four Sprint 8
  // Suspension/Withdrawal fields; surveillance_intimation_letter added
  // later, see that map's own comment) — extended to Recertification in
  // Sprint 9 once the exact same "letter uploaded separately, no email
  // ever sent" bug was confirmed there too, with no map at all previously.
  // Called from every FileUploadField's onUploadComplete on this page; safe
  // to call for any object/field — it's a no-op unless the object matches
  // AND the field is in that object's map. Same soft-failure philosophy as
  // every other notification in this epic: failure is a toast warning
  // only, never blocks the upload that already succeeded by the time this
  // runs.
  const maybeSendRenewalUploadEmail = async (info?: UploadedFileInfo) => {
    if (!info) return;
    const isRenewalObject = objectTechName === 'renewal_clients__a';
    const isRecertObject  = objectTechName === 'recertification_clients__a';
    if (!isRenewalObject && !isRecertObject) return;

    const template = isRecertObject
      ? RECERT_EMAIL_ON_UPLOAD_FIELDS[info.fieldName]
      : RENEWAL_EMAIL_ON_UPLOAD_FIELDS[info.fieldName];
    if (!template) return; // not one of this object's email-triggering fields

    const recipient = recordData?.['email__a'];
    if (!recipient) return; // no email on file for this record — nothing to send to

    try {
      const { data: signedData, error: signErr } = await supabase.storage
        .from(info.bucket)
        .createSignedUrl(info.path, 300); // 5 min — just enough for the API route to fetch it
      if (signErr || !signedData?.signedUrl) return;

      const companyLabel = recordData?.['company_name__a'] || recordData?.['name'] || undefined;

      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          template,
          // hasLetter: true — this path only ever runs after a successful
          // upload with a real attachmentUrl below, so the file genuinely
          // is attached. Only the 'surveillance_intimation' template reads
          // this flag (picks "attached to this email" vs "will follow
          // shortly" wording); harmless extra key for the other templates.
          data: { companyName: companyLabel, hasLetter: true },
          attachmentUrl: signedData.signedUrl,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.success) {
        toast('File uploaded, but the notification email was not sent.', { icon: '⚠️' });
      }
    } catch {
      toast('File uploaded, but the notification email was not sent.', { icon: '⚠️' });
    }
  };

  // Render editable field input - UPDATED to match create modal exactly
  const renderEditableField = (field: FieldMetadata, value: any) => {
    const currentValue = editingValues[field.name] || value || '';
    
    // Handle different field types exactly like the create modal
    if (field.type === 'text' || field.type === 'varchar' || field.type === 'longtext') {
      return (
        <textarea
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          rows={field.type === 'longtext' ? 4 : 1}
          placeholder={`Enter ${field.label}`}
          maxLength={field.type === 'varchar' ? 255 : undefined}
        />
      );
    }
    
    if (field.type === 'number' || field.type === 'integer' || field.type === 'decimal' || field.type === 'money' || field.type === 'percent') {
      return (
        <input
          type="number"
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          placeholder={`Enter ${field.label}`}
        />
      );
    }
    
    if (field.type === 'date' || field.type === 'timestamptz') {
      // Handle date fields properly - convert to YYYY-MM-DD format for input
      let dateValue = '';
      if (currentValue) {
        try {
          const date = new Date(currentValue);
          if (!isNaN(date.getTime())) {
            dateValue = date.toISOString().split('T')[0];
          }
        } catch (e) {
          console.warn('Invalid date value:', currentValue);
        }
      }
      
      return (
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      );
    }
    
    if (field.type === 'boolean') {
      return (
        <select
          value={currentValue ? 'true' : 'false'}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value === 'true' }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    
    if ((field.type === 'reference' && field.reference_table) || (field.type === 'user_lookup' && field.lookup_role_pattern)) {
      return (
        <div className="space-y-2">
          <div className="relative">
            <select
              value={currentValue}
              onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              disabled={!referenceOptions[field.name] || referenceOptions[field.name].length === 0 || referenceLoading[field.name]}
            >
              <option value="">
                {referenceLoading[field.name] 
                  ? 'Loading options...' 
                  : referenceOptions[field.name]?.length === 0 
                    ? 'No options available' 
                    : `Select ${field.label}`
                }
              </option>
              {referenceOptions[field.name]?.map((option: any) => (
                <option key={option.id} value={option.id}>
                  {option.display_name || option.record_name || option.name || option.label || `Record ${option.id}`}
                </option>
              )) || []}
            </select>
            
            {/* Loading spinner */}
            {referenceLoading[field.name] && (
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              </div>
            )}
          </div>
          
        </div>
      );
    }
    
    if (field.type === 'picklist') {
      return (
        <select
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="">Select {field.label}</option>
          {picklistOptions[field.name]?.map((option: any) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          )) || []}
        </select>
      );
    }
    
    if (field.type === 'autonumber') {
      return (
        <input
          type="text"
          value="Auto-generated"
          readOnly
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed sm:text-sm"
          title="This field is automatically populated by the system"
        />
      );
    }

    if (field.type === 'file' || field.type === 'files') {
      return (
        <FileUploadField
          objectId={objectId}
          fieldId={field.id}
          fieldName={field.name}
          fieldLabel={field.label}
          recordId={recordId}
          multiple={field.type === 'files'}
          companyName={recordData?.['Company_name__a'] || recordData?.['name'] || undefined}
          onUploadComplete={(info) => { setRefreshKey(k => k + 1); maybeSendRenewalUploadEmail(info); }}
        />
      );
    }

    // Default fallback for unknown field types
    return (
      <input
        type="text"
        value={currentValue}
        onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        placeholder={`Enter ${field.label}`}
      />
    );
  };



  // NEW: Navigate to child record detail
  const navigateToChildRecord = (childObjectId: string, childRecordId: string, childObjectLabel: string) => {
    console.log('🔗 Navigating to child record:', {
      childObjectId,
      childRecordId,
      childObjectLabel
    });
    
    // Create a URL that can be used to navigate to the child record
    // Format: /dashboard?objectId={childObjectId}&recordId={childRecordId}&objectLabel={childObjectLabel}
    const searchParams = new URLSearchParams({
      objectId: childObjectId,
      recordId: childRecordId,
      objectLabel: childObjectLabel,
      fromRelatedList: 'true'
    });
    
    const navigationUrl = `/dashboard?${searchParams.toString()}`;
    
    console.log('🔗 Navigation URL:', navigationUrl);
    
    // Navigate to the dashboard with the child record parameters
    window.location.href = navigationUrl;
  };

  // Render related list
  const renderRelatedList = (block: LayoutBlock) => {
    const relatedRecords = relatedListData[block.id] || [];
    const displayColumns = block.display_columns || ['id', 'name']; // Default columns
    

    
    // Find the child object that corresponds to this related list block
    const childObject = childObjects.find(child => {
      // Try to match by object label first
      return child.object_label.toLowerCase() === block.label.toLowerCase();
    });
    
    // Use the child object's label if found, otherwise fall back to block label
    const displayLabel = childObject ? childObject.object_label : block.label;
    
    return (
      <div key={block.id} className="md:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-gray-700">{displayLabel}</h4>
          <button 
            className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 border border-blue-300 rounded hover:bg-blue-50"
            onClick={() => console.log('Add record to related list:', displayLabel)}
          >
            + Add Record
          </button>
        </div>
        
        {relatedRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {displayColumns.map(col => {
                    const displayLabel = formatColumnLabel(col);
                    
                    return (
                      <th key={col} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {displayLabel}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {relatedRecords.map((record, recordIndex) => {
                  return (
                    <tr key={record.record_id} className="hover:bg-gray-50">
                                              {displayColumns.map(col => {
                          // Find the field metadata for this column
                          const fieldMeta = fieldMetadata.find(f => f.name === col);
                          
                          const smartValue = getSmartFieldValue(record.record_data, col);
                          
                          return (
                            <td key={col} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {col === 'name' ? (
                                // Make name field a clickable hyperlink
                                <UniversalFieldDisplay
                                  record={record.record_data}
                                  fieldName={col}
                                  fieldValue={getSmartFieldValue(record.record_data, col)}
                                  fieldType={fieldMeta?.type}
                                  referenceTable={fieldMeta?.reference_table || undefined}
                                  referenceDisplayField={fieldMeta?.reference_display_field || undefined}
                                  tenantId={tenant?.id || ''}
                                  recordId={record.record_id}
                                  isClickable={true}
                                  onClick={() => {
                                    // Find the child object for this related list
                                    const childObject = childObjects.find(child => {
                                      // Try to match by object label first
                                      return child.object_label.toLowerCase() === block.label.toLowerCase();
                                    });
                                    
                                    if (childObject) {
                                      navigateToChildRecord(
                                        childObject.object_id,
                                        record.record_id,
                                        childObject.object_label
                                      );
                                    }
                                  }}
                                />
                              ) : (
                                // Regular field display - use universal component
                                <UniversalFieldDisplay
                                  record={record.record_data}
                                  fieldName={col}
                                  fieldValue={getSmartFieldValue(record.record_data, col)}
                                  fieldType={fieldMeta?.type}
                                  referenceTable={fieldMeta?.reference_table || undefined}
                                  referenceDisplayField={fieldMeta?.reference_display_field || undefined}
                                  tenantId={tenant?.id || ''}
                                  recordId={record.record_id}
                                />
                              )}
                            </td>
                          );
                        })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <p className="text-sm">No records found in this related list.</p>
            <p className="text-xs mt-1">Click "Add Record" to create one.</p>
          </div>
        )}
      </div>
    );
  };

  // Render tab content based on active tab
  const renderTabContent = () => {
    // Information tab - shows main record details and layout
    if (activeTab === 'information') {
      if (sections.length === 0) {
        return (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">No Page Layout Configured</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  This object doesn't have a page layout configured yet. 
                  Configure the page layout in Object Manager to see fields organized here.
                </p>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="p-6 space-y-6">
          {sections.map(section => {
            const sectionBlocks = layoutBlocks.filter(block => block.section === section && block.is_visible);
            
            if (sectionBlocks.length === 0) return null;

            return (
              <div key={section} className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4 capitalize">{section}</h3>
                
                {/* Separate editable and system fields */}
                {(() => {
                  const fieldBlocks = sectionBlocks.filter(block => block.block_type === 'field');
                  
                  // Separate editable and system fields
                  const editableFields = fieldBlocks.filter(block => {
                    const field = fieldMetadata.find(f => f.id === block.field_id);
                    return field && !isSystemField(field.name);
                  });
                  
                  const systemFields = fieldBlocks.filter(block => {
                    const field = fieldMetadata.find(f => f.id === block.field_id);
                    return field && isSystemField(field.name);
                  });

                  return (
                    <div className="space-y-4">
                      {/* Editable fields first */}
                      {editableFields.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {editableFields
                            .sort((a, b) => a.display_order - b.display_order)
                            .map(block => {
                              if (block.block_type === 'field' && block.field_id) {
                                const field = fieldMetadata.find(f => f.id === block.field_id);
                                
                                if (!field) {
                                  return null;
                                }
                                
                                // Get field value from record data using normalized field names
                                const fieldValue = findFieldValue(recordData || {}, field.name);
                                const displayValue = formatFieldValue(fieldValue, field.type, field.name);

                                return (
                                  <div 
                                    key={block.id} 
                                    className={`${block.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}`}
                                  >
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      {field.label}
                                      {field.is_required && <span className="text-red-500 ml-1">*</span>}
                                    </label>
                                    
                                    {(field.type === 'file' || field.type === 'files') ? (
                                      isStageReportLockedForClient(field.name, recordData, user?.id) ? (
                                        <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded border italic">
                                          Available once the Tech Reviewer has reviewed the audit report
                                        </div>
                                      ) : (
                                        <FileUploadField
                                          objectId={objectId}
                                          fieldId={field.id}
                                          fieldName={field.name}
                                          fieldLabel={field.label}
                                          recordId={recordId}
                                          multiple={field.type === 'files'}
                                          readOnly={
                                            !can('edit', 'field', field.id) ||
                                            !isFileUploadAllowedForRole(
                                              field.name, recordData, user?.id, userProfile?.role, customRoleName,
                                              objectTechName === 'renewal_clients__a',
                                              objectTechName === 'recertification_clients__a',
                                            )
                                          }
                                          companyName={recordData?.['Company_name__a'] || recordData?.['name'] || undefined}
                                          onUploadComplete={(info) => { setRefreshKey(k => k + 1); maybeSendRenewalUploadEmail(info); }}
                                        />
                                      )
                                    ) : isEditing && can('edit', 'field', field.id) ? (
                                      // Edit mode — only if user can edit this specific field
                                      renderEditableField(field, fieldValue)
                                    ) : (
                                      // View mode or field is read-only for this user
                                      <div className={`text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border ${
                                        isEditing && !can('edit', 'field', field.id)
                                          ? 'opacity-60 cursor-not-allowed'
                                          : ''
                                      }`}>
                                        {displayValue}
                                        {isEditing && !can('edit', 'field', field.id) && (
                                          <span className="ml-2 text-xs text-gray-400">(read-only)</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              
                              return null;
                            })}
                        </div>
                      )}
                      
                      {/* System fields at bottom of section */}
                      {systemFields.length > 0 && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-3">System Fields (Auto-populated)</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {systemFields
                              .sort((a, b) => a.display_order - b.display_order)
                              .map(block => {
                                if (block.block_type === 'field' && block.field_id) {
                                  const field = fieldMetadata.find(f => f.id === block.field_id);
                                  if (!field) return null;

                                  const fieldValue = findFieldValue(recordData || {}, field.name);
                                  const displayValue = formatFieldValue(fieldValue, field.type, field.name);

                                  // record_owner__a: editable user picker
                                  if (field.name === 'record_owner__a') {
                                    return (
                                      <div key={block.id} className="md:col-span-1">
                                        <label className="block text-sm font-medium text-gray-500 mb-1">
                                          {field.label}
                                        </label>
                                        {isEditing && can('edit', 'field', field.id) ? (
                                          <select
                                            value={editingValues['record_owner__a'] || fieldValue || ''}
                                            onChange={e => setEditingValues(prev => ({ ...prev, record_owner__a: e.target.value }))}
                                            className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                          >
                                            <option value="">— unassigned —</option>
                                            {Object.entries(userMap).map(([uid, name]) => (
                                              <option key={uid} value={uid}>{name}</option>
                                            ))}
                                          </select>
                                        ) : (
                                          <div className="text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2">
                                            {displayValue}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }

                                  // All other system fields: read-only
                                  return (
                                    <div
                                      key={block.id}
                                      className={`${block.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}`}
                                    >
                                      <label className="block text-sm font-medium text-gray-500 mb-1">
                                        {field.label}
                                      </label>
                                      <div className="text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2">
                                        {displayValue}
                                      </div>
                                    </div>
                                  );
                                }

                                return null;
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      );
    }
    
    // Child object tabs - show related list data for specific child objects
    const childObjectTab = childObjectTabs.find(tab => tab.id === activeTab);
    if (childObjectTab) {
      // Find the related list block for this child object using the mapping
      const relatedListBlock = childObjectToRelatedListMap.get(childObjectTab.id);
      
      if (relatedListBlock) {
        // Check if we have data for this related list
        const relatedRecords = relatedListData[relatedListBlock.id] || [];
        
        return (
          <div className="p-6">
            {/* Render the related list for this child object */}
            {renderRelatedList(relatedListBlock)}
          </div>
        );
      } else {
        // Try to find the related list block by looking at the layout blocks directly
        const directRelatedListBlock = layoutBlocks.find(block => 
          block.block_type === 'related_list' && 
          block.related_list_id === childObjectTab.id
        );
        
        if (directRelatedListBlock) {
          return (
            <div className="p-6">
              {/* Render the related list for this child object */}
              {renderRelatedList(directRelatedListBlock)}
            </div>
          );
        }
        
        return (
          <div className="p-6">
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">No related list configuration found for {childObjectTab.label}</p>
              <p className="text-xs mt-1">Configure this in Object Manager → Page Layout</p>
            </div>
          </div>
        );
      }
    }
    
    // Fallback for unknown tabs
    return (
      <div className="p-6">
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">Unknown tab: {activeTab}</p>
        </div>
      </div>
    );
  };

  // Render loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error Loading Record</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // NEW: Render tab navigation
  const renderTabNavigation = () => {
    if (allTabs.length <= 1) {
      return null; // Only show if there are multiple tabs
    }
    
    return (
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {allTabs.map(tab => {
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    );
  };

  // Main render
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        <div className="flex items-center space-x-3">
          {/* Custom Action Buttons */}
          {(() => {
            // Get all button blocks from layout (buttons can be in any section)
            const buttonBlocks = layoutBlocks.filter(block => block.block_type === 'button' && block.is_visible);
            
            if (buttonBlocks.length === 0) return null;

            return (
              <div className="flex items-center space-x-2 mr-4">
                {buttonBlocks
                  .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
                  .map(block => {
                    if (block.block_type === 'button' && block.button_id) {
                      const buttonLabel = block.label || 'Button';
                      const buttonDetail = buttonDetails[block.button_id];
                      
                      const handleButtonClick = async () => {
                        let currentButtonDetail = buttonDetail;
                        
                        // If button details are missing, reload via RPC and retry
                        if (!currentButtonDetail) {
                          await loadButtonDetails();
                          currentButtonDetail = buttonDetails[block.button_id!];
                          if (!currentButtonDetail) {
                            return;
                          }
                        }
                        
                        if (currentButtonDetail) {
                          if (currentButtonDetail.custom_component_path) {
                            setActiveCustomComponent({
                              componentPath: currentButtonDetail.custom_component_path,
                              buttonDetail: currentButtonDetail
                            });
                          } else {
                            alert(`Button "${buttonLabel}" clicked! This button doesn't have a custom component configured.`);
                          }
                        } else {
                          alert(`Button "${buttonLabel}" clicked! Button details not loaded yet.`);
                        }
                      };

                      return (
                        <button
                          key={block.id}
                          onClick={handleButtonClick}
                          className="px-3 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 hover:bg-blue-700 text-white"
                          title={`Button: ${buttonLabel}`}
                        >
                          {buttonLabel}
                        </button>
                      );
                    }
                    
                    return null;
                  })}
              </div>
            );
          })()}

          {/* Edit/Save/Cancel Buttons */}
          {isEditing ? (
            <>
              <button
                onClick={handleSaveChanges}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={handleEditToggle}
                disabled={saving}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                Cancel
              </button>
            </>
          ) : (
            // Only show Edit Record if user can edit this object
            can('edit', 'object', objectId) && (
              <button
                onClick={handleEditToggle}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                Edit Record
              </button>
            )
          )}
          
          <button
            onClick={onBackToList}
            className="text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            ← Back to List
          </button>
        </div>
      </div>

      {/* Workflow bar + Review panel — only for External Clients object */}
      {objectTechName === 'external_clients__a' && recordData && (
        <>
          <ClientWorkflowBar
            recordData={recordData}
            picklistOptions={
              picklistOptions['status'] ||
              picklistOptions['status__a'] ||
              Object.values(picklistOptions).find(opts =>
                Array.isArray(opts) && opts.some(o =>
                  o.label?.toLowerCase().includes('application') ||
                  o.value?.toLowerCase().includes('application')
                )
              ) || []
            }
          />
          <ReviewActionPanel
            recordId={recordId}
            recordData={recordData}
            currentUserRole={userProfile?.role || 'user'}
            currentCustomRole={customRoleName}
            currentUserId={user?.id || ''}
            objectId={objectId}
            onActionComplete={() => setRefreshKey(k => k + 1)}
          />
          <StageAuditActionPanel
            recordId={recordId}
            recordData={recordData}
            currentUserRole={userProfile?.role || 'user'}
            currentCustomRole={customRoleName}
            currentUserId={user?.id || ''}
            objectId={objectId}
            onActionComplete={() => setRefreshKey(k => k + 1)}
          />
        </>
      )}

      {/* Workflow bar + Action panel — only for Renewal Clients object */}
      {objectTechName === 'renewal_clients__a' && recordData && (
        <>
          <RenewalWorkflowBar
            status={recordData['status__a'] ?? null}
            recordData={recordData}
          />
          <RenewalActionPanel
            recordId={recordId}
            recordData={recordData}
            objectId={objectId}
            currentUserRole={userProfile?.role || 'user'}
            currentCustomRole={customRoleName}
            currentUserId={user?.id || ''}
            currentUserEmail={user?.email || ''}
            tenantId={tenant?.id}
            onActionComplete={() => setRefreshKey(k => k + 1)}
          />
        </>
      )}

      {/* Workflow bar + Action panel — only for Recertification Clients
          object. Own conditional block, own components — never merged with
          the Renewal block above even though both follow the same shape. */}
      {objectTechName === 'recertification_clients__a' && recordData && (
        <>
          <RecertificationWorkflowBar
            status={recordData['status__a'] ?? null}
            recordData={recordData}
          />
          <RecertificationActionPanel
            recordId={recordId}
            recordData={recordData}
            objectId={objectId}
            currentUserRole={userProfile?.role || 'user'}
            currentCustomRole={customRoleName}
            currentUserId={user?.id || ''}
            currentUserEmail={user?.email || ''}
            tenantId={tenant?.id}
            onActionComplete={() => setRefreshKey(k => k + 1)}
          />
        </>
      )}

      {/* NEW: Tab Navigation */}
      {renderTabNavigation()}

      {/* Tab Content */}
      <div className="bg-white rounded-lg border border-gray-200">
        {renderTabContent()}
      </div>

      {/* Custom Component Modal */}
      {activeCustomComponent && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={() => setActiveCustomComponent(null)}></div>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl">
              {/* Modal Header with title and close button */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-xl font-semibold text-gray-900">
                  {activeCustomComponent.buttonDetail.label || activeCustomComponent.buttonDetail.name || 'Custom Component'}
                </h3>
                <button 
                  onClick={() => setActiveCustomComponent(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
                  title="Close"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Modal Content */}
              <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                <React.Suspense fallback={
                  <div className="flex items-center justify-center p-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-2 text-gray-600">Loading component...</span>
                  </div>
                }>
                  <CustomTabRenderer
                    componentPath={activeCustomComponent.componentPath}
                    tabId={`button_${activeCustomComponent.buttonDetail.id}`}
                    tabLabel={activeCustomComponent.buttonDetail.label || activeCustomComponent.buttonDetail.name || 'Custom Component'}
                    recordId={recordId}
                    objectId={objectId}
                    recordData={recordData}
                    tenantId={tenant?.id}
                  />
                </React.Suspense>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}