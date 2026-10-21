from copy import deepcopy
import pytest
from structmap_jepa.data.manifest import ManifestError, validate_manifest, validate_store_splits


def test_fixture_manifest_valid(manifest):
    validate_manifest(manifest)


def test_context_hidden_leak_rejected(manifest):
    manifest["hidden_frame_ids"].append(manifest["context_frame_ids"][0])
    with pytest.raises(ManifestError, match="leaks"):
        validate_manifest(manifest)


def test_target_frame_history_leak_rejected(manifest):
    manifest["memory_snapshot"]["records"][0]["evidence_frame_ids"] = ["f003"]
    with pytest.raises(ManifestError, match="leaked"):
        validate_manifest(manifest)


def test_future_snapshot_commit_rejected(manifest):
    manifest["memory_snapshot"]["records"][0]["committed_at_s"] = 12
    with pytest.raises(ManifestError, match="future memory"):
        validate_manifest(manifest)


def test_future_observation_rejected(manifest):
    manifest["query_cutoff_s"] = 10.5
    with pytest.raises(ManifestError, match="future frame"):
        validate_manifest(manifest)


def test_anchor_must_be_visible(manifest):
    manifest["anchor_frame_id"] = "f003"
    with pytest.raises(ManifestError, match="anchor"):
        validate_manifest(manifest)


def test_bev_window_cannot_cross_segments(manifest):
    manifest["frames"][-1]["segment_id"] = "other_segment"
    with pytest.raises(ManifestError, match="segment"):
        validate_manifest(manifest)


def test_same_store_cannot_cross_splits(manifest):
    other = deepcopy(manifest)
    other["split"] = "test"
    with pytest.raises(ManifestError, match="multiple splits"):
        validate_store_splits([manifest, other])


def test_missing_files_report_sample_id(manifest, tmp_path):
    with pytest.raises(ManifestError, match=manifest["sample_id"]):
        validate_manifest(manifest, tmp_path, check_files=True)


def test_relative_paths_cannot_escape_root(manifest, tmp_path):
    manifest["frames"][0]["image_path"] = "../escape.jpg"
    with pytest.raises(ManifestError, match="escapes"):
        validate_manifest(manifest, tmp_path, check_files=True)
