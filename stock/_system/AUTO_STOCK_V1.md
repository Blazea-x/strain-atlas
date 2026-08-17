# AUTO STOCK V1

## Purpose

AUTO STOCK V1 is a quarantined stock-building system for Cannabis Strains Wisdom. It prepares researched candidate strain data without modifying production data. V1 writes only below `stock/**`; it does not publish strains and it does not create images.

## Immutable production boundary

The production branch for data work is `master-migration`. `main` is protected and must not change during an AUTO STOCK run. The following locations are read-only to AUTO STOCK V1: `strains/**`, `sources/**`, `entities/**`, `runtime/**`, `data.js`, `sources.js`, `schemas/**`, `scripts/**`, `.github/workflows/**`, public UI files, and all existing images.

A successful run may change only `stock/**`. Any BASE-to-END diff containing even one path outside `stock/**` is not SUCCESS.

## Layout

System files live in `stock/_system/**`. Candidate packages live as `stock/items/<stock-id>.json` and must conform to `stock-item.schema.json`. Run records live as `stock/runs/<run-id>/run.json` and must conform to `run.schema.json`. Empty directories are not required in Git; they are created naturally when the first real stock item or run record is written.

A stock item is an isolated package containing the candidate strain payload, proposed source payloads, proposed entity payloads, confidence grades, duplicate-check evidence, and `visuals: []`. It is not a production `strains/<id>/strain.json` and must never be interpreted as published data.

## V1 run size and images

A normal AUTO STOCK V1 run prepares up to three candidate items. V1 does not generate, download, or store images. Every stock item therefore carries `visuals: []`. Image work is a later, separate phase.

## Research and confidence

Each candidate is researched from current external information, prioritizing official/primary material and then strong specialist sources. LINEAGE, HISTORY, AROMA, and TERPENE claims each carry one of `A`, `B`, `C`, or `unknown`, with a written basis and supporting source IDs where available. Unsupported certainty is prohibited.

## Duplicate and conflict policy

Duplicate checks cover both production data and all existing STOCK. Strain candidates are checked by ID and canonical name. Sources are checked by ID and URL. Entities are checked by ID and canonical name.

A true duplicate is not copied indefinitely into STOCK. If the same ID already exists but the proposed content conflicts with production or another STOCK item, AUTO STOCK must not overwrite it automatically. The affected item/run becomes `NEEDS_REVIEW` and records the matched path and reason.

## Transaction rule

One AUTO STOCK run is one Git transaction: prepare all files first, create blobs, create one tree based on the fixed BASE tree, create one commit whose parent is BASE_SHA, and update the `master-migration` ref exactly once. Force ref updates are forbidden.

No per-file commits are allowed. A stale attempt is never committed by itself.

## BASE_SHA concurrency guard

At run start, fetch the latest `master-migration` HEAD and freeze it as BASE_SHA. Immediately before any ref update, fetch `master-migration` HEAD again.

If the HEAD still equals BASE_SHA, the transaction may proceed. If it differs on the first attempt, discard that prepared transaction and retry automatically once from the new HEAD. Record the discarded attempt in the eventual successful `run.json.previousAttempts` with at least the old BASE_SHA, check time, `STALE_BASE_RETRY`, and failure reason.

If the second attempt also finds a changed HEAD, stop with `ABORTED_CONCURRENT_UPDATE`. Do not write STOCK and do not create a GitHub commit for that run. Report the abort in chat only.

## Run record

A successful or reviewable committed run stores one final `run.json`. `previousAttempts` contains at most one stale first attempt. The run record captures BASE/END SHAs, main HEAD start/end, item paths, the one-commit/one-ref-update transaction facts, and final audit results.

`ABORTED_CONCURRENT_UPDATE` is a valid logical status but, by design, a second-conflict abort is not written to GitHub.

## Pre-commit audit

Before creating the commit, inspect the prepared tree/diff. Every intended changed path must begin with `stock/`. Any protected path makes the transaction invalid and it must not be committed.

`guard.mjs precommit <BASE_SHA> [HEAD]` provides a local equivalent for checkout-based validation.

## Post-write audit

After the ref update, re-fetch GitHub rather than trusting the prepared tree. Confirm all of the following:

1. `master-migration` HEAD changed from BASE_SHA to END_SHA.
2. GitHub BASE_SHA-to-END_SHA comparison reports every changed file under `stock/**` and no file outside it.
3. The `strains`, `sources`, `entities`, `runtime`, and `.github/workflows` trees are unchanged.
4. `data.js` and `sources.js` blob SHAs are unchanged.
5. Existing strain count and IDs are unchanged.
6. Existing strain/source/entity/image content is unchanged.
7. `main` HEAD at end exactly equals `main` HEAD at start.

If any condition fails, the run must not be labelled SUCCESS. Use `FAILED_AUDIT` for a committed run whose final audit fails.

## Guard utility

`guard.mjs` uses Node.js built-ins plus the local Git CLI when a checkout is available. It has three commands: `precommit` verifies that a BASE-to-HEAD diff is only `stock/**`; `postaudit` verifies BASE-to-END scope, protected tree/blob equality, and main HEAD equality; `duplicates` scans production and STOCK IDs for conflicts that require review.

The GitHub-connected execution path must still perform the authoritative remote HEAD checks and remote BASE-to-END comparison. The local guard is defense-in-depth, not a substitute for GitHub re-fetching.

## System implementation boundary

Installing AUTO STOCK V1 consists only of the files in `stock/_system/**`. Installation must not create real stock items, real source/entity proposals, strain records, images, or run records. The first actual AUTO STOCK run is a separate operation.
