# ONE-CLICK PRODUCTION V1

Manual START promotes eligible AUTO STOCK V1 candidates data-first, creates pending cultivar publication records and image manifests, optionally generates at most one OpenAI gpt-image-2 medium candidate per eligible cultivar, applies AI visual QA only as a first-pass filter, writes a review artifact, and stops before publication.

Manual APPROVE accepts review-package approval tokens bound to productionRunId, strainId, manifest revision, attempt, and candidate SHA-256. Only explicitly human-approved cultivars can receive primary.webp, visuals linkage, cultivar-level publication, runtime rebuild, and final batched validation/audit.

Unapproved or failed cultivars retain formal data in IMAGE_PENDING / NEEDS_REVIEW backlog state and do not block other cultivars. Missing required morphology references safe-stop before any paid generation. Image API retries are disabled. BASE_SHA write conflict retry is capped at one. main and runtime source files are never manually edited by START.

Reference metadata is morphology-only and may record sourceRef, referenceUrl or assetRef, purpose=morphology, rightsUsageNote, and checkedAt. References guide plant architecture, flower attachment/calyx structure, leaf morphology, and overall silhouette; they are not copy targets.
