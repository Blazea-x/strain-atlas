#!/usr/bin/env python3
import os
import io
import json
import base64
import hashlib
import time
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image

OUT = Path(os.environ['OUT']).resolve()
OUT.mkdir(parents=True, exist_ok=True)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def gh_json(url):
    headers = {
        'Authorization': f"Bearer {os.environ['GH_TOKEN']}",
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'strain-atlas-image-production-v2',
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def gh_bytes(url):
    headers = {
        'Authorization': f"Bearer {os.environ['GH_TOKEN']}",
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'strain-atlas-image-production-v2',
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


publication = read_json('production/publication.json')
pub = {x['strainId']: x['state'] for x in publication['entries']}
dr = read_json('strains/dr-grinspoon/strain.json')
mw = read_json('strains/malawi/strain.json')
dr_manifest = read_json('production/manifests/dr-grinspoon.json')
dr_source = read_json('sources/barneys-farm-dr-grinspoon.json')
mw_source = read_json('sources/ace-seeds-malawi.json')
mw_seedfinder = read_json('sources/seedfinder-malawi.json')
dr_entity = read_json('entities/barneys-farm.json')
mw_entity = read_json('entities/ace-seeds.json')
runtime = read_json('runtime/catalog.json')
runtime_by_id = {x['id']: x for x in runtime['cultivars']}

broken_path = Path('strains/malawi/images/generated/primary.webp')
broken_bytes = broken_path.read_bytes() if broken_path.is_file() else b''
broken_signature = len(broken_bytes) >= 12 and broken_bytes[:4] == b'RIFF' and broken_bytes[8:12] == b'WEBP'

checks = {
    'drId': dr.get('id') == 'dr-grinspoon',
    'drPublished': pub.get('dr-grinspoon') == 'published',
    'drVisualsEmpty': dr.get('visuals') == [],
    'drManifestMatches': dr_manifest.get('strainId') == 'dr-grinspoon',
    'drPriorReviewNeedsReview': dr_manifest.get('reviewStatus') == 'NEEDS_REVIEW',
    'drPriorFailureRecorded': ('berry' in str(dr_manifest.get('reviewReason', '')).lower() or 'grape' in str(dr_manifest.get('reviewReason', '')).lower()),
    'drSourceFormal': dr_source.get('id') == 'barneys-farm-dr-grinspoon',
    'drEntityFormal': dr_entity.get('id') == 'barneys-farm',
    'drRuntimePresent': 'dr-grinspoon' in runtime_by_id,
    'mwId': mw.get('id') == 'malawi',
    'mwPublished': pub.get('malawi') == 'published',
    'mwSinglePrimary': len([v for v in mw.get('visuals', []) if v.get('role') == 'primary']) == 1,
    'mwPrimaryPathExpected': any(v.get('role') == 'primary' and v.get('src') == 'strains/malawi/images/generated/primary.webp' for v in mw.get('visuals', [])),
    'mwBrokenPrimaryExists': broken_path.is_file(),
    'mwBrokenPrimaryConfirmed': broken_path.is_file() and not broken_signature,
    'mwSourceFormal': mw_source.get('id') == 'ace-seeds-malawi',
    'mwIndependentSourceFormal': mw_seedfinder.get('id') == 'seedfinder-malawi',
    'mwEntityFormal': mw_entity.get('id') == 'ace-seeds',
    'mwRuntimePresent': 'malawi' in runtime_by_id,
}

dr_prompt = '''1. CULTIVAR IDENTITY
Photorealistic botanical documentary photograph of one mature living female Dr Grinspoon cannabis plant. Pure heirloom 100% Sativa. The plant must remain unmistakably cannabis.

2. PLANT ARCHITECTURE
Tall and thin overall plant architecture with slender stems and an open, delicate structure. Keep enough of the complete plant visible to read the vertical architecture and thin branching stems clearly.

3. FLOWER STRUCTURE / DISTRIBUTION
Show small individual cannabis calyxes as sparse, separated floral sites attached close along thin stems and at stem nodes. Leave clearly visible exposed stem segments between floral sites. Visible cannabis pistils should emerge from individual calyxes. Mature floral sites can show green to reddish-brown coloration. The unusual bead-like impression must come from separated individual cannabis calyxes following the stems, never from a separate hanging bunch or a fruit-like cluster.

4. LEAF MORPHOLOGY
Use realistic mature sativa cannabis foliage consistent with the 100% Sativa identity. Keep foliage botanically plausible and secondary enough that the unusual stem-borne floral pattern remains readable.

5. OVERALL SILHOUETTE
Tall, slender, open and lightly built rather than squat, dense or bushy. Preserve visible negative space between branches and flower sites.

6. BOTANICAL DISTINCTIVE FEATURES
The defining feature is the unusual compact green and reddish-brown bead-like cannabis flower impression along thin stems, while each unit still reads as cannabis calyx tissue with pistils. It must look unusual but botanically credible, never like an ornamental or fruiting plant.

7. COMPOSITION / CAMERA
One plant only. Single continuous photographic frame. Frame the complete plant or nearly complete plant, not a macro bud close-up. Neutral documentary camera perspective with enough detail to inspect calyxes, pistils, stems, branching and overall architecture.

8. LIGHTING / BACKGROUND
Natural photographic lighting, neutral non-distracting horticultural or botanical-reference background, realistic color and depth. No dramatic fantasy grading.

9. NEGATIVE CONSTRAINTS
No grapes, no berries, no fruit clusters, no hanging bunches, no pendulous racemes, no hop-like cones, no catkins, no non-cannabis fruits. No dense chunky indica-style colas. No fantasy plant, ornamental flowers, male pollen sacs, duplicated branches, impossible branching, fused or deformed leaves, plastic/CGI appearance, illustration, painting, collage, split frame, text, labels, watermark, hands, jars, smoke or harvested buds.'''

mw_prompt = '''1. CULTIVAR IDENTITY
Photorealistic botanical documentary photograph of one mature living female Malawi cannabis plant representing the ACE Seeds Malawi P4 landrace line from Malawi, Central Africa, identified as 100% Sativa and derived from Old Malawi Killer x 3rd generation Malawis.

2. PLANT ARCHITECTURE
Show a sativa structure with medium node length and strong branching. The branching architecture must be clearly readable rather than hidden by a close crop.

3. FLOWER STRUCTURE / DISTRIBUTION
Show mature dense cannabis flowers distributed naturally on the strongly branched plant. Flowers must retain realistic cannabis calyx and pistil anatomy. Make the heavy resin expression visible through conspicuous, large glandular trichomes without turning the flowers into crystalline fantasy objects.

4. LEAF MORPHOLOGY
Use natural, botanically plausible mature cannabis sativa foliage. The formal Malawi source does not specify a cultivar-specific leaflet width, so do not invent an extreme narrow-leaf or broad-leaf trait, unusual coloration, mutation or decorative leaf form.

5. OVERALL SILHOUETTE
A clearly branched 100% sativa silhouette with medium internodal spacing and enough open structure to see the branch network, balanced with the source-described dense mature flowers.

6. BOTANICAL DISTINCTIVE FEATURES
Prioritize the combination of strong branching, medium node length, dense flowers and conspicuous resin/trichome development. Keep all structures recognizably cannabis and physically plausible.

7. COMPOSITION / CAMERA
One plant only. Single continuous photographic frame. Show the complete plant or enough of the complete flowering architecture for use as a primary botanical reference visual. No isolated harvested bud macro.

8. LIGHTING / BACKGROUND
Natural neutral photographic lighting and a non-distracting botanical or horticultural background. Realistic color, texture and depth.

9. NEGATIVE CONSTRAINTS
No fantasy cannabis, no ornamental flowers, no fruit, no berries, no non-cannabis flower structures, no squat compact indica-dominant silhouette, no invented purple coloration, no male pollen sacs, no duplicated branches, impossible branching, fused or deformed leaves, plastic/CGI appearance, illustration, painting, collage, split frame, text, labels, watermark, hands, jars, smoke or harvested buds.'''

preflight = {
    'dr-grinspoon': {
        'status': 'PASS' if all(v for k, v in checks.items() if k.startswith('dr')) else 'FAIL',
        'prompt': dr_prompt,
        'sourceIds': ['barneys-farm-dr-grinspoon'],
        'revisionNote': "Prior wording coupled 'bead-like', 'clusters', and 'hang loosely', encouraging a grape/berry bunch interpretation. Revised wording locates separated individual cannabis calyxes along stems and nodes, preserves exposed stem segments and visible cannabis pistils, and forbids fruit/bunch/raceme interpretations.",
    },
    'malawi': {
        'status': 'PASS' if all(v for k, v in checks.items() if k.startswith('mw')) else 'FAIL',
        'prompt': mw_prompt,
        'sourceIds': ['ace-seeds-malawi', 'seedfinder-malawi'],
        'revisionNote': 'Existing primary.webp is treated only as a broken byte object and is not used as visual reference. Prompt is rebuilt from formal source-backed identity and ACE Seeds morphology: 100% sativa, medium node length, strong branching, dense flowers and conspicuous trichomes. No unsupported cultivar-specific leaflet width is added.',
        'brokenPrimary': {
            'path': str(broken_path),
            'byteLength': len(broken_bytes),
            'gitBlobSha': '462e60b566b1fe6afd5b4e0e2d8df72b8beb2cec',
            'sha256': sha256(broken_bytes) if broken_bytes else None,
            'hasValidWebpSignature': broken_signature,
        }
    }
}

print('DR GRINSPOON PROMPT PREFLIGHT:', preflight['dr-grinspoon']['status'])
print('MALAWI PROMPT PREFLIGHT:', preflight['malawi']['status'])

# Duplicate-generation guard. If the original connector push created any run,
# never initiate a second OpenAI call. Reuse only an existing artifact.
repo = os.environ['GITHUB_REPOSITORY']
original_sha = os.environ.get('ORIGINAL_PUSH_SHA', '639f6087c796ac61787682aff377850165fb1e55')
workflow_file = os.environ.get('WORKFLOW_FILE', 'image-production-v2-dr-grinspoon-malawi-preflight.yml')
existing_run = None
try:
    runs = gh_json(f'https://api.github.com/repos/{repo}/actions/workflows/{workflow_file}/runs?event=push&per_page=100')
    matches = [r for r in runs.get('workflow_runs', []) if r.get('head_sha') == original_sha]
    if matches:
        existing_run = sorted(matches, key=lambda x: x['id'], reverse=True)[0]
except Exception:
    existing_run = {'id': None, 'status': 'unknown', 'conclusion': 'GUARD_QUERY_FAILED'}

prior_guard = None
if existing_run:
    prior_guard = {
        'runId': existing_run.get('id'),
        'status': existing_run.get('status'),
        'conclusion': existing_run.get('conclusion'),
        'headSha': original_sha,
        'decision': 'NO_NEW_OPENAI_REQUEST',
    }
    run_id = existing_run.get('id')
    if run_id:
        for _ in range(45):
            current = gh_json(f'https://api.github.com/repos/{repo}/actions/runs/{run_id}')
            prior_guard['status'] = current.get('status')
            prior_guard['conclusion'] = current.get('conclusion')
            if current.get('status') == 'completed':
                break
            time.sleep(10)
        arts = gh_json(f'https://api.github.com/repos/{repo}/actions/runs/{run_id}/artifacts')
        live = [a for a in arts.get('artifacts', []) if not a.get('expired') and a.get('name', '').startswith('image-production-v2-dr-grinspoon-malawi-')]
        if live:
            payload = gh_bytes(live[0]['archive_download_url'])
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for name in archive.namelist():
                    p = Path(name)
                    if p.is_absolute() or '..' in p.parts or name.endswith('/'):
                        continue
                    (OUT / p.name).write_bytes(archive.read(name))
            print('REUSED PRIOR ONE-SHOT ARTIFACT: YES')
            print('NO NEW OPENAI REQUEST SENT')
            raise SystemExit(0)

    summary = {
        'pipeline': 'IMAGE PRODUCTION PIPELINE V2 PROMPT PREFLIGHT ONE-SHOT',
        'sourceCommit': os.environ.get('MASTER_SOURCE_SHA'),
        'workflowRunId': int(os.environ['GITHUB_RUN_ID']),
        'checks': checks,
        'preflight': preflight,
        'priorRunGuard': prior_guard,
        'results': [],
        'successfulImages': 0,
        'estimatedTotalCostUsd': 0.0,
        'productionMutationCount': 0,
        'mainMutationCount': 0,
        'humanVisualReview': 'REQUIRED',
        'productionPromotion': 'NOT PERFORMED',
        'safeStopReason': 'A prior push workflow run exists or cannot be ruled out, but no reusable artifact was available. No new OpenAI request was sent.',
    }
    (OUT / 'preflight-generation-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('OPENAI_API_KEY: NOT READ DUE TO DUPLICATE-GENERATION GUARD')
    raise SystemExit(0)

secret_configured = bool(os.environ.get('OPENAI_API_KEY', '').strip())
print('OPENAI_API_KEY: CONFIGURED' if secret_configured else 'OPENAI_API_KEY: NOT CONFIGURED')

results = []
model = 'gpt-image-2'
quality = 'high'
size = '1024x1024'
output_format = 'jpeg'
text_input_usd_per_million = 5.0
image_output_usd_per_million = 30.0
fallback_output_usd = 0.133

if secret_configured and all(x['status'] == 'PASS' for x in preflight.values()):
    from openai import OpenAI
    client = OpenAI(max_retries=0, timeout=180.0)
    for strain_id, prompt in [('dr-grinspoon', dr_prompt), ('malawi', mw_prompt)]:
        started = time.monotonic()
        row = {
            'strainId': strain_id,
            'status': 'failed',
            'model': model,
            'quality': quality,
            'requestedSize': size,
            'outputFormat': output_format,
            'n': 1,
            'retryPolicy': 'NO_RETRY',
            'promptSha256': sha256(prompt.encode('utf-8')),
        }
        try:
            response = client.images.generate(model=model, prompt=prompt, size=size, quality=quality, output_format=output_format, n=1)
            if len(response.data) != 1 or not response.data[0].b64_json:
                raise RuntimeError('invalid_image_response')
            raw = base64.b64decode(response.data[0].b64_json)
            with Image.open(io.BytesIO(raw)) as image:
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                width, height, fmt = image.width, image.height, image.format
            if (width, height) != (1024, 1024):
                raise RuntimeError('unexpected_dimensions')
            filename = f'{strain_id}__one-shot.jpg'
            (OUT / filename).write_bytes(raw)
            usage = response.usage.model_dump() if getattr(response, 'usage', None) else {}
            input_tokens = usage.get('input_tokens') if isinstance(usage, dict) else None
            output_tokens = usage.get('output_tokens') if isinstance(usage, dict) else None
            input_cost = input_tokens * text_input_usd_per_million / 1_000_000 if isinstance(input_tokens, (int, float)) else 0.0
            output_cost = output_tokens * image_output_usd_per_million / 1_000_000 if isinstance(output_tokens, (int, float)) else fallback_output_usd
            row.update({
                'status': 'success',
                'file': filename,
                'format': fmt,
                'dimensions': {'width': width, 'height': height},
                'byteLength': len(raw),
                'sha256': sha256(raw),
                'usage': usage,
                'estimatedInputCostUsd': round(input_cost, 8),
                'estimatedOutputCostUsd': round(output_cost, 8),
                'estimatedCostUsd': round(input_cost + output_cost, 8),
                'elapsedSeconds': round(time.monotonic() - started, 3),
            })
        except Exception as exc:
            row['errorClass'] = type(exc).__name__
            row['elapsedSeconds'] = round(time.monotonic() - started, 3)
        results.append(row)
elif not secret_configured:
    print('SAFE-STOP: no API request sent because OPENAI_API_KEY is not configured')
else:
    print('SAFE-STOP: no API request sent because prompt preflight failed')

successful = [x for x in results if x['status'] == 'success']
total_cost = round(sum(x.get('estimatedCostUsd', 0) for x in successful), 8)
summary = {
    'pipeline': 'IMAGE PRODUCTION PIPELINE V2 PROMPT PREFLIGHT ONE-SHOT',
    'sourceCommit': os.environ.get('MASTER_SOURCE_SHA'),
    'workflowRunId': int(os.environ['GITHUB_RUN_ID']),
    'secretStatus': 'CONFIGURED' if secret_configured else 'NOT CONFIGURED',
    'checks': checks,
    'preflight': preflight,
    'priorRunGuard': None,
    'generationPolicy': {
        'provider': 'OpenAI',
        'model': model,
        'quality': quality,
        'size': size,
        'outputFormat': output_format,
        'nPerCultivar': 1,
        'maximumImages': 2,
        'retryAllowed': False,
        'sdkMaxRetries': 0,
    },
    'results': results,
    'successfulImages': len(successful),
    'estimatedTotalCostUsd': total_cost,
    'productionMutationCount': 0,
    'mainMutationCount': 0,
    'humanVisualReview': 'REQUIRED',
    'productionPromotion': 'NOT PERFORMED',
}
(OUT / 'preflight-generation-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'successfulImages': len(successful), 'estimatedTotalCostUsd': total_cost}, ensure_ascii=False))
