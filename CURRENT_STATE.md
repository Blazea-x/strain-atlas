# CURRENT STATE｜Cannabis Strain Wisdom

Last checked: 2026-08-15
Target specification: `MASTER_CANNABIS_STRAIN_WISDOM.md` (FINAL / FROZEN)
Migration branch: `master-migration`

## Public state

- GitHub Pages remains technically enabled because the current connector cannot change the Pages setting directly.
- `main/index.html` is temporarily a noindex `REBUILDING` screen.
- The previous public cultivar UI is no longer the active production entry point.

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

## Migration decisions

- All four migrated cultivars remain `review`; none were promoted to `published` by automation.
- Legacy Japanese display names were not automatically accepted as verified MASTER `jp` values, so migrated `jp` is currently `null`.
- Claims that lacked claim-level source mapping in the legacy data were retained but marked `unknown` rather than being silently asserted.
- Existing strain images still use legacy paths until the visual asset migration phase.

## Not implemented yet

- Runtime loader that reads the new JSON source of truth
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

## Known cleanup

- `add-strain.yml` targets an obsolete inline STRAINS implementation and must be replaced before automated cultivar addition returns.
- `main` branch is not protected.
- Old CSS layers remain and should not be expanded further while the new component/design-token structure is introduced.

## Next checkpoint

Phase 2 is complete when the site runtime reads the new `strains/`, `sources/`, and `entities/` records instead of `data.js` / `sources.js`, while the four migrated cultivars still render correctly in a migration preview.
