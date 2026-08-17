#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "uploads" / "images"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_BATCH = 50


def fail(message: str) -> None:
    print(f"IMAGE UPLOAD INBOX V1 FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def validate_webp(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if not data:
        fail(f"converted file is empty: {path}")
    if len(data) < 12 or data[0:4] != b"RIFF" or data[8:12] != b"WEBP":
        fail(f"invalid RIFF/WEBP signature: {path}")
    try:
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            if image.format != "WEBP":
                fail(f"decoder did not identify WEBP: {path}")
    except Exception as exc:
        fail(f"decoder could not open converted image {path}: {exc}")
    if width <= 0 or height <= 0:
        fail(f"invalid image dimensions {width}x{height}: {path}")
    return width, height


def main() -> None:
    INBOX.mkdir(parents=True, exist_ok=True)
    entries = sorted(p for p in INBOX.iterdir() if p.is_file() and not p.name.startswith("."))
    if not entries:
        print("IMAGE UPLOAD INBOX V1: inbox is empty")
        return

    unsupported = [p.name for p in entries if p.suffix.lower() not in ALLOWED_EXTENSIONS]
    if unsupported:
        fail("unsupported file(s): " + ", ".join(unsupported))
    if len(entries) > MAX_BATCH:
        fail(f"batch has {len(entries)} images; V1 limit is {MAX_BATCH}")

    by_strain: dict[str, Path] = {}
    for source in entries:
        strain_id = source.stem
        if not strain_id:
            fail(f"empty strain-id in filename: {source.name}")
        if strain_id in by_strain:
            fail(
                f"duplicate strain-id '{strain_id}' in one batch: "
                f"{by_strain[strain_id].name}, {source.name}"
            )
        by_strain[strain_id] = source
        strain_json = ROOT / "strains" / strain_id / "strain.json"
        if not strain_json.is_file():
            fail(f"unknown strain-id '{strain_id}': {strain_json.relative_to(ROOT)} does not exist")

    staged: list[tuple[str, Path, Path]] = []
    with tempfile.TemporaryDirectory(prefix="image-upload-inbox-") as tmp_name:
        tmp = Path(tmp_name)
        for strain_id, source in by_strain.items():
            converted = tmp / f"{strain_id}.webp"
            try:
                with Image.open(source) as image:
                    image.load()
                    image.save(converted, format="WEBP", quality=92, method=6)
            except Exception as exc:
                fail(f"cannot decode/convert {source.name}: {exc}")

            width, height = validate_webp(converted)
            destination = ROOT / "strains" / strain_id / "images" / "generated" / "primary.webp"
            staged.append((strain_id, converted, destination))
            print(f"PASS {source.name} -> {destination.relative_to(ROOT)} ({width}x{height})")

        # Nothing in the repository is modified until every item above has passed.
        for _, converted, destination in staged:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(converted, destination)
        for source in entries:
            source.unlink()

    print(f"IMAGE UPLOAD INBOX V1: prepared atomic batch of {len(staged)} image(s)")


if __name__ == "__main__":
    main()
