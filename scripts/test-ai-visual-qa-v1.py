#!/usr/bin/env python3
import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw
import torch

MODULE_PATH = Path(__file__).with_name("ai-visual-qa-v1.py")
spec = importlib.util.spec_from_file_location("ai_visual_qa_v1", MODULE_PATH)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

POSITIVE_INDEXES = {0, 1, 5, 7, 10, 15, 17}


class FakeProcessor:
    def __call__(self, images=None, text=None, return_tensors=None, padding=False, truncation=False):
        if images is not None:
            return {"pixel_values": torch.ones((1, 3, 8, 8), dtype=torch.float32)}
        return {"input_ids": torch.arange(len(text), dtype=torch.long).reshape(-1, 1)}


class FakeModel:
    def __init__(self, mode):
        self.mode = mode

    def get_image_features(self, **kwargs):
        if self.mode == "exception":
            raise RuntimeError("fixture model failure")
        return SimpleNamespace(pooler_output=torch.tensor([[1.0, 0.0, 0.0]], dtype=torch.float32))

    def get_text_features(self, input_ids=None, **kwargs):
        count = int(input_ids.shape[0])
        rows = []
        for idx in range(count):
            if idx == 18:
                good = False
                vector = [0.0, 1.0, 0.0]
            else:
                good = idx in POSITIVE_INDEXES
                vector = [1.0, 0.0, 0.0] if good else [-1.0, 0.0, 0.0]
            if self.mode == "non_cannabis" and idx != 18:
                vector = [-vector[0], vector[1], vector[2]]
            if self.mode == "non_cannabis" and idx == 18:
                vector = [1.0, 0.0, 0.0]
            rows.append(vector)
        return SimpleNamespace(pooler_output=torch.tensor(rows, dtype=torch.float32))


def make_fixture_image(path):
    image = Image.new("RGB", (512, 512), (32, 32, 32))
    draw = ImageDraw.Draw(image)
    cell = 32
    for y in range(0, 512, cell):
        for x in range(0, 512, cell):
            if ((x // cell) + (y // cell)) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(224, 224, 224))
    image.save(path, "JPEG", quality=95)


def manifest_fixture():
    return {
        "promptSnapshot": "Photorealistic botanical reference of one mature flowering cannabis plant.",
        "evidenceSnapshot": [
            {"description": "Tall flowering cannabis plant with broad leaves, lateral branches and dense buds."}
        ],
    }


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        image_path = Path(tmp) / "fixture.jpg"
        make_fixture_image(image_path)
        processor = FakeProcessor()
        manifest = manifest_fixture()

        valid = qa.qa_one(FakeModel("valid"), processor, image_path, manifest, "cpu")
        require(valid["status"] == "PASS", f"valid semantic fixture did not PASS: {valid}")
        require(valid.get("failClosed") is True, "valid fixture lost fail-closed marker")

        invalid = qa.qa_one(FakeModel("non_cannabis"), processor, image_path, manifest, "cpu")
        require(invalid["status"] == "FAIL", f"non-cannabis semantic fixture did not FAIL: {invalid}")
        require(any(c.get("id") == "cannabis_natural" and c.get("pass") is False for c in invalid["checks"]),
                "non-cannabis fixture did not fail semantic cannabis check")
        require(invalid.get("failClosed") is True, "invalid fixture lost fail-closed marker")

        model_error = qa.qa_one(FakeModel("exception"), processor, image_path, manifest, "cpu")
        require(model_error["status"] == "FAIL", f"model exception did not FAIL: {model_error}")
        require(model_error.get("reason") == "AI_QA_MODEL_ERROR", f"unexpected model error reason: {model_error}")
        require(model_error.get("failClosed") is True, "model exception was not fail-closed")

    print("AI_VISUAL_QA_REGRESSION: PASS")
    print("valid image semantic evaluation: PASS")
    print("invalid/non-cannabis mock: FAIL as required")
    print("model exception fail-closed: PASS")


if __name__ == "__main__":
    main()
