# CURRENT STATE｜Cannabis Strain Wisdom

Last checked: 2026-08-15
Target specification: `MASTER_CANNABIS_STRAIN_WISDOM.md` (FINAL / FROZEN)
Migration branch: `master-migration`

## Current production baseline

- Hosting: GitHub Pages
- Production source: `main` branch root
- Legacy cultivar count: 4
- Legacy cultivar data: `data.js`
- Legacy sources: `sources.js`
- Legacy renderer/search/filter: `app-v2.js`
- Existing validator: `scripts/validate-data.mjs`
- Existing legal gate: `legal-gate.js` / `legal-gate.css`

## Migration status

### In progress

- MASTER-compliant data directory structure
- Cultivar JSON schema and controlled values
- Shared source records
- Shared entity records
- Claim-level evidence metadata
- MASTER-compliant validator

### Not implemented yet

- Final HomeVisual with CULTIVARS / MEDIA / EXPLORE entrances
- MEDIA data and grid
- EXPLORE mapping UI
- Mobile-first 2-column cultivar grid
- Full-screen DetailView
- ImageGallery swipe behavior
- STATUS GRID
- Deep Detail
- Per-cultivar shareable URL and history restoration
- Preview Environment
- Feature flags
- Service Layer

## Legacy compatibility

Legacy files are intentionally retained during migration. The new MASTER structure must validate and render successfully before legacy reads are removed.

## Important known gaps

- `add-strain.yml` targets an older inline `STRAINS` implementation and must not be treated as the current publication pipeline.
- Current `main` branch is not protected.
- Existing cultivar-level confidence must be migrated to claim-level evidence.
- Existing Japanese display names are not automatically treated as verified MASTER `jp` values.
- Existing strain images remain in legacy paths until image migration is performed.

## Next checkpoint

The next checkpoint is complete when all four existing cultivars can be represented in the new MASTER data structure, all source/entity references resolve, and the new validator passes without relying on `data.js` or `sources.js` as the source of truth.
