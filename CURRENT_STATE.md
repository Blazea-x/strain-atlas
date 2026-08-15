# CURRENT STATE｜Cannabis Strain Wisdom

Last checked: 2026-08-15
Target specification: `MASTER_CANNABIS_STRAIN_WISDOM.md` (FINAL / FROZEN)
Migration branch: `master-migration`

## Public state

- GitHub Pages remains technically enabled because the current connector cannot change the Pages setting directly.
- `main/index.html` is temporarily a noindex `REBUILDING` screen.
- The previous public cultivar UI is no longer the active production entry point.
- `.nojekyll` is enabled so GitHub Pages serves this project as a plain static site.
- A noindex migration preview exists at `/preview/`; it is not linked from the rebuilding home screen.

## Legacy baseline retained

- Legacy cultivar count: 4
- Legacy cultivar data: `data.js`
- Legacy sources: `sources.js`
- Legacy renderer/search/filter: `app-v2.js`
- Existing validator: `scripts/validate-data.mjs`
- Existing legal gate: `legal-gate.js` / `legal-gate.css`

Legacy files remain during migration and are not the new source of truth.

## MASTER migration completed in Phase 1

- `schemas/cultivar.schema.json`
- `schemas/source.schema.json`
- `schemas/entity.schema.json`
- 4 cultivar records under `strains/<id>/strain.json`
- 8 shared source records under `sources/`
- 4 shared entity records under `entities/`
- MASTER controlled TYPE / generation / status / confidence / basis / role values
- Claim-level evidence metadata
- Primary visual requirement and visual scope metadata
- `scripts/validate-master-data.mjs`
- `.github/workflows/validate-master-data.yml`
- Initial MASTER validator run: PASS

## MASTER migration completed in Phase 2

- `scripts/build-runtime-data.mjs` generates the display catalog from MASTER source records.
- `.github/workflows/build-runtime-data.yml` validates source records, builds `runtime/catalog.json`, and commits the generated catalog automatically.
- `runtime/catalog.json` now contains 4 cultivars / 8 sources / 4 entities without reading legacy `data.js` or `sources.js`.
- EXPLORE mapping is generated from the MASTER TYPE mapping: SATIVA系 1 / INDICA系 1 / HYBRID 2 / unclassified 0.
- The migration preview reads `runtime/catalog.json` from the `master-migration` branch and does not load legacy cultivar/source JavaScript.
- Preview includes unified search, MASTER EXPLORE type filtering, mobile-first 2-column cultivar tiles, basic full-screen detail, STATUS-style grid, source links, per-cultivar query URL, and list scroll restoration.
- Final GitHub Pages static build after `.nojekyll`: PASS.

## Migration decisions

- All four migrated cultivars remain `review`; none were promoted to `published` by automation.
- Legacy Japanese display names were not automatically accepted as verified MASTER `jp` values, so migrated `jp` is currently `null`.
- Claims that lacked claim-level source mapping in the legacy data were retained but marked `unknown` rather than being silently asserted.
- Existing strain images still use legacy paths until the visual asset migration phase.
- `runtime/catalog.json` is generated output. The source of truth remains `strains/`, `sources/`, and `entities/`.

## Not implemented yet

- Final HomeVisual with semantic CULTIVARS / MEDIA / EXPLORE entrances
- MEDIA schema/data and MediaTile grid
- Final ContentGrid / StrainTile component boundary
- Final ImageGallery horizontal swipe behavior
- Final STATUS GRID visual hierarchy
- Deep Detail open/close treatment
- Production-ready per-cultivar URL routing and browser-history behavior
- Dedicated Preview deployment automation
- Feature flags
- Service Layer

## Known cleanup

- `add-strain.yml` targets an obsolete inline STRAINS implementation and must be replaced before automated cultivar addition returns.
- `main` branch is not protected.
- Old CSS layers remain and should not be expanded further while the new component/design-token structure is introduced.
- The current preview fetches migration data from the raw `master-migration` branch; production will switch to same-branch relative runtime data after approval.

## Next checkpoint

Phase 3 is complete when the migration preview follows the MASTER home flow: legal warning → HomeVisual → semantic CULTIVARS / MEDIA / EXPLORE entrances, with CULTIVARS and EXPLORE using the shared runtime data and MEDIA structurally reserved without mixing with cultivar records.
