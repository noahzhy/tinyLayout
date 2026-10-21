"""Minimal evidence-gated multigraph; scores alone cannot certify connectivity.

Certification itself belongs to an audited upstream source. This module validates
its provenance/binding, not the correctness of pixels or a human annotation.
"""
from dataclasses import asdict, dataclass, field
from copy import deepcopy
import json
import math
from pathlib import Path
from typing import Any

Endpoint = tuple[str, str]  # node_id, port_id


@dataclass(frozen=True)
class Node:
    node_id: str
    kind: str
    port_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.node_id or self.kind not in {"junction", "portal", "entrance", "dead_end", "frontier"}:
            raise ValueError("invalid node identity or kind")
        if not self.port_ids or any(not p for p in self.port_ids) or len(set(self.port_ids)) != len(self.port_ids):
            raise ValueError("port ids must be nonempty and unique within a node")


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    kind: str
    frame_ids: tuple[str, ...]
    segment_ids: tuple[str, ...]
    source_ref: str
    observed_at_s: float
    committed_at_s: float
    certified: bool = False
    endpoints: tuple[Endpoint, Endpoint] | None = None

    def __post_init__(self) -> None:
        known = {"visual_similarity", "same_place_verified", "same_landmark", "observed_traversal",
                 "human_confirmed_connection", "model_prediction"}
        if not self.evidence_id or self.kind not in known or not self.source_ref:
            raise ValueError("evidence requires identity, known kind and source_ref")
        if not math.isfinite(self.observed_at_s) or not math.isfinite(self.committed_at_s):
            raise ValueError("evidence times must be finite")
        if self.observed_at_s > self.committed_at_s:
            raise ValueError("evidence cannot be committed before it was observed")
        if self.certified:
            if self.kind not in {"observed_traversal", "human_confirmed_connection"}:
                raise ValueError("only actual traversal/explicit human connection can certify an edge")
            if self.endpoints is None or len(self.endpoints) != 2 or self.endpoints[0] == self.endpoints[1]:
                raise ValueError("certified connection must bind two distinct endpoint ports")
            if self.kind == "observed_traversal":
                if len(set(self.frame_ids)) < 2 or len(set(self.segment_ids)) != 1:
                    raise ValueError("certified traversal requires >=2 frames in exactly one segment")


@dataclass
class Edge:
    edge_id: str
    source: Endpoint
    target: Endpoint
    status: str = "candidate"
    evidence_ids: list[str] = field(default_factory=list)
    length_m: float | None = None


class GraphStore:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.evidence: dict[str, Evidence] = {}
        self.edges: dict[str, Edge] = {}
        self.events: list[dict[str, Any]] = []

    def _event(self, action: str, payload: dict[str, Any]) -> None:
        self.events.append({"sequence": len(self.events), "action": action, "payload": deepcopy(payload)})

    def add_node(self, node: Node) -> None:
        if node.node_id in self.nodes:
            raise ValueError(f"duplicate node: {node.node_id}")
        self.nodes[node.node_id] = node
        self._event("add_node", asdict(node))

    def add_evidence(self, evidence: Evidence) -> None:
        if evidence.evidence_id in self.evidence:
            raise ValueError(f"duplicate evidence: {evidence.evidence_id}")
        self.evidence[evidence.evidence_id] = evidence
        self._event("add_evidence", asdict(evidence))

    def _check_endpoint(self, endpoint: Endpoint) -> None:
        if len(endpoint) != 2 or endpoint[0] not in self.nodes:
            raise ValueError(f"unknown endpoint node: {endpoint}")
        if endpoint[1] not in self.nodes[endpoint[0]].port_ids:
            raise ValueError(f"unknown endpoint port: {endpoint}")

    def propose_edge(self, edge_id: str, source: Endpoint, target: Endpoint) -> None:
        if not edge_id or edge_id in self.edges:
            raise ValueError("edge id must be nonempty and unique")
        self._check_endpoint(source)
        self._check_endpoint(target)
        if source == target:
            raise ValueError("same endpoint cannot connect to itself")
        self.edges[edge_id] = Edge(edge_id, source, target)
        self._event("propose_edge", asdict(self.edges[edge_id]))

    def verify_edge(self, edge_id: str, evidence_ids: list[str]) -> None:
        if edge_id not in self.edges:
            raise ValueError(f"unknown edge: {edge_id}")
        edge = self.edges[edge_id]
        if edge.status != "candidate":
            raise ValueError("only candidate edges can transition to verified")
        records = []
        for eid in evidence_ids:
            if eid not in self.evidence:
                raise ValueError(f"unknown evidence: {eid}")
            records.append(self.evidence[eid])
        endpoints = {edge.source, edge.target}
        qualified = [e for e in records if e.certified and e.kind in
                     {"observed_traversal", "human_confirmed_connection"}
                     and e.endpoints is not None and set(e.endpoints) == endpoints]
        if not qualified:
            raise ValueError("no certified traversal/connection bound to these endpoint ports")
        edge.status = "verified"
        edge.evidence_ids = list(dict.fromkeys(evidence_ids))
        self._event("verify_edge", {"edge_id": edge_id, "evidence_ids": edge.evidence_ids})

    def revoke_edge(self, edge_id: str, reason: str) -> None:
        if not reason.strip():
            raise ValueError("revocation reason required")
        if edge_id not in self.edges or self.edges[edge_id].status != "verified":
            raise ValueError("only a verified edge can be revoked")
        self.edges[edge_id].status = "revoked"
        self._event("revoke_edge", {"edge_id": edge_id, "reason": reason})

    def verified_edges(self) -> list[Edge]:
        # Avoid giving callers references that can silently mutate stored facts.
        return [deepcopy(e) for e in self.edges.values() if e.status == "verified"]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0", "layout_kind": "non_metric_topology",
            "nodes": [asdict(n) for n in self.nodes.values()],
            "edges": [asdict(e) for e in self.edges.values()],
            "evidence": [asdict(e) for e in self.evidence.values()],
            "events": deepcopy(self.events),
        }

    def export(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
