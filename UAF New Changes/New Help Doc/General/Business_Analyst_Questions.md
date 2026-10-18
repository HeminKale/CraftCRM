# Business analyst questions

Updated 18 October 2026. Keep answers in this file with the decision date and owner. Questions are open unless answered below; proposed defaults are not approved requirements.

## Confirmed requirements

- A blank rights-matrix intersection means no view, edit, upload or acceptance for that role/action.
- Auditor and Tech Reviewer rights apply only to the person assigned to the record. RCA approval belongs to the assigned Auditor; client approval is not allowed.
- Rejection changes remain out of scope for now.
- The audit flow ends at certificate issue. The new non-response process is separate: second notice after 30 unanswered days, then a further 10-day response window before suspension. Scope follows matrices with suspension: Surv 1/2, not the supplied Recert matrix. Local 301 now implements the upload-based no-response path for Surveillance 1; live scheduling is off, the shared letter is pending, and Reject waits for BA. The old post-certificate chain remains paused locally.
- Keep the existing selected-record Summary upload. Bulk spreadsheets belong in a separate tab/process.
- The latest rule supersedes one-row/one-record: combine only 9001, 14001 and 45001. Automatically split other standards into individual records. Recognise shorthand `9`, `14`, `45` in existing fields, and store canonical `ISO 9001, ISO 14001` style values.
- The spreadsheet must not require a Client ID column. Match using company names with whitespace removed, supported by comparison of standard numbers such as `9001` and `14001`.
- Cover workflows that already have Summary upload. Initial, Surveillance 1 and Recertification have implementations; the supplied live metadata shows no separate Surveillance 2 workflow.
- The existing single-client button was analysed before bulk coding. Bulk buttons are admin only on the three Summary tabs. Finish/document one sprint and wait for the user's go-ahead before starting another.

## Open decisions

| ID | Question / example | Why it is needed |
| --- | --- | --- |
| B02 (remaining cases) | Matching/grouping is now confirmed. How should distinct branches/sites with the same normalised name be represented? | Sprint 11 requires explicit selection among multiple eligible candidates; no blind latest-cycle selection. |
| B04 (partly answered) | Cover workflows with existing Summary upload: Initial, Surveillance 1 and Recertification. Which exact Type spellings are accepted? | Surveillance 2 is not implemented in the supplied live metadata. A Type must select one workflow, not be ignored. |
| B05 | What uniquely identifies a cycle: Client ID + certification body + standard/certificate + cycle start/year + type? Should audit Record ID be required to update an existing cycle? Can two active records of the same type exist? | There is currently no unique cycle key. Selecting the latest record is unsafe. |
| B06 | Should Surveillance 1 and 2 use a cycle/type column on renewal records, or a different model? How should existing untyped renewals be classified? Is another Initial/Recert cycle allowed after completion? | The code has no implemented Surv 2 discriminator or reliable backfill rule. |
| B07 | For a Surveillance/Recert row whose client does not exist, what identity is mandatory (company, standards, country, email, etc.)? Should creation make only an identity with no Initial milestones? | The sample has no email or application document. Creating identity must not fabricate Initial certification completion. |
| B08 | When a child audit row changes company/address/scope/standards/contact, should those changes update the original client or stay specific to that audit? What happens to other audit records and the Initial Summary? | Current values are copied snapshots. Automatic propagation could overwrite historical information. |
| B09 | In the sample, Type is `Initial` but several date columns say `Recert plan ...`, `Recert audit ...`, and `Recert NCR ...`. Are these actually Stage 2 dates, real Recert dates, or a template error? | Blocks safe mapping for those columns. Do not relabel them without a decision. |
| B10 | What is the distinction between `Reg date` and `registration date`? Which controls original registration, current certificate issue and workflow status? | The sample contains different values in these two columns. |
| B11 | Where should Surveillance 1 mandays, Surveillance 2 mandays and Recert mandays be stored for each Type? Are historical auditor/reviewer names only notes, or should they resolve assigned user accounts? | These are not interchangeable with workflow assignment UUIDs. Names alone cannot grant rights. |
| B12 | May historical imports assert milestones without the actual approvals/files? Should such records be visibly marked Imported, and should incomplete prerequisites block later normal actions? Should imports send any emails or invites? | Selected-record summary imports already assert dates directly. Bulk must make its side effects explicit. |
| B13 | If a populated spreadsheet cell differs from an existing value, should it overwrite on confirmation, fill blanks only, or require a field-level choice? Should clearing ever be supported explicitly? | Proposed default: show differences, preserve blank cells, never silently clear data. |
| B14 | On a mixed batch, should valid rows commit while invalid ones wait, or must the whole batch succeed together? How long must source files, import history and previous values be retained? Is an undo required? | Defines partial-result handling, retention and recovery. |
| B15 | If a user submits the same file again, which changes should be reapplied? How should a corrected version be recognised? What if another user edits a target after preview? | Requires idempotency, retry and conflict rules, not just an upload filename. |
| B16 (partly answered) | Timing is 30 days plus 10 after the second notice; scope is matrices with suspension. Which entity/checkpoints are suspended and how do restoration/late responses work? | Finalise these details in Sprint 13; do not reactivate the old mandatory post-certificate chain. |
| B17 | For the independent suspension process, who initiates, decides, uploads, receives emails and can view each document? What restores a certificate after suspension? | Needed for the separate flow and its rights matrix. |
| B18 | How should existing records already in Suspension/Withdrawal statuses appear? Preserve their historical status with a separate certificate/audit completion indicator, or perform a reviewed migration? | Local changes preserve all old values and files; no history is reclassified automatically. |
| B19 | May an original client be deleted when audit records exist, or should all flows use archive-only? Should old unlinked renewals be manually linked? | Surveillance currently uses ON DELETE SET NULL, while Recertification restricts deletion. |
| B20 | Which file is authoritative when the extensionless `Summary sheet bulk` text and the actual workbook have different dates? | For an uploaded workbook, the importer should use that workbook's saved values and preview them. |
| B21 | Which exact rights-matrix checkpoints now require email, to which stored record email(s), and should creation alerts remain in addition to letter notices? | User will supply an updated matrix. Sprint 12 preserves current creation/intimation behaviour only; historical suspension/withdrawal paths remain paused. No new checkpoints are inferred. |
| B22, resolved for Sprint 13 | Use original intimation letter upload finalisation; provider acceptance/delivery/failure is irrelevant to timing. Replacement letters and corrected emails do not restart it. | User's in-session Sprint 13 answers resolve this; see answer log. |
| B23 | When form, intimation letter and record email disagree, who confirms/corrects the authoritative record email? Are multiple recipients/CC permitted? | Sprint 12 sends to one validated stored record email only; no PDF-address extraction, arbitrary browser override or recipient guessing. |
| B24 | Who owns sender/domain verification, the monitored reply mailbox, failed/uncertain notice review, manual recovery and private email-audit retention? | Operational release prerequisites; customer mail and live configuration were not tested or changed in Sprint 12. Replies never substitute for software Accept/Reject. |
| B25, implementation recorded | External Client status is the target. Local 301 uses `Suspended` with an immutable non-response marker and prior-status audit; child Surveillance checkpoint/history stay intact. | No restoration rights, login ban or Recertification suspension is added. Live status/layout/grant QA remains. |
| B26, BA hold | User proposes sending the suspension letter directly on software Reject, but explicitly says wait for BA. What is the approved direct-Reject action and eventual restoration process? | Reject now stops this automatic path in a BA hold; no direct letter/status action. Late responses are recorded for CRM without automatic restoration. |
| B27, resolved timing | Use the same IST clock time at 30/10 calendar days. Replacements/email corrections do not restart timing. | Ten further days start at transactional second-notice creation; timestamps are explicit in UI/audit and no provider event gates either window. |
| B28, formats confirmed; artifact pending | Shared suspension source is **DOCX**; personalise it and **send PDF**. Actual file/token placement and whether day 30 uses that same letter remain pending. | 302 supports a private tenant-shared, versioned DOCX; 303 and the worker enforce PDF suspension attachments. No template is uploaded/activated. Current day-30 notice is a software reminder with original intimation attached. Additional checkpoints still need an updated trigger matrix. |

## Answer log

| ID | Answer | Decided by | Date |
| --- | --- | --- | --- |
| B01, superseded | Initially one row/one record. Later clarified: automatically split mixed rows into the 9001/14001/45001 integrated group plus a separate record for each other standard. | User | 18 October 2026 |
| B02 | No spreadsheet Client ID. Match whitespace-free names and complete normalised standard numbers, including shorthand. Append only the integrated three; preserve existing standards and blank input fields. | User | 18 October 2026 |
| B03 | Bulk upload is admin only on all three tabs, enforced on the server as well as the UI. | User | 18 October 2026 |
| B04, partial | Cover whichever workflows already have Summary upload. Source review finds Initial, Surveillance 1 and Recertification. Live metadata confirms no separate Surveillance 2 workflow. | User scope instruction; source/live-metadata verification | 18 October 2026 |
| B16, partial | Wait 10 days after the day-30 second letter. Follow matrices containing suspension: Surv 1/2. Supplied Recert matrix has none. | User; matrix review | 18 October 2026 |
| B16, additional partial answers | Supplied Sprint 13 notes specify Surveillance intimation, External Client status as suspension target, 30 + 10 days IST, and ignore records without email. These do not settle the delivery event, failure/replacement/rejection/late-response rules or restoration. | User's supplied Sprint 13 notes; reviewed when starting Sprint 13 | 18 October 2026 |
| B16/B22/B27, follow-up | Original letter upload date is sufficient; do not use delivery/provider parameters. Replacement letter or email correction: no reset. Same IST clock-time boundary is used for 30 days and the further 10 days. | User's numbered in-session answers; clock-time interpretation stated back in commentary/question | 18 October 2026 |
| B26, partial | Reject should send the suspension letter directly, **but wait for BA confirmation**. Late responses are handled by CRM. | User's numbered in-session answers | 18 October 2026 |
| B28, partial | The template is the suspension letter, uploaded at one place in Supabase; personalise company name/details. Format, artifact/path and whether day 30 uses it are not supplied. | User's in-session answer | 18 October 2026 |
| B28, format answer | **DOCX**. Runtime support is implemented in 302; actual artifact and day-30 content confirmation are still pending. | User's follow-up reply | 18 October 2026 |
| B28, outgoing format | Store the shared letter in DOCX, edit/personalise a copy, and send it in **PDF**. Implemented local conversion and PDF-only outgoing guards; real renderer/template visual QA remains pending. | User's latest instruction | 18 October 2026 |

## Sprint 13 implementation gate

Sprint 13 continues under the user's follow-up answers. 300 is the foundation, 301 implements upload-based deadlines/reminder/External Client suspension, 302 adds shared DOCX personalisation, and 303 enforces outgoing PDF support. Live scheduling is disabled. Provider/replacement/timing/format holds are resolved; Reject stays on BA hold. Actual DOCX content, conversion/layout QA, activation and restoration rights remain pending. See [current handoff](Sprint_13_Local_Handoff.md). No later sprint is authorised.
