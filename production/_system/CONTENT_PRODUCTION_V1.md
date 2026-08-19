# CONTENT PRODUCTION V1

CONTENT PRODUCTION V1 is the control layer between AUTO STOCK V1, MASTER data, IMAGE UPLOAD INBOX V1, runtime generation, and the main UI shell. It does not replace those systems. `strains/`, `sources/`, and `entities/` remain MASTER truth. `runtime/`, `data.js`, and `sources.js` are generated. CONTENT PRODUCTION never writes `main`.

## Publication

`production/publication.json` is the publication-control source of truth. Every MASTER strain must have exactly one entry. Bootstrap entries are generated from the implementation-time public `runtime/catalog.json` set, marked `published` / `grandfathered`, with `introducedByRun: null` and `publishedAt: null`. Historical publication timestamps are never guessed. Missing or orphan entries are blocking errors and ID renames never auto-follow.

Normal Build includes only `state: published` strains. Public `sources` are the nested `sourceRefs` closure of published strains and public `entities` are the relation-entity closure. MASTER validation still validates every pending/published strain and every MASTER source/entity.

New CONTENT PRODUCTION strains enter MASTER with a `pending` publication entry. The default policy for new RUNs is now `cultivar`, meaning DATA-FIRST / IMAGE-LATER / CULTIVAR-LEVEL PUBLICATION. Formal strain data, source closure, and entity closure may be committed to MASTER before an image exists. `visuals: []` is a valid image-waiting state. A pending cultivar remains absent from public runtime until its own publication gate passes.

Publication is independent per target cultivar. A ready target may move to `published` without waiting for other targets in the same RUN. An `IMAGE_PENDING`, `NEEDS_REVIEW`, rejected, or otherwise image-incomplete target does not block a different target that satisfies the gate. Image failure never causes completed MASTER strain/source/entity data to be deleted or rolled back. The unfinished cultivar remains as backlog and can resume later from existing formal data plus its image manifest and a new candidate.

Historical RUN records using `publicationPolicy: batch` remain valid and are never rewritten. `run.schema.json` accepts both `batch` and `cultivar` solely for backward compatibility, while `production/_system/config.json` defines `cultivar` as the default for new RUNs. The existing terminal `SUCCESS` status remains sufficient: overall RUN completion and target outcome are separate, and each item `productionPhase` records whether that cultivar reached `PUBLISHED` or remains at an image/data waiting phase. No new `PARTIAL_SUCCESS` enum is required.

Before a new content-production entry may be public, that cultivar independently requires valid formal strain data, valid required source/entity closure, exactly one existing primary visual, current manifest approval with `approvalStatus: approved` and `approvalType: human-visual-review`, approval pinned to the current revision and attempt, exact visual linkage, and cultivar-level validation. `scripts/validate-cultivar-publication.mjs` enforces this gate for every `content-production` entry already marked `published`; grandfathered entries are intentionally excluded so legacy publication is not rolled back by the new rule.

Candidate Build remains read-only before publication changes. Publication state and item phase `PUBLISHED` are distinct records but must agree at the completed gate. Normal runtime generation continues to filter exclusively by `production/publication.json`; `runtime/catalog.json` is never a hand-edited publication switch.

## State machine and RUN records

Item path remains `STOCKED -> DATA_READY -> IMAGE_PENDING -> IMAGE_READY -> VISUAL_LINKED -> PUBLISHED`. Skips are `INVALID_PHASE_TRANSITION`. `NEEDS_REVIEW` is non-public and retains `previousStablePhase`; resume returns to that stable phase. `ABORTED_CONCURRENT_UPDATE` is terminal.

DATA-FIRST means `DATA_READY` is a durable formal-data milestone, not a temporary staging file. IMAGE-LATER means a cultivar may remain at `IMAGE_PENDING` or `NEEDS_REVIEW` with its formal MASTER data intact for as long as necessary. When a later candidate succeeds, processing resumes from the existing data and manifest context rather than repeating cultivar research.

Run statuses remain `ACTIVE`, `WAITING_REPAIR`, `PUBLISHING`, `SUCCESS`, `CANCELLED`, `ABORTED_CONCURRENT_UPDATE`, and `FAILED_AUDIT`. A RUN is not required to publish every target before other eligible targets can publish. Item-level `productionPhase` is the authoritative per-cultivar outcome for the RUN.

Active runs must not share `strainId`, `sourceStockPath`, or `sourceStockBlobSha`. STOCK plus MASTER for the same strain is allowed history and reported as `ALREADY_PROMOTED_STOCK`; the STOCK schema is unchanged and normal promotion selection excludes already-promoted STOCK.

RUN commits are role-separated: `dataCommit`, `imageInboxCommit`, `imageProcessingCommit`, `visualsCommit`, `publicationCommit`, and `buildCommit`. Build-bot commits are not reused as data/visual/image commits. RUN schema also supports Pages deployment fields, final publication set, recovery, and audit summary.

## Image manifests and Inbox guard

Production manifests bind prompt, evidence, and visual metadata (`alt`, `rights`, `scope`, `aiGenerated`, `sourceType`) through canonical JSON SHA-256. Same visual preparation regeneration increments `attempt`; changed preparation increments `revision` and resets attempt to 1. Approval is pinned to both revision and attempt. Stale approval is `STALE_IMAGE_ATTEMPT`.

If `approvedSourceSha256` exists, the Inbox source digest must match it. Otherwise revision/attempt plus inbox/processing commit provenance remain mandatory. Production Inbox filenames and expected primary paths must match the approved manifest exactly. `mode: new-publication` cannot overwrite an existing primary for a strain that was already published at RUN start; that belongs to future `image-replacement` mode.

The formal human upload entry for IMAGE UPLOAD INBOX V1 is the repository-root `UPLOAD_IMAGES_HERE/` directory on `master-migration`. IMAGE UPLOAD INBOX V1 keeps its atomic conversion behavior. Production targets add the manifest allowlist/approval guard. `IMAGE_READY` requires valid RIFF/WEBP, successful decode, positive dimensions, strain/path match, current approved revision/attempt, and traceable inbox/processing commits. `VISUAL_LINKED` requires one primary for CONTENT PRODUCTION-managed strains, correct path/file, and exact visual metadata snapshot. A standard `primary.webp` that exists but is not referenced is `ORPHAN_PRIMARY`.

Inbox conversion may remain atomic for the files submitted in one image-processing batch; that does not create a publication batch lock. Publication eligibility is evaluated per cultivar after image processing and human approval.

## IMAGE PRODUCTION PIPELINE V2 generation and approval policy

The standard image-generation quality is `medium`. `quality = high` is not a default or automatic setting. High quality may be used only for a run where a human explicitly requested high quality. Reused configuration, AI selection, workflow defaults, retries, or automatic escalation must not silently select high quality.

Image generation and production publication are separate operations. The formal gate is: generation complete -> AI visual QA -> human approval -> primary / visuals / runtime reflection. AI visual QA may record PASS, FAIL, scores, or notes, but AI visual QA alone must never set a production-usable approval or advance an item to `IMAGE_READY`, `VISUAL_LINKED`, or `PUBLISHED`.

Until human approval is recorded, generated outputs are candidate artifacts only. They may be retained for comparison and review, but they must not be placed into the production Inbox for processing, promoted to `primary.webp`, linked into `strain.json` visuals, reflected into runtime, or used to open publication.

Production approval requires the current manifest revision and attempt to have `approvalStatus: approved` and `approvalType: human-visual-review`. The source digest remains pinned when available. Both the state helper and publication validator enforce this human approval requirement. An AI PASS with no human approval therefore remains non-public and artifact-only.

Automatic generation is permitted only as candidate generation. Automatic publication is not coupled to generation. Any future generator, retry worker, benchmark, or batch workflow must preserve this boundary and default to `medium` unless an explicit human request selects `high` for that run. The normal production assumption is one cultivar = one candidate; extra candidates are explicit review/retry work rather than an automatic publication shortcut.

## Image backlog

`scripts/list-image-backlog.mjs` is a read-only backlog extractor. It lists formal `content-production` cultivars whose publication state is still `pending`, including their `strainId`, name, production phase, publication state, visuals count, manifest status, and last recorded image-review result. `--json` provides machine-readable output.

The backlog is derived from existing MASTER/publication/RUN/manifest state. It does not create a second database or queue. Grandfathered published cultivars are not placed into this new-production backlog merely because they have `visuals: []`; legacy publication remains unchanged unless a separate explicit repair request is made.

## Recovery, main protection, and write safety

GitHub tree/commit/file reality wins over a stale RUN record. Resume reconstructs the stable phase and records `RECOVERED_FROM_GITHUB_STATE`. Default recovery retains pending publication and completed MASTER/image work, repairs only the failed item, re-audits, then allows that cultivar to publish when its own gate passes. Physical rollback is not the default. Cancelled runs likewise keep artifacts unless they are run-exclusive, unpublished, unreferenced, and clearly erroneous.

A failed or rejected image is an item-level waiting condition, not a reason to delete formal strain data, source data, entity data, or stop publication of unrelated ready cultivars. Heavy Git-history reconstruction and forensic recovery are abnormal-path tools only; the normal path is data save -> image candidate -> human approval -> reflection -> standard validation/build.

A fresh `master-migration` HEAD check is required immediately before writes. One stale-base retry is allowed; the second conflict ends `ABORTED_CONCURRENT_UPDATE`. Force push is forbidden.

CONTENT PRODUCTION has zero main-write path. An external main HEAD change is a warning requiring display verification on the latest main. CONTENT PRODUCTION-originated main writes are `MAIN_WRITE_VIOLATION`; production strain assets found on main are `MAIN_PRODUCTION_ASSET_VIOLATION`, while normal UI/hero assets are excluded from that rule.

Successful Inbox processing leaves only `UPLOAD_IMAGES_HERE/.gitkeep` and `UPLOAD_IMAGES_HERE/README.md`. Failed residual input is not deleted automatically and is reported as `FAILED_INBOX_PENDING`.

## Audit severity and codes

`ERROR` blocks publication, `WARNING` is recorded but may publish, `INFO` is trace-only. Severity lives in `production/_system/config.json`. Implemented codes include: `ORPHAN_PUBLICATION_ENTRY`, `MISSING_PUBLICATION_ENTRY`, `ILLEGAL_PUBLICATION_TRANSITION`, `UNAUTHORIZED_PUBLICATION_OPEN`, `ACTIVE_RUN_CONFLICT`, `ACTIVE_STOCK_CONFLICT`, `INVALID_PHASE_TRANSITION`, `SOURCE_STOCK_CHANGED`, `PRODUCTION_STRAIN_MISSING`, `DUPLICATE_STRAIN_ID`, `CONFIRMED_DUPLICATE_CULTIVAR`, `ALIAS_COLLISION_REVIEW`, `SOURCE_REF_MISSING`, `ENTITY_REF_MISSING`, `SOURCE_ID_CONFLICT`, `SOURCE_URL_DUPLICATE`, `ENTITY_ID_CONFLICT`, `ENTITY_DUPLICATE_REVIEW`, `IMAGE_FILE_MISSING`, `INVALID_WEBP_SIGNATURE`, `IMAGE_DECODE_FAILED`, `INVALID_IMAGE_DIMENSIONS`, `IMAGE_STRAIN_MISMATCH`, `IMAGE_INBOX_COMMIT_MISSING`, `IMAGE_PROCESSING_COMMIT_MISSING`, `IMAGE_MANIFEST_MISMATCH`, `STALE_IMAGE_ATTEMPT`, `IMAGE_DIGEST_MISMATCH`, `BROKEN_PRIMARY_REFERENCE`, `ORPHAN_PRIMARY`, `PRIMARY_COUNT_INVALID`, `VISUAL_METADATA_MISMATCH`, `FAILED_INBOX_PENDING`, `INBOX_WRONG_FILENAME`, `INBOX_UNKNOWN_STRAIN`, `PRODUCTION_IMAGE_OUTSIDE_INBOX`, `MAIN_PRODUCTION_ASSET_VIOLATION`, `MAIN_WRITE_VIOLATION`, `EXISTING_PUBLISHED_PRIMARY_OVERWRITE`, `MASTER_VALIDATION_FAILED`, `CANDIDATE_BUILD_FAILED`, `RUNTIME_TARGET_MISSING`, `RUNTIME_VISUAL_MISMATCH`, `PAGES_DEPLOY_FAILED`, `DISPLAY_VERIFY_FAILED`, `PUBLICATION_SET_MISMATCH`, `STALE_BASE_RETRY`, `ABORTED_CONCURRENT_UPDATE`, `RUN_RECORD_STALE`, `RECOVERED_FROM_GITHUB_STATE`, `UNSUPPORTED_SCHEMA_VERSION`, `EXTERNAL_MAIN_UPDATE`, `ALREADY_PROMOTED_STOCK`, and `IDEMPOTENT_NOOP`.

## Read-only validation and dry run

`node scripts/validate-master-data.mjs` validates all MASTER data, including pending cultivars. `node scripts/validate-cultivar-publication.mjs` checks only the publication gate of new content-production cultivars already marked published and deliberately leaves grandfathered publication alone. `node scripts/audit-content-production.mjs` performs the repository audit without writing files, converting images, committing, or updating refs. `--main-dir=<checked-out-main>` adds main protection checks.

`node scripts/test-data-first-pipeline.mjs` is a zero-production-write regression fixture. It models five targets with two human-approved/linked targets and three image-pending/rejected targets, then invokes the formal runtime builder in read-only override mode. The test requires exactly two runtime cultivars, all five formal MASTER strain files to remain present, the other three to remain out of runtime, and AI-only approval to remain insufficient.

The Build workflow runs MASTER validation, the cultivar-level publication gate, the DATA-FIRST fixture, the image-backlog read-only smoke check, the CONTENT PRODUCTION audit, and the formal publication-filtered runtime build before deployment. Any ERROR in the required gate/audit path stops runtime mutation and deployment; an image-incomplete pending cultivar by itself is not an ERROR and therefore does not block a different ready cultivar.
