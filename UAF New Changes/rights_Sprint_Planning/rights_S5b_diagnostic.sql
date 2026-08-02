-- ================================================================
-- Sprint 5b diagnostics (2026-08-02) — run in Supabase SQL editor
-- ================================================================

-- 1. Confirm migration 249 (this session's fix) actually took effect.
select pg_get_functiondef(p.oid) like '%status__a IN (''Stage1_Plan_Accepted'', ''Stage1_Report_Sent'')%' as has_stage1_reupload_guard,
       pg_get_functiondef(p.oid) like '%status__a IN (''Stage2_Plan_Accepted'', ''Stage2_Report_Sent'')%' as has_stage2_reupload_guard
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_file_upload';

-- 2. Bug #1 — Auditor missing the Stage 1 Audit Report upload option.
-- Checks the Auditor test account's role AND whether a Permission Set
-- entry is quietly restricting can_edit on stage1_report for their role.
-- (No RPC/code restriction exists for this — confirmed in 248/243/249 —
-- so if the Auditor still can't see the upload control, it has to be
-- either this account's role not resolving to "auditor", or a PS entry.)
select su.email, su.role as system_role, r.name as custom_role_name
from system.users su
left join tenant.roles r on r.id = su.custom_role_id
where su.email = '<the auditor test account email>';

select ps.name as permission_set_name, f.name as field_name, pse.can_read, pse.can_edit
from tenant.permission_set_entries pse
join tenant.permission_sets ps on ps.id = pse.permission_set_id
join tenant.fields f on f.id = pse.resource_id
join tenant.objects o on o.id = f.object_id
where o.name = 'external_clients__a'
  and f.name = 'stage1_report'
order by ps.name;

-- Which permission set(s) is the Auditor account actually assigned?
select su.email, ps.name as assigned_permission_set
from system.users su
join tenant.user_permission_sets ups on ups.user_id = su.id
join tenant.permission_sets ps on ps.id = ups.perm_set_id
where su.email = '<the auditor test account email>';

-- 3. Bug #2 — client saw the Stage 1 Audit Report before Tech Reviewer
-- acceptance. Pulls the exact record's current/actual status history so
-- we can tell whether it was a live-data/timing issue (record had already
-- reached Stage1_Tech_Findings_Given, which correctly unlocks it) versus
-- something still wrong.
select id as record_id, "Company_name__a", status__a,
       stage1_report__a is not null and stage1_report__a::text not in ('null','{}','[]','') as report_has_file,
       client_user_id__a, auditor_id__a, tech_reviewer_id__a, updated_at
from tenant.external_clients__a
where id = '<the record id you were testing>';
