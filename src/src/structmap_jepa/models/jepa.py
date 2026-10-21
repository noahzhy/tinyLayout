"""BEV JEPA core with EMA target and a candidate-independent observation path."""
from copy import deepcopy
from dataclasses import dataclass
import torch
from torch import Tensor, nn
from structmap_jepa.config import ModelConfig
from structmap_jepa.models.bev import BEVEncoder, BEVFeatures, QueryBlock, chart_grid
from structmap_jepa.losses import candidate_energy


class BEVPredictor(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.map_projection = nn.Sequential(nn.Linear(cfg.memory_dim, cfg.dim),
                                             nn.GELU(), nn.Linear(cfg.dim, cfg.dim))
        self.null_memory = nn.Parameter(torch.randn(1, 1, cfg.dim) * 0.02)
        self.queries = nn.Parameter(torch.randn(1, cfg.cells, cfg.dim) * 0.02)
        self.register_buffer("grid", chart_grid(cfg.bev_h, cfg.bev_w))
        self.position = nn.Linear(2, cfg.dim)
        self.source_type = nn.Parameter(torch.randn(2, cfg.dim) * 0.02)
        self.blocks = nn.ModuleList([QueryBlock(cfg.dim, cfg.heads, cfg.dropout)
                                    for _ in range(cfg.layers)])
        self.norm = nn.LayerNorm(cfg.dim)

    def forward(self, context_bev: Tensor, map_features: Tensor, map_valid: Tensor) -> Tensor:
        if context_bev.ndim != 3 or context_bev.shape[1:] != (self.cfg.cells, self.cfg.dim):
            raise ValueError("context_bev must have shape [B,N,D] for the configured chart")
        b = context_bev.shape[0]
        if map_features.ndim != 3 or map_features.shape[0] != b or map_features.shape[-1] != self.cfg.memory_dim:
            raise ValueError("map_features must be [B,K,memory_dim]")
        if map_valid.shape != map_features.shape[:2] or map_valid.dtype != torch.bool:
            raise ValueError("map_valid must be bool [B,K]")
        if not torch.isfinite(context_bev).all().item() or not torch.isfinite(map_features[map_valid]).all().item():
            raise ValueError("valid BEV and memory features must be finite")
        clean_map = map_features.masked_fill(~map_valid[..., None], 0)
        map_tokens = self.map_projection(clean_map) + self.source_type[1]
        context = context_bev + self.source_type[0]
        memory = torch.cat([context, self.null_memory.expand(b, -1, -1), map_tokens], dim=1)
        valid = torch.cat([torch.ones(b, context.shape[1] + 1, dtype=torch.bool, device=context.device),
                           map_valid], dim=1)
        queries = self.queries.expand(b, -1, -1) + self.position(self.grid)[None]
        for block in self.blocks:
            queries = block(queries, memory, valid)
        return self.norm(queries)


@dataclass
class ModelOutput:
    context_bev: Tensor
    prediction: Tensor
    target: Tensor | None
    identity: Tensor
    semantic_logits: Tensor
    evidence_logits: Tensor
    action_logits: Tensor


class StructMapJEPA(nn.Module):
    """Tensor-level research scaffold, not a complete trained mapping system."""
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.online_encoder = BEVEncoder(cfg)
        self.target_encoder = deepcopy(self.online_encoder)
        self.target_encoder.requires_grad_(False)
        self.target_encoder.eval()
        self.predictor = BEVPredictor(cfg)
        self.semantic_head = nn.Linear(cfg.dim, cfg.semantic_classes)
        self.evidence_head = nn.Linear(cfg.dim, 1)
        # Prototype only: full entity/port/relation decoder is intentionally TODO.
        self.action_head = nn.Linear(cfg.dim, 4)

    def train(self, mode: bool = True) -> "StructMapJEPA":
        super().train(mode)
        self.target_encoder.eval()
        return self

    @torch.no_grad()
    def update_target(self, decay: float | None = None) -> None:
        m = self.cfg.ema_decay if decay is None else decay
        if not 0 <= m < 1:
            raise ValueError("EMA decay must be in [0, 1)")
        source = dict(self.online_encoder.named_parameters())
        for name, target in self.target_encoder.named_parameters():
            target.mul_(m).add_(source[name], alpha=1 - m)
        source_buffers = dict(self.online_encoder.named_buffers())
        for name, target in self.target_encoder.named_buffers():
            target.copy_(source_buffers[name])
        self.target_encoder.eval()

    def forward(self, context_images: Tensor, context_valid: Tensor, context_times: Tensor,
                memory_features: Tensor, memory_valid: Tensor,
                teacher_images: Tensor | None = None,
                teacher_valid: Tensor | None = None,
                teacher_times: Tensor | None = None) -> ModelOutput:
        context = self.online_encoder(context_images, context_valid, context_times)
        prediction = self.predictor(context.bev, memory_features, memory_valid)
        provided = [teacher_images is not None, teacher_valid is not None, teacher_times is not None]
        if any(provided) and not all(provided):
            raise ValueError("teacher_images, teacher_valid and teacher_times must be provided together")
        target = None
        if all(provided):
            with torch.no_grad():
                target = self.target_encoder(teacher_images, teacher_valid, teacher_times).bev
        return ModelOutput(
            context_bev=context.bev, prediction=prediction, target=target, identity=context.identity,
            semantic_logits=self.semantic_head(context.bev),
            evidence_logits=self.evidence_head(context.bev).squeeze(-1),
            action_logits=self.action_head(context.bev.mean(1)),
        )

    @torch.no_grad()
    def observe(self, images: Tensor, valid: Tensor, times: Tensor) -> BEVFeatures:
        """Candidate-free actual observation. Caller must provide the correct chart."""
        if self.training:
            raise RuntimeError("call eval() before online observation/scoring")
        return self.online_encoder(images, valid, times)

    @torch.no_grad()
    def score_candidates(self, context_bev: Tensor, observation_bev: Tensor,
                         candidates: Tensor, candidate_valid: Tensor,
                         support: Tensor, min_support: int = 2) -> Tensor:
        """Return [B,C] energies; all inputs must already share a common chart.

        No rotation/scale alignment is implemented here. No map is mutated.
        Equal visible support is used for all candidates, preventing tiny-overlap wins.
        """
        if self.training:
            raise RuntimeError("call eval() before online observation/scoring")
        if candidates.ndim != 4:
            raise ValueError("candidates must be [B,C,K,memory_dim]")
        if candidate_valid.shape != candidates.shape[:3] or candidate_valid.dtype != torch.bool:
            raise ValueError("candidate_valid must be bool [B,C,K]")
        if candidates.shape[0] != context_bev.shape[0] or candidates.shape[1] < 1:
            raise ValueError("candidate batch mismatch or empty candidate list")
        values = []
        for c in range(candidates.shape[1]):
            predicted = self.predictor(context_bev, candidates[:, c], candidate_valid[:, c])
            values.append(candidate_energy(predicted, observation_bev, support, min_support))
        return torch.stack(values, dim=1)
