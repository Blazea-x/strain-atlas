# IMAGE PRODUCTION PIPELINE V2 — AI Horde Kali Mist PoC

This is an isolated proof of concept, not a production image pipeline. It proves only that the formal Kali Mist image manifest can drive one free asynchronous AI Horde image generation and that the returned image bytes can be validated, SHA-256 identified, and retained as a GitHub Actions artifact.

## Scope and safety boundary

The PoC is hard-coded to `production/manifests/kali-mist.json` and formal run `content-production-20260818T060700Z-01`. It sends exactly one image request with `params.n = 1`. The prompt is read verbatim from `promptSnapshot`; `evidenceSnapshot` is hashed and preserved as provenance context but is not rewritten or expanded. No web research is performed by the workflow.

The workflow has `contents: read` only. It never writes to `strains/`, `production/`, `runtime/`, `UPLOAD_IMAGES_HERE/`, or `main`. Before generation it hashes protected repository content and records the MASTER public ID set. After generation and the existing CONTENT PRODUCTION V1 and MASTER audits, it requires exact protected-content and public-ID equality.

## Trigger choice

The repository default branch is `main`, while the PoC must exist only on `master-migration`. GitHub requires a `workflow_dispatch` workflow file to exist on the default branch before that event can be triggered. Copying this PoC workflow to `main` is therefore intentionally avoided.

The PoC uses a narrowly path-filtered `push` trigger on `master-migration`. The implementation commit itself can trigger the one-time proof. The workflow does not push commits, and `persist-credentials: false` plus `contents: read` prevents it from becoming a repository-writing recursion source. Future unrelated production commits do not match the PoC paths.

## AI Horde use

The PoC uses the public AI Horde v2 endpoints:

- `GET /api/v2/status/heartbeat`
- `GET /api/v2/status/modes`
- `GET /api/v2/status/models?type=image`
- `POST /api/v2/generate/async`
- `GET /api/v2/generate/check/{id}` for polling
- `GET /api/v2/generate/status/{id}` once complete

The anonymous API key is the documented ten-zero key and is embedded because it is explicitly public, not a credential. No repository secret is created. Cost policy is `FREE_ONLY`; there is no paid fallback.

Model selection is live. The script prefers active photorealistic/general-realism models and records the selected model, reason, active-thread/queue metadata, worker identity returned by AI Horde, and the actual model reported by the completed generation. If none of the eligible models has an active worker, it stops with `NO_ELIGIBLE_MODEL`.

## Failure isolation and timeout policy

The job has a 20-minute GitHub Actions timeout. The provider loop has a 10-minute queue timeout and a 15-minute overall generation timeout, polling the lightweight `/check` endpoint every five seconds. Failure codes include `AI_HORDE_UNAVAILABLE`, `NO_ELIGIBLE_MODEL`, `QUEUE_TIMEOUT`, `GENERATION_TIMEOUT`, `PROVIDER_ERROR`, `INVALID_IMAGE_RESPONSE`, `IMAGE_DECODE_FAILED`, and `ARTIFACT_UPLOAD_FAILED`.

A PoC failure does not alter the CONTENT PRODUCTION run, Kali Mist production phase, publication state, manifest approval, visuals, Durban Poison, or Warlock.

## Artifact and cryptographic identity

On success, the artifact contains the image bytes exactly as received, `generation-provenance.json`, and `sha256.txt`. The image SHA-256 is computed from the downloaded image bytes on the GitHub Actions runner, not from a Git blob SHA. The provenance also contains hashes of the exact prompt string, canonical evidence snapshot, and complete manifest file, plus run/revision/attempt, provider generation/job/worker identifiers, requested generation parameters, returned seed when present, byte length, decoded dimensions and format, and GitHub workflow-run identity.

Artifact retention is 14 days. The artifact name includes Kali Mist, manifest revision, attempt, workflow run ID, and run attempt. A rerun is a new PoC generation and remains production-side-effect free.
