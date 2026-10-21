"""Learned image-to-BEV tensor prototype; semantic geometry needs training data."""
from dataclasses import dataclass
import torch
from torch import Tensor, nn
from torch.nn import functional as F
from structmap_jepa.config import ModelConfig


def chart_grid(height: int, width: int) -> Tensor:
    """Cell centers: x right, y forward; row 0 is the front of the chart."""
    if height <= 0 or width <= 0:
        raise ValueError("grid dimensions must be positive")
    x = -1.0 + 2.0 * (torch.arange(width, dtype=torch.float32) + 0.5) / width
    y = 1.0 - 2.0 * (torch.arange(height, dtype=torch.float32) + 0.5) / height
    yy, xx = torch.meshgrid(y, x, indexing="ij")
    return torch.stack([xx, yy], dim=-1).reshape(-1, 2)


class QueryBlock(nn.Module):
    """Small pre-norm cross-attention + FFN; no quadratic query self-attention."""
    def __init__(self, dim: int, heads: int, dropout: float = 0.0) -> None:
        super().__init__()
        self.q_norm = nn.LayerNorm(dim)
        self.m_norm = nn.LayerNorm(dim)
        self.attention = nn.MultiheadAttention(dim, heads, dropout=dropout, batch_first=True)
        self.ff_norm = nn.LayerNorm(dim)
        self.ff = nn.Sequential(nn.Linear(dim, dim * 2), nn.GELU(),
                                nn.Dropout(dropout), nn.Linear(dim * 2, dim))

    def forward(self, query: Tensor, memory: Tensor, memory_valid: Tensor) -> Tensor:
        normalized_memory = self.m_norm(memory)
        delta, _ = self.attention(self.q_norm(query), normalized_memory, normalized_memory,
                                  key_padding_mask=~memory_valid, need_weights=False)
        query = query + delta
        return query + self.ff(self.ff_norm(query))


@dataclass
class BEVFeatures:
    bev: Tensor
    identity: Tensor


class BEVEncoder(nn.Module):
    """No-download CNN + 2D/time encodings + fixed-chart BEV queries.

    This class does not estimate camera poses or establish cross-chart alignment.
    The provided local chart convention must be grounded during data training.
    """
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        d = cfg.dim
        self.backbone = nn.Sequential(
            nn.Conv2d(3, d, 3, stride=2, padding=1), nn.GroupNorm(1, d), nn.GELU(),
            nn.Conv2d(d, d, 3, stride=2, padding=1), nn.GroupNorm(1, d), nn.GELU(),
            nn.Conv2d(d, d, 3, stride=2, padding=1), nn.GroupNorm(1, d), nn.GELU(),
            nn.AdaptiveAvgPool2d((cfg.patch_h, cfg.patch_w)),
        )
        self.register_buffer("patch_xy", chart_grid(cfg.patch_h, cfg.patch_w))
        self.register_buffer("bev_xy", chart_grid(cfg.bev_h, cfg.bev_w))
        self.image_pos = nn.Linear(2, d)
        self.bev_pos = nn.Linear(2, d)
        self.time_pos = nn.Sequential(nn.Linear(1, d), nn.Tanh(), nn.Linear(d, d))
        self.bev_queries = nn.Parameter(torch.randn(1, cfg.cells, d) * 0.02)
        self.blocks = nn.ModuleList([QueryBlock(d, cfg.heads, cfg.dropout) for _ in range(cfg.layers)])
        self.final_norm = nn.LayerNorm(d)
        self.identity_head = nn.Linear(d, cfg.identity_dim)

    def forward(self, images: Tensor, valid: Tensor, times: Tensor) -> BEVFeatures:
        if images.ndim != 5 or images.shape[2] != 3:
            raise ValueError("images must have shape [B,T,3,H,W]")
        b, t, _, h, w = images.shape
        if min(b, t, h, w) <= 0:
            raise ValueError("empty image dimensions are not allowed")
        if valid.shape != (b, t) or valid.dtype != torch.bool:
            raise ValueError("valid must be bool [B,T]")
        if times.shape != (b, t):
            raise ValueError("times must have shape [B,T]")
        if not valid.any(dim=1).all().item():
            raise ValueError("each window must contain at least one valid frame")
        if not torch.isfinite(images[valid]).all().item() or not torch.isfinite(times[valid]).all().item():
            raise ValueError("valid images and times must be finite")
        # Sanitization prevents padded NaNs from contaminating attention or the CNN.
        images = images.masked_fill(~valid[:, :, None, None, None], 0)
        times = times.masked_fill(~valid, 0).to(images.dtype)
        patches = self.backbone(images.reshape(b * t, 3, h, w))
        p = self.cfg.patch_h * self.cfg.patch_w
        patches = patches.flatten(2).transpose(1, 2).reshape(b, t, p, self.cfg.dim)
        patches = patches + self.image_pos(self.patch_xy)[None, None, :, :]
        patches = patches + self.time_pos(times[..., None] / 2.0)[:, :, None, :]
        memory = patches.reshape(b, t * p, self.cfg.dim)
        memory_valid = valid[:, :, None].expand(b, t, p).reshape(b, t * p)
        query = self.bev_queries.expand(b, -1, -1) + self.bev_pos(self.bev_xy)[None]
        for block in self.blocks:
            query = block(query, memory, memory_valid)
        bev = self.final_norm(query)
        # Descriptors summarize image evidence, not only position-bearing BEV queries.
        pooled = (memory * memory_valid[..., None]).sum(1) / memory_valid.sum(1, keepdim=True)
        identity = F.normalize(self.identity_head(pooled), dim=-1)
        return BEVFeatures(bev=bev, identity=identity)
