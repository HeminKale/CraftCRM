# Rights Matrix — Sprint Plan (from S6_rights_matrix_verification.md)

Source: [`S6_rights_matrix_verification.md`](../New Help Doc/S6_rights_matrix_verification.md)'s
"Still open for the next session" section. This plan turns that list into
sprints.

**Read this first — the honest scope check:** I re-verified the doc's claims
against the live database (via `@supabase/supabase-js` + the service-role key
already in `.env.local`, read-only calls) before planning anything. Confirmed
live: migration 244's RPCs (`get_tenant_users_by_role_pattern`,
`assign_stage_team`) genuinely don't exist yet in the schema — matches the
doc's "written, not applied" claim, this isn't just trusting the file. The
`tenant` schema itself isn't exposed over PostgREST, so I can't query tables
directly, and there's no `DATABASE_URL`/direct Postgres connection anywhere in
this repo — migrations here are applied by hand (matches
`DeployNEW_UPDATE_PROCEDURE.md`'s "Database migrations should be handled
separately"). Given that, **almost nothing left in the doc's backlog is code I
can write blind right now.** It splits into three kinds of work:

1. **Deploy + verify** (SQL you run, I hand you the queries) — Sprint 1
2. **Permission Set config** (Settings UI, stakeholder-only, no SQL) — Sprint 2
3. **Decisions only you can make**, which then unblock any remaining code —
   Sprint 3 (gate), Sprint 4 (conditional code, doesn't exist yet)

There is currently **no sprint where I write new application code** — every
remaining "Remaining design gap" in the doc either resolves to PS config
(no code) or is blocked on a decision. I'm not manufacturing busywork to fill
a sprint slot; Sprint 4 stays empty until Sprint 3's answers land.

---

## Sprint 1 — Deploy & Verify (SQL, you run it)

Apply the three pending migrations (242, 243, 244) and confirm the role
naming they depend on is actually in place. See
[`rights_S1.md`](rights_S1.md) for the exact queries and order.

## Sprint 2 — Permission Set Configuration (Settings UI, no SQL)

Three field-visibility rules that are 100% PS jobs per this app's
architecture (RPCs have zero PS awareness, confirmed uniformly — see
`RPC for file fields.md`). See [`rights_S2.md`](rights_S2.md).

## Sprint 3 — Decision gate (blocks Sprint 4)

Three open questions from the doc that I can't answer for you — asked
separately in this conversation. Nothing in Sprint 4 starts until these land.

## Sprint 4 — Auditor/Tech Reviewer Page Layout field

**Reopened 2026-08-01** for a new ask outside the original S6 backlog: make
`auditor_id__a`/`tech_reviewer_id__a` placeable on the Page Layout as a
name-based, role-filtered picklist, with the selection actually driving
accept/reject/close/findings authorization. Built — see
[`rights_S4.md`](rights_S4.md) for what shipped (migration 246, frontend
changes) and manual steps. The original candidate item for this slot (a
CRM/admin-only upload lock on `application_Form`) was declined separately —
current behavior there stays as-is.

---

## Explicitly out of scope for this plan

- **Certificate issuance (row 25):** disconnected subsystem, doc says "not
  scoped or discussed" — not pulled into this plan without a separate ask.
- **RCA/evidences CRM-bypass (item 5):** doc marks this "known, accepted... not
  an oversight" — not touched.
- **Migration 241:** separate workstream per the doc, not part of this epic.
