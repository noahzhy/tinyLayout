"""Hand-authored graph-event fixture, NOT a learned store reconstruction."""
import argparse
import json
from pathlib import Path
from structmap_jepa.graph.state import Evidence, GraphStore, Node


def run_demo(output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    graph = GraphStore()
    graph.add_node(Node("entrance", "entrance", ("out",)))
    graph.add_node(Node("junction_a", "junction", ("in", "branch", "forward")))
    graph.add_node(Node("unexplored_b", "frontier", ("in",)))
    graph.propose_edge("walked_01", ("entrance", "out"), ("junction_a", "in"))
    graph.add_evidence(Evidence(
        "manual_fixture_01", "observed_traversal", ("frame_001", "frame_010"), ("segment_01",),
        "fixture_only:not_model_output", 5.0, 6.0, True,
        (("entrance", "out"), ("junction_a", "in")),
    ))
    graph.verify_edge("walked_01", ["manual_fixture_01"])
    graph.propose_edge("predicted_02", ("junction_a", "branch"), ("unexplored_b", "in"))
    graph.add_evidence(Evidence("prediction_only", "model_prediction", ("frame_010",), ("segment_01",),
                                "fixture_only:simulated_prediction", 5.0, 7.0))
    blocked = False
    try:
        graph.verify_edge("predicted_02", ["prediction_only"])
    except ValueError:
        blocked = True
    graph.export(output / "graph_before_revoke.json")
    graph.revoke_edge("walked_01", "fixture demonstration of reversible fact state")
    graph.export(output / "graph_after_revoke.json")
    summary = {"fixture_only": True, "prediction_cannot_certify_edge": blocked,
               "verified_edges_after_revoke": len(graph.verified_edges()), "events": len(graph.events)}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("runs/graph_demo"))
    args = parser.parse_args()
    print(json.dumps(run_demo(args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
