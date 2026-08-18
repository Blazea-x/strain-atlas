#!/usr/bin/env python3
import base64
import hashlib
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image

BASE_URL = "https://aihorde.net/api/v2"
ANON_KEY = "0000000000"
CLIENT_AGENT = "CannabisStrainsWisdom-ImagePoC:1.0:github.com/Blazea-x/strain-atlas"
MANIFEST_PATH = Path("production/manifests/kali-mist.json")
OUT_DIR = Path(os.environ.get("POC_OUTPUT_DIR", "poc-artifact"))
QUEUE_TIMEOUT_SECONDS = int(os.environ.get("AI_HORDE_QUEUE_TIMEOUT_SECONDS", "600"))
GENERATION_TIMEOUT_SECONDS = int(os.environ.get("AI_HORDE_GENERATION_TIMEOUT_SECONDS", "900"))
POLL_SECONDS = int(os.environ.get("AI_HORDE_POLL_SECONDS", "5"))
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("AI_HORDE_HTTP_TIMEOUT_SECONDS", "30"))

MODEL_PREFERENCES = [
    ("ICBINP - I Can't Believe It's Not Photography", "photorealistic specialization"),
    ("AbsoluteReality", "photorealistic specialization"),
    ("AlbedoBase XL 3.1", "SDXL-quality general realism"),
    ("AlbedoBase XL (SDXL)", "SDXL-quality general realism"),
    ("Realistic Vision", "photorealistic specialization"),
    ("SDXL 1.0", "general SDXL fallback"),
    ("stable_diffusion", "widely served general fallback"),
]

PARAMS = {
    "cfg_scale": 7,
    "sampler_name": "k_euler_a",
    "height": 768,
    "width": 512,
    "steps": 24,
    "n": 1,
}

class PocFailure(RuntimeError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def request_json(session, method, url, *, failure_code, **kwargs):
    try:
        response = session.request(method, url, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs)
    except requests.RequestException as exc:
        raise PocFailure(failure_code, f"HTTP request failed: {exc}") from exc
    content_type = response.headers.get("content-type", "")
    if response.status_code < 200 or response.status_code >= 300:
        body = response.text[:1200]
        code = "AI_HORDE_UNAVAILABLE" if response.status_code >= 500 else failure_code
        raise PocFailure(code, f"HTTP {response.status_code} from {url}", {"contentType": content_type, "body": body})
    if "json" not in content_type.lower():
        raise PocFailure(failure_code, f"Expected JSON from {url}", {"contentType": content_type})
    try:
        return response.json()
    except ValueError as exc:
        raise PocFailure(failure_code, f"Invalid JSON from {url}") from exc


def load_and_validate_manifest():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    required = [
        "runId", "strainId", "manifestVersion", "revision", "attempt",
        "promptSnapshot", "evidenceSnapshot", "visualPreparationHash",
        "approvalStatus", "expectedInboxFilename", "expectedPrimaryPath",
    ]
    missing = [k for k in required if k not in manifest]
    if missing:
        raise PocFailure("PROVIDER_ERROR", "Manifest missing required fields", {"missing": missing})
    if manifest["runId"] != "content-production-20260818T060700Z-01" or manifest["strainId"] != "kali-mist":
        raise PocFailure("PROVIDER_ERROR", "Manifest identity does not match the Kali Mist PoC target")
    if manifest["approvalStatus"] != "pending":
        raise PocFailure("PROVIDER_ERROR", "PoC requires approvalStatus=pending", {"approvalStatus": manifest["approvalStatus"]})
    return manifest


def select_model(models):
    live = {m.get("name"): m for m in models if isinstance(m, dict) and int(m.get("count") or 0) > 0}
    for name, reason in MODEL_PREFERENCES:
        if name in live:
            selected = live[name]
            return name, reason, {
                "threads": selected.get("count"),
                "queued": selected.get("queued"),
                "jobs": selected.get("jobs"),
                "eta": selected.get("eta"),
                "performance": selected.get("performance"),
            }
    raise PocFailure(
        "NO_ELIGIBLE_MODEL",
        "No preferred free AI Horde image model has an active worker thread",
        {"preferredModels": [name for name, _ in MODEL_PREFERENCES]},
    )


def download_generation_image(session, image_ref):
    if not isinstance(image_ref, str) or not image_ref:
        raise PocFailure("INVALID_IMAGE_RESPONSE", "Generation result has no image reference")
    if image_ref.startswith("http://") or image_ref.startswith("https://"):
        try:
            response = session.get(image_ref, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=True)
        except requests.RequestException as exc:
            raise PocFailure("INVALID_IMAGE_RESPONSE", f"Image download failed: {exc}") from exc
        content_type = response.headers.get("content-type", "")
        if response.status_code != 200:
            raise PocFailure("INVALID_IMAGE_RESPONSE", "Image URL returned non-200", {"httpStatus": response.status_code, "contentType": content_type})
        if not content_type.lower().startswith("image/"):
            raise PocFailure("INVALID_IMAGE_RESPONSE", "Image URL did not return image/*", {"httpStatus": response.status_code, "contentType": content_type, "byteLength": len(response.content)})
        data = response.content
        transport = {"kind": "url", "httpStatus": response.status_code, "contentType": content_type, "urlHost": requests.utils.urlparse(response.url).hostname}
    else:
        try:
            data = base64.b64decode(image_ref, validate=True)
        except Exception as exc:
            raise PocFailure("INVALID_IMAGE_RESPONSE", "Generation image was neither a URL nor valid base64") from exc
        transport = {"kind": "base64", "httpStatus": None, "contentType": None, "urlHost": None}
    if len(data) < 1024:
        raise PocFailure("INVALID_IMAGE_RESPONSE", "Image payload is implausibly small", {"byteLength": len(data), **transport})
    return data, transport


def decode_image(data):
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            width, height = im.size
            image_format = im.format
    except Exception as exc:
        raise PocFailure("IMAGE_DECODE_FAILED", f"Pillow could not decode image: {exc}") from exc
    if width < 64 or height < 64:
        raise PocFailure("IMAGE_DECODE_FAILED", "Decoded image dimensions are implausibly small", {"width": width, "height": height})
    return width, height, image_format


def write_failure_artifact(manifest, exc, provider_generation_id=None, model=None):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failure = {
        "pocStatus": "FAIL",
        "failureCode": exc.code,
        "message": exc.message,
        "details": exc.details,
        "runId": manifest.get("runId") if manifest else None,
        "strainId": manifest.get("strainId") if manifest else "kali-mist",
        "revision": manifest.get("revision") if manifest else None,
        "attempt": manifest.get("attempt") if manifest else None,
        "provider": "AI Horde",
        "model": model,
        "providerGenerationId": provider_generation_id,
        "failedAt": now_iso(),
        "workflowRun": {
            "repository": os.environ.get("GITHUB_REPOSITORY"),
            "runId": os.environ.get("GITHUB_RUN_ID"),
            "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
            "sha": os.environ.get("GITHUB_SHA"),
            "ref": os.environ.get("GITHUB_REF"),
        },
    }
    (OUT_DIR / "failure.json").write_text(json.dumps(failure, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    manifest = None
    generation_id = None
    model = None
    start_monotonic = time.monotonic()
    try:
        manifest = load_and_validate_manifest()
        prompt = manifest["promptSnapshot"]
        evidence = manifest["evidenceSnapshot"]
        manifest_bytes = MANIFEST_PATH.read_bytes()
        prompt_hash = sha256_bytes(prompt.encode("utf-8"))
        evidence_hash = sha256_bytes(canonical_json_bytes(evidence))
        manifest_hash = sha256_bytes(manifest_bytes)

        session = requests.Session()
        session.headers.update({
            "apikey": ANON_KEY,
            "Client-Agent": CLIENT_AGENT,
            "Accept": "application/json",
            "User-Agent": CLIENT_AGENT,
        })

        heartbeat = request_json(session, "GET", f"{BASE_URL}/status/heartbeat", failure_code="AI_HORDE_UNAVAILABLE")
        modes = request_json(session, "GET", f"{BASE_URL}/status/modes", failure_code="AI_HORDE_UNAVAILABLE")
        if isinstance(modes, dict) and modes.get("maintenance_mode") is True:
            raise PocFailure("AI_HORDE_UNAVAILABLE", "AI Horde reports maintenance mode", {"modes": modes})

        models = request_json(session, "GET", f"{BASE_URL}/status/models?type=image", failure_code="AI_HORDE_UNAVAILABLE")
        if not isinstance(models, list):
            raise PocFailure("AI_HORDE_UNAVAILABLE", "Model endpoint did not return a list")
        model, selection_reason, model_status = select_model(models)
        print(f"MODEL_SELECTED provider=AI Horde model={model!r} reason={selection_reason} live={json.dumps(model_status, separators=(',', ':'))}")

        payload = {
            "prompt": prompt,
            "params": PARAMS,
            "models": [model],
            "nsfw": False,
            "censor_nsfw": True,
            "r2": True,
            "shared": False,
            "slow_workers": True,
            "dry_run": False,
        }
        submitted_at = now_iso()
        request_result = request_json(session, "POST", f"{BASE_URL}/generate/async", failure_code="PROVIDER_ERROR", json=payload)
        generation_id = request_result.get("id") if isinstance(request_result, dict) else None
        if not generation_id:
            raise PocFailure("PROVIDER_ERROR", "Generation request returned no id", {"response": request_result})
        print(f"GENERATION_REQUEST_SUCCESS providerGenerationId={generation_id}")

        queue_started = time.monotonic()
        processing_seen = False
        final_check = None
        while True:
            elapsed = time.monotonic() - start_monotonic
            queue_elapsed = time.monotonic() - queue_started
            if elapsed > GENERATION_TIMEOUT_SECONDS:
                raise PocFailure("GENERATION_TIMEOUT", "Generation exceeded overall timeout", {"seconds": round(elapsed, 1)})
            check = request_json(session, "GET", f"{BASE_URL}/generate/check/{generation_id}", failure_code="PROVIDER_ERROR")
            final_check = check
            waiting = int(check.get("waiting") or 0)
            processing = int(check.get("processing") or 0)
            finished = int(check.get("finished") or 0)
            done = bool(check.get("done"))
            faulted = bool(check.get("faulted"))
            print(f"POLL waiting={waiting} processing={processing} finished={finished} done={done} faulted={faulted} queuePosition={check.get('queue_position')} waitTime={check.get('wait_time')}")
            if processing > 0 or finished > 0:
                processing_seen = True
            if faulted:
                raise PocFailure("PROVIDER_ERROR", "AI Horde marked generation faulted", {"check": check})
            if done:
                if finished < 1:
                    raise PocFailure("PROVIDER_ERROR", "AI Horde completed request without a finished image", {"check": check})
                break
            if not processing_seen and queue_elapsed > QUEUE_TIMEOUT_SECONDS:
                raise PocFailure("QUEUE_TIMEOUT", "Generation remained queued beyond queue timeout", {"seconds": round(queue_elapsed, 1), "check": check})
            time.sleep(POLL_SECONDS)

        status = request_json(session, "GET", f"{BASE_URL}/generate/status/{generation_id}", failure_code="PROVIDER_ERROR")
        generations = status.get("generations") if isinstance(status, dict) else None
        if not isinstance(generations, list) or len(generations) != 1:
            raise PocFailure("PROVIDER_ERROR", "Expected exactly one generated image", {"generationCount": len(generations) if isinstance(generations, list) else None})
        generation = generations[0]
        image_bytes, transport = download_generation_image(session, generation.get("img"))
        width, height, image_format = decode_image(image_bytes)
        image_sha256 = sha256_bytes(image_bytes)

        suffix = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get((image_format or "").upper(), ".img")
        source_filename = f"kali-mist-ai-horde{suffix}"
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / source_filename).write_bytes(image_bytes)
        (OUT_DIR / "sha256.txt").write_text(f"{image_sha256}  {source_filename}\n", encoding="utf-8")

        completed_at = now_iso()
        duration_seconds = round(time.monotonic() - start_monotonic, 1)
        actual_model = generation.get("model") or model
        provenance = {
            "pocSchemaVersion": 1,
            "pocStatus": "PASS",
            "costPolicy": "FREE_ONLY",
            "runId": manifest["runId"],
            "strainId": manifest["strainId"],
            "manifestVersion": manifest["manifestVersion"],
            "revision": manifest["revision"],
            "attempt": manifest["attempt"],
            "manifestSha256": manifest_hash,
            "visualPreparationHash": manifest["visualPreparationHash"],
            "provider": "AI Horde",
            "model": actual_model,
            "modelRequested": model,
            "modelSelectionReason": selection_reason,
            "modelStatusAtSelection": model_status,
            "providerGenerationId": generation_id,
            "providerJobId": generation.get("id"),
            "providerWorkerId": generation.get("worker_id"),
            "providerWorkerName": generation.get("worker_name"),
            "submittedAt": submitted_at,
            "generatedAt": completed_at,
            "generationDurationSeconds": duration_seconds,
            "sourceImageFilename": source_filename,
            "sourceImageByteLength": len(image_bytes),
            "sourceImageSha256": image_sha256,
            "imageFormat": image_format,
            "width": width,
            "height": height,
            "promptSnapshotSha256": prompt_hash,
            "evidenceSnapshotSha256": evidence_hash,
            "generationParametersRequested": PARAMS,
            "generationSeed": generation.get("seed"),
            "imageTransportValidation": transport,
            "providerCheckFinal": final_check,
            "providerKudos": generation.get("kudos"),
            "providerWarnings": request_result.get("warnings") if isinstance(request_result, dict) else None,
            "providerHeartbeat": heartbeat,
            "visualAssessment": "AI_PRECHECK_ONLY_NOT_PERFORMED",
            "workflowRun": {
                "repository": os.environ.get("GITHUB_REPOSITORY"),
                "workflow": os.environ.get("GITHUB_WORKFLOW"),
                "runId": os.environ.get("GITHUB_RUN_ID"),
                "runNumber": os.environ.get("GITHUB_RUN_NUMBER"),
                "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
                "sha": os.environ.get("GITHUB_SHA"),
                "ref": os.environ.get("GITHUB_REF"),
                "actor": os.environ.get("GITHUB_ACTOR"),
            },
        }
        (OUT_DIR / "generation-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        print(f"POC_RESULT PASS providerGenerationId={generation_id} model={actual_model!r} durationSeconds={duration_seconds} byteLength={len(image_bytes)} sha256={image_sha256} dimensions={width}x{height} filename={source_filename}")
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"revision={manifest['revision']}\n")
                f.write(f"attempt={manifest['attempt']}\n")
                f.write(f"generation_id={generation_id}\n")
                f.write(f"model={actual_model}\n")
                f.write(f"byte_length={len(image_bytes)}\n")
                f.write(f"sha256={image_sha256}\n")
                f.write(f"width={width}\n")
                f.write(f"height={height}\n")
                f.write(f"duration_seconds={duration_seconds}\n")
        return 0
    except PocFailure as exc:
        print(f"POC_FAILURE code={exc.code} message={exc.message} details={json.dumps(exc.details, ensure_ascii=False, separators=(',', ':'))}", file=sys.stderr)
        write_failure_artifact(manifest, exc, generation_id, model)
        return 1
    except Exception as exc:
        wrapped = PocFailure("PROVIDER_ERROR", f"Unexpected PoC error: {type(exc).__name__}: {exc}")
        print(f"POC_FAILURE code={wrapped.code} message={wrapped.message}", file=sys.stderr)
        write_failure_artifact(manifest, wrapped, generation_id, model)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
