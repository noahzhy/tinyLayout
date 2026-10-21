import json
from pathlib import Path
import pytest
import torch
from structmap_jepa.config import ModelConfig, RuntimeConfig

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture(autouse=True)
def deterministic_test():
    torch.set_num_threads(1)
    torch.manual_seed(11)

@pytest.fixture
def cfg():
    return ModelConfig(dim=32, heads=4, layers=1, bev_h=4, bev_w=4,
                       patch_h=4, patch_w=4, identity_dim=16)

@pytest.fixture
def runtime():
    return RuntimeConfig(batch_size=2, image_size=32, context_frames=2,
                         teacher_frames=3, memory_tokens=3)

@pytest.fixture
def manifest():
    return json.loads((ROOT / "examples/window_manifest.json").read_text(encoding="utf-8"))
