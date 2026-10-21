import json
import pytest
from structmap_jepa.graph.state import Node, Evidence, GraphStore
from structmap_jepa.graph.demo import run_demo


def fixture_graph():
    graph = GraphStore()
    graph.add_node(Node("a", "junction", ("a0", "a1")))
    graph.add_node(Node("b", "frontier", ("b0", "b1")))
    graph.propose_edge("e", ("a", "a0"), ("b", "b0"))
    return graph


def good_evidence():
    return Evidence("proof", "observed_traversal", ("f1", "f2"), ("s1",),
                    "manual_fixture", 1, 2, True, (("a", "a0"), ("b", "b0")))


@pytest.mark.parametrize("kind", ["model_prediction", "same_landmark", "same_place_verified", "visual_similarity"])
def test_nontraversal_evidence_cannot_verify(kind):
    graph = fixture_graph()
    graph.add_evidence(Evidence("wrong", kind, ("f1",), ("s1",), "fixture", 1, 2))
    with pytest.raises(ValueError, match="certified"):
        graph.verify_edge("e", ["wrong"])
    assert graph.edges["e"].status == "candidate"


def test_no_certification_for_prediction():
    with pytest.raises(ValueError, match="only actual"):
        Evidence("wrong", "model_prediction", (), (), "fixture", 1, 2, True,
                 (("a", "a0"), ("b", "b0")))


def test_endpoint_binding_is_enforced():
    graph = fixture_graph()
    graph.add_evidence(Evidence("proof", "observed_traversal", ("f1", "f2"), ("s1",),
                                "fixture", 1, 2, True, (("a", "a1"), ("b", "b1"))))
    with pytest.raises(ValueError, match="bound"):
        graph.verify_edge("e", ["proof"])


def test_certified_edge_can_be_revoked_without_deleting_history(tmp_path):
    graph = fixture_graph()
    graph.add_evidence(good_evidence())
    graph.verify_edge("e", ["proof"])
    assert len(graph.verified_edges()) == 1
    count = len(graph.events)
    graph.revoke_edge("e", "correcting fixture")
    assert not graph.verified_edges()
    assert len(graph.events) == count + 1
    assert "proof" in graph.evidence
    p = tmp_path / "graph.json"
    graph.export(p)
    saved = json.loads(p.read_text())
    assert saved["edges"][0]["status"] == "revoked"
    assert saved["edges"][0]["length_m"] is None


def test_parallel_edges_are_preserved():
    graph = fixture_graph()
    graph.propose_edge("parallel", ("a", "a1"), ("b", "b1"))
    assert len(graph.edges) == 2


def test_discontinuous_traversal_cannot_be_certified():
    with pytest.raises(ValueError, match="exactly one segment"):
        Evidence("proof", "observed_traversal", ("f1", "f2"), ("s1", "s2"),
                 "fixture", 1, 2, True, (("a", "a0"), ("b", "b0")))


def test_verified_results_are_copies():
    graph = fixture_graph()
    graph.add_evidence(good_evidence())
    graph.verify_edge("e", ["proof"])
    graph.verified_edges()[0].status = "revoked"
    assert graph.edges["e"].status == "verified"


def test_demo_is_explicit_fixture(tmp_path):
    report = run_demo(tmp_path)
    assert report["fixture_only"]
    assert report["prediction_cannot_certify_edge"]
    assert report["verified_edges_after_revoke"] == 0
