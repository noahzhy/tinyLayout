import json
from pathlib import Path
from structmap_jepa.training.smoke import run_smoke


def test_training_smoke_writes_honest_report(tmp_path):
    config = Path(__file__).resolve().parents[1] / "configs" / "smoke.yaml"
    report = run_smoke(config, steps=2, output=tmp_path)
    saved = json.loads((tmp_path / "metrics.json").read_text())
    assert saved["status"] == "passed"
    assert saved["not_real_mapping_performance"]
    assert len(report["steps"]) == 2
    assert report["trainable_parameters"] > 0
