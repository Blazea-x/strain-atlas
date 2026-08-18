# CONTENT PRODUCTION V1

CONTENT PRODUCTION V1 is the control layer between AUTO STOCK V1, MASTER data, IMAGE UPLOAD INBOX V1, runtime generation, and the main UI shell. It does not replace those systems. `strains/`, `sources/`, and `entities/` remain MASTER truth. `runtime/`, `data.js`, and `sources.js` are generated. CONTENT PRODUCTION never writes `main`.

## Publication

`production/publication.json` is the publication-control source of truth. Every MASTER strain must have exactly one entry. Bootstrap entries are generated from the implementation-time public `runtime/catalog.json` set, marked `published` / `grandfathered`, with `introducedByRun: null` and `publishedAt: null`. Historical publication timestamps are never guessed. Missing or orphan entries are blocking errors and ID renames never auto-follow.

Normal Build includes only `state: published` strains. Public `sources` are the nested `sourceRefs` closure of published strains and public `entities` are the relation-entity closure. MASTER validation still validates every pending/published strain and every MASTER source/entity.

New CONTENT PRODUCTION strains enter MASTER with a `pending` publication entry. V1 policy is `batch`: all target items must be publish-ready before any pending target becomes published. Candidate build must run in memory/read-only before opening the gate. Publication state and item phase `PUBLISHED` are distinct; item `PUBLISHED` is only reached after validation, normal Build, runtime target/visual verification, Pages deployment, and display verification.

## State machine and RUN records

Item path: `STOCKED -> DATA_READY -> IMAGE_PENDING -> IMAGE_READY -> VISUAL_LINKED -> PUBLISHED`. Skips are `INVALID_PHASE_TRANSITION`. `NEEDS_REVIEW` is non-public and retains `previousStablePhase`; resume returns to that stable phase. `ABORTED_CONCURRENT_UPDATE` is terminal. Run statuses are `ACTIVE`, `WAITING_REPAIR`, `PUBLISHING`, `SUCCESS`, `CANCELLED`, `ABORTED_CONCURRENT_UPDATE`, and `FAILED_AUDIT`.

Active runs must not share `strainId`, `sourceStockPath`, or `sourceStockBlobSha`. STOCK plus MASTER for the same strain is allowed history and reported as `ALREADY_PROMOTED_STOCK`; the STOCK schema is unchanged and normal promotion selection excludes already-promoted STOCK.

RUN commits are role-separated: `dataCommit`, `imageInboxCommit`, `imageProcessingCommit`, `visualsCommit`, `publicationCommit`, and `buildCommit`. Build-bot commits are not reused as data/visual/image commits. RUN schema also supports Pages deployment fields, final publication set, recovery, and audit summary.

## Image manifests and Inbox guard

Production manifests bind prompt, evidence, and visual metadata (`alt`, `rights`, `scope`, `aiGenerated`, `sourceType`) through canonical JSON SHA-256. Same visual preparation regeneration increments `attempt`; changed preparation increments `revision` and resets attempt to 1. Approval is pinned to both revision and attempt. Stale approval is `STALE_IMAGE_ATTEMPT`.

If `approvedSourceSha256` exists, the Inbox source digest must match it. Otherwise revision/attempt plus inbox/processing commit provenance remain mandatory. Production Inbox filenames and expected primary paths must match the approved manifest exactly. `mode: new-publication` cannot overwrite an existing primary for a strain that was already published at RUN start; that belongs to future `image-replacement` mode.

IMAGE UPLOAD INBOX V1 keeps its atomic conversion behavior. Production targets add the manifest allowlist/approval guard. `IMAGE_READY` requires valid RIFF/WEBP, successful decode, positive dimensions, strain/path match, current approved revision/attempt, and traceable inbox/processing commits. `VISUAL_LINKED` requires one primary for CONTENT PRODUCTION-managed strains, correct path/file, and exact visual metadata snapshot. A standard `primary.webp` that exists but is not referenced is `ORPHAN_PRIMARY`.

## Recovery, main protection, and write safety

GitHub tree/commit/file reality wins over a stale RUN record. Resume reconstructs the stable phase and records `RECOVERED_FROM_GITHUB_STATE`. Default recovery retains pending publication and completed MASTER/image work, repairs the failed item, re-audits, then publishes. Physical rollback is not the default. Cancelled runs likewise keep artifacts unless they are run-exclusive, unpublished, unreferenced, and clearly erroneous.

A fresh `master-migration` HEAD check is required immediately before writes. One stale-base retry is allowed; the second conflict ends `ABORTED_CONCURRENT_UPDATE`. Force push is forbidden.

CONTENT PRODUCTION has zero main-write path. An external main HEAD change is a warning requiring display verification on the latest main. CONTENT PRODUCTION-originated main writes are `MAIN_WRITE_VIOLATION`; production strain assets found on main are `MAIN_PRODUCTION_ASSET_VIOLATION`, while normal UI/hero assets are excluded from that rule.

Successful Inbox processing leaves only `.gitkeep`. Failed residual input is not deleted automatically and is reported as `FAILED_INBOX_PENDING`.

## Audit severity and codes

`ERROR` blocks publication, `WARNING` is recorded but may publish, `INFO` is trace-only. Severity lives in `production/_system/config.json`. Implemented codes include: `ORPHAN_PUBLICATION_ENTRY`, `MISSING_PUBLICATION_ENTRY`, `ILLEGAL_PUBLICATION_TRANSITION`, `UNAUTHORIZED_PUBLICATION_OPEN`, `ACTIVE_RUN_CONFLICT`, `ACTIVE_STOCK_CONFLICT`, `INVALID_PHASE_TRANSITION`, `SOURCE_STOCK_CHANGED`, `PRODUCTION_STRAIN_MISSING`, `DUPLICATE_STRAIN_ID`, `CONFIRMED_DUPLICATE_CULTIVAR`, `ALIAS_COLLISION_REVIEW`, `SOURCE_REF_MISSING`, `ENTITY_REF_MISSING`, `SOURCE_ID_CONFLICT`, `SOURCE_URL_DUPLICATE`, `ENTITY_ID_CONFLICT`, `ENTITY_DUPLICATE_REVIEW`, `IMAGE_FILE_MISSING`, `INVALID_WEBP_SIGNATURE`, `IMAGE_DECODE_FAILED`, `INVALID_IMAGE_DIMENSIONS`, `IMAGE_STRAIN_MISMATCH`, `IMAGE_INBOX_COMMIT_MISSING`, `IMAGE_PROCESSING_COMMIT_MISSING`, `IMAGE_MANIFEST_MISMATCH`, `STALE_IMAGE_ATTEMPT`, `IMAGE_DIGEST_MISMATCH`, `BROKEN_PRIMARY_REFERENCE`, `ORPHAN_PRIMARY`, `PRIMARY_COUNT_INVALID`, `VISUAL_METADATA_MISMATCH`, `FAILED_INBOX_PENDING`, `INBOX_WRONG_FILENAME`, `INBOX_UNKNOWN_STRAIN`, `PRODUCTION_IMAGE_OUTSIDE_INBOX`, `MAIN_PRODUCTION_ASSET_VIOLATION`, `MAIN_WRITE_VIOLATION`, `EXISTING_PUBLISHED_PRIMARY_OVERWRITE`, `MASTER_VALIDATION_FAILED`, `CANDIDATE_BUILD_FAILED`, `RUNTIME_TARGET_MISSING`, `RUNTIME_VISUAL_MISMATCH`, `PAGES_DEPLOY_FAILED`, `DISPLAY_VERIFY_FAILED`, `PUBLICATION_SET_MISMATCH`, `STALE_BASE_RETRY`, `ABORTED_CONCURRENT_UPDATE`, `RUN_RECORD_STALE`, `RECOVERED_FROM_GITHUB_STATE`, `UNSUPPORTED_SCHEMA_VERSION`, `EXTERNAL_MAIN_UPDATE`, `ALREADY_PROMOTED_STOCK`, and `IDEMPOTENT_NOOP`.

## Read-only dry run

`node scripts/audit-content-production.mjs` performs the repository audit without writing files, converting images, committing, or updating refs. `--main-dir=<checked-out-main>` adds main protection checks. It reports current runtime, MASTER, grandfather publication and STOCK sets, STOCK/MASTER overlap, publication consistency, source/entity references and duplicates, alias review, Inbox residue, primary linkage, and exact current-runtime versus publication-filtered-candidate differences. The Build workflow runs this audit before generation; any ERROR stops runtime mutation and deployment.
