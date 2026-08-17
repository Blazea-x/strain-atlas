# IMAGE UPLOAD INBOX V1

Place batch image uploads in this directory on `master-migration`.

Accepted filename pattern: `<strain-id>.jpg`, `<strain-id>.jpeg`, `<strain-id>.png`, or `<strain-id>.webp`.

The filename stem must match an existing `strains/<strain-id>/strain.json`. The workflow processes the whole upload batch atomically, converts every accepted image to `strains/<strain-id>/images/generated/primary.webp`, validates the WebP payload, and removes accepted inbox files in the same automated commit. Duplicate strain IDs or any invalid item fail the run without committing partial outputs.

V1 batch limit: 50 images per run.
