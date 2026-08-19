#!/usr/bin/env python3
import hashlib
import io
import json
import os
import subprocess
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path.cwd()
REPO = os.environ['GITHUB_REPOSITORY']
TOKEN = os.environ['GH_TOKEN']
ARTIFACT_ID = int(os.environ['ARTIFACT_ID'])
GENERATION_RUN_ID = int(os.environ['GENERATION_RUN_ID'])
EXPECTED_CANDIDATE_SHA256 = os.environ['EXPECTED_CANDIDATE_SHA256']
REPORT_PATH = Path(os.environ.get('PROMOTION_REPORT', '/tmp/dr-grinspoon-promotion-report.json'))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def gh_request(url: str, binary=False):
    headers = {
        'Authorization': f'Bearer {TOKEN}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'strain-atlas-image-production-v2-promotion',
    }
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read() if binary else json.load(response)


def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(value[k]) for k in sorted(value)}
    if isinstance(value, list):
        return [canonical(x) for x in value]
    return value


def visual_hash(prompt, evidence, metadata):
    payload = {'prompt': prompt, 'evidence': evidence, 'metadata': metadata}
    raw = json.dumps(canonical(payload), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return sha256_bytes(raw)


archive_bytes = gh_request(f'https://api.github.com/repos/{REPO}/actions/artifacts/{ARTIFACT_ID}/zip', binary=True)
with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
    names = set(archive.namelist())
    if 'preflight-generation-summary.json' not in names or 'dr-grinspoon__one-shot.jpg' not in names:
        raise SystemExit('SAFE-STOP: expected generation artifact files are missing')
    summary = json.loads(archive.read('preflight-generation-summary.json').decode('utf-8'))
    candidate = archive.read('dr-grinspoon__one-shot.jpg')

if int(summary.get('workflowRunId', -1)) != GENERATION_RUN_ID:
    raise SystemExit('SAFE-STOP: generation workflowRunId mismatch')
if summary.get('preflight', {}).get('dr-grinspoon', {}).get('status') != 'PASS':
    raise SystemExit('SAFE-STOP: Dr Grinspoon preflight not PASS')
if summary.get('preflight', {}).get('malawi', {}).get('status') != 'PASS':
    raise SystemExit('SAFE-STOP: Malawi preflight record missing or failed')
results = {row.get('strainId'): row for row in summary.get('results', [])}
dr_result = results.get('dr-grinspoon', {})
mw_result = results.get('malawi', {})
if dr_result.get('status') != 'success':
    raise SystemExit('SAFE-STOP: Dr Grinspoon candidate generation not successful')
if mw_result.get('status') != 'failed' or mw_result.get('errorClass') != 'APITimeoutError':
    raise SystemExit('SAFE-STOP: Malawi outcome differs from reviewed timeout state')
if int(summary.get('successfulImages', -1)) != 1:
    raise SystemExit('SAFE-STOP: artifact does not contain exactly one successful generated image')

candidate_sha = sha256_bytes(candidate)
if candidate_sha != EXPECTED_CANDIDATE_SHA256 or candidate_sha != dr_result.get('sha256'):
    raise SystemExit('SAFE-STOP: Dr Grinspoon candidate SHA-256 mismatch')
if len(candidate) != int(dr_result.get('byteLength', -1)):
    raise SystemExit('SAFE-STOP: Dr Grinspoon candidate byte length mismatch')

with Image.open(io.BytesIO(candidate)) as image:
    image.verify()
with Image.open(io.BytesIO(candidate)) as image:
    if image.size != (1024, 1024) or image.format != 'JPEG':
        raise SystemExit(f'SAFE-STOP: unexpected Dr Grinspoon source image {image.format} {image.size}')
    final_image = image.convert('RGB')

primary_rel = Path('strains/dr-grinspoon/images/generated/primary.webp')
primary_path = ROOT / primary_rel
primary_path.parent.mkdir(parents=True, exist_ok=True)
final_image.save(primary_path, format='WEBP', quality=92, method=6)
final_bytes = primary_path.read_bytes()
if len(final_bytes) < 12 or final_bytes[:4] != b'RIFF' or final_bytes[8:12] != b'WEBP':
    raise SystemExit('SAFE-STOP: produced Dr Grinspoon primary is not RIFF/WEBP')
with Image.open(primary_path) as check:
    check.verify()
with Image.open(primary_path) as check:
    if check.size != (1024, 1024):
        raise SystemExit('SAFE-STOP: produced Dr Grinspoon WebP dimensions changed')

final_sha256 = sha256_bytes(final_bytes)
blob_sha = subprocess.check_output(['git', 'hash-object', str(primary_rel)], text=True).strip()

visual_metadata = {
    'alt': 'Dr Grinspoonの細長いサティバ株姿と、細い茎・節に沿って疎に分かれたビーズ状の花姿を公式形態情報に基づいて表現したAI生成参考ビジュアル',
    'rights': 'AI-generated project asset for Cannabis Strain Wisdom; prompt derived from cited breeder-official morphology evidence.',
    'scope': 'cultivar',
    'aiGenerated': True,
    'sourceType': 'aiGenerated',
}
visual = {
    'role': 'primary',
    'src': str(primary_rel),
    **visual_metadata,
}

strain_path = ROOT / 'strains/dr-grinspoon/strain.json'
strain = read_json(strain_path)
if strain.get('id') != 'dr-grinspoon' or strain.get('visuals') != []:
    raise SystemExit('SAFE-STOP: Dr Grinspoon strain state changed before promotion')
strain['visuals'] = [visual]
strain['updatedAt'] = '2026-08-19'
write_json(strain_path, strain)

manifest_path = ROOT / 'production/manifests/dr-grinspoon.json'
old_manifest = read_json(manifest_path)
if old_manifest.get('strainId') != 'dr-grinspoon' or old_manifest.get('revision') != 1 or old_manifest.get('reviewStatus') != 'NEEDS_REVIEW':
    raise SystemExit('SAFE-STOP: Dr Grinspoon manifest state changed before promotion')

prompt = summary['preflight']['dr-grinspoon']['prompt']
evidence = [
    {
        'sourceRef': 'barneys-farm-dr-grinspoon',
        'sourceType': 'breederOfficial',
        'description': "Barney's Farm identifies Dr Grinspoon as a pure heirloom 100% Sativa with a tall and thin overall plant structure.",
    },
    {
        'sourceRef': 'barneys-farm-dr-grinspoon',
        'sourceType': 'breederOfficial',
        'description': "Barney's Farm describes mature green to reddish-brown bead-like flowers along thin stems; V2 preflight operationalizes this as separated stem/node-attached cannabis calyx sites to prevent fruit-bunch interpretation without adding a new cultivar claim.",
    },
]
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
run_meta = gh_request(f'https://api.github.com/repos/{REPO}/actions/runs/{GENERATION_RUN_ID}')
generated_at = run_meta.get('created_at') or now

manifest = {
    'schemaVersion': 1,
    'manifestVersion': 1,
    'manifestId': old_manifest['manifestId'],
    'runId': 'image-production-v2-dr-grinspoon-malawi-20260819',
    'strainId': 'dr-grinspoon',
    'revision': 2,
    'attempt': 1,
    'sourceStockPath': old_manifest.get('sourceStockPath'),
    'sourceStockBlobSha': old_manifest.get('sourceStockBlobSha'),
    'visualPreparationHash': visual_hash(prompt, evidence, visual_metadata),
    'generatedFromManifestVersion': 1,
    'promptSnapshot': prompt,
    'evidenceSnapshot': evidence,
    'visualMetadataSnapshot': visual_metadata,
    'expectedInboxFilename': 'dr-grinspoon.jpg',
    'expectedPrimaryPath': str(primary_rel),
    'generatedAt': generated_at,
    'approvalStatus': 'approved',
    'approvedAt': now,
    'approvalType': 'assistant-visual-review',
    'approvedManifestRevision': 2,
    'approvedAttempt': 1,
    'approvedSourceSha256': candidate_sha,
    'imageInboxCommit': None,
    'imageProcessingCommit': None,
    'processedPrimaryBlobSha': blob_sha,
    'processedPrimarySha256': final_sha256,
    'width': 1024,
    'height': 1024,
    'reviewStatus': 'PASS',
    'reviewReason': 'V2 one-shot candidate accepted: tall/slender open cannabis architecture, sparse separated stem/node floral sites, no grape/berry/hanging-bunch interpretation, and overall morphology remains recognizably cannabis.',
    'generation': {
        'provider': 'OpenAI',
        'model': dr_result.get('model'),
        'quality': dr_result.get('quality'),
        'size': dr_result.get('requestedSize'),
        'outputFormat': dr_result.get('outputFormat'),
        'n': dr_result.get('n'),
        'retryPolicy': dr_result.get('retryPolicy'),
        'workflowRunId': GENERATION_RUN_ID,
        'artifactId': ARTIFACT_ID,
        'candidateSha256': candidate_sha,
        'candidateBytes': len(candidate),
        'candidateDimensions': {
            'width': 1024,
            'height': 1024,
            'format': 'JPEG',
        },
        'usage': dr_result.get('usage'),
        'estimatedInputCostUsd': dr_result.get('estimatedInputCostUsd'),
        'estimatedOutputCostUsd': dr_result.get('estimatedOutputCostUsd'),
        'additionalOpenAiCostUsd': dr_result.get('estimatedCostUsd'),
    },
    'previousGeneration': old_manifest.get('generation'),
    'audit': [
        *(old_manifest.get('audit') or []),
        {
            'at': now,
            'action': 'PROMPT_PREFLIGHT',
            'status': 'PASS',
            'note': "Prior wording coupled 'bead-like', 'clusters', and 'hang loosely', which encouraged a berry/grape-bunch reading. V2 rewrote the morphology by attachment/distribution: separated individual cannabis calyxes at stems/nodes, exposed stem segments and visible pistils; negative constraints explicitly removed grapes, berries, fruit clusters, hanging bunches, pendulous racemes, hop-like cones and catkins.",
        },
        {
            'at': now,
            'action': 'OPENAI_ONE_SHOT_GENERATION',
            'status': 'success',
            'note': f'Exactly one Dr Grinspoon candidate was returned from gpt-image-2 high at 1024x1024. SHA-256 {candidate_sha}. No retry was used.',
        },
        {
            'at': now,
            'action': 'VISUAL_QA_REVIEW',
            'status': 'PASS',
            'note': 'Assistant visual inspection accepted the candidate: tall/slender cannabis silhouette and sparse separated flower sites are readable without fruit-cluster or ornamental-plant interpretation.',
        },
        {
            'at': now,
            'action': 'IMAGE_PRODUCTION_V2_DIRECT_PROMOTION',
            'status': 'prepared',
            'note': 'Converted the approved one-shot Actions artifact directly to the formal WebP primary. IMAGE UPLOAD INBOX V1 was not used for this controlled V2 artifact promotion; imageInboxCommit is intentionally null.',
        },
    ],
}
write_json(manifest_path, manifest)

report = {
    'strainId': 'dr-grinspoon',
    'reviewDecision': 'PASS',
    'candidate': {
        'sha256': candidate_sha,
        'bytes': len(candidate),
        'width': 1024,
        'height': 1024,
        'estimatedCostUsd': dr_result.get('estimatedCostUsd'),
    },
    'primary': {
        'path': str(primary_rel),
        'sha256': final_sha256,
        'gitBlobSha': blob_sha,
        'bytes': len(final_bytes),
        'width': 1024,
        'height': 1024,
    },
    'malawi': {
        'generationStatus': mw_result.get('status'),
        'errorClass': mw_result.get('errorClass'),
        'reflected': False,
    },
}
write_json(REPORT_PATH, report)
print(json.dumps(report, ensure_ascii=False))
