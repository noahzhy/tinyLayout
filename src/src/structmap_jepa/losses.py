"""Masked loss primitives. Unknown targets never become negative labels."""
import torch
from torch import Tensor
from torch.nn import functional as F


def _check_latents(predicted: Tensor, target: Tensor, mask: Tensor) -> None:
    if predicted.ndim != 3 or target.shape != predicted.shape:
        raise ValueError("latent tensors must both be [B,N,D]")
    if mask.shape != predicted.shape[:2] or mask.dtype != torch.bool:
        raise ValueError("mask must be bool [B,N]")


def masked_jepa_loss(predicted: Tensor, target: Tensor, support: Tensor) -> Tensor:
    _check_latents(predicted, target, support)
    if not support.any().item():
        return predicted.sum() * 0.0
    # Select valid positions before computing distances; hidden NaN labels are ignored.
    p = F.layer_norm(predicted[support], (predicted.shape[-1],))
    t = F.layer_norm(target.detach()[support], (target.shape[-1],))
    return F.smooth_l1_loss(p, t)


def known_semantic_loss(logits: Tensor, labels: Tensor) -> Tensor:
    if logits.ndim != 3 or labels.shape != logits.shape[:2] or labels.dtype != torch.long:
        raise ValueError("expected logits [B,N,C] and int64 labels [B,N]")
    if (labels < -1).any().item() or (labels >= logits.shape[-1]).any().item():
        raise ValueError("labels must be -1 (unknown) or a valid class id")
    valid = labels >= 0
    if not valid.any().item():
        return logits.sum() * 0.0
    return F.cross_entropy(logits[valid], labels[valid])


def candidate_energy(predicted: Tensor, observed: Tensor, support: Tensor, min_support: int = 2) -> Tensor:
    _check_latents(predicted, observed, support)
    if min_support < 1:
        raise ValueError("min_support must be >= 1")
    # Use sanitized tensors so unsupported cells cannot contribute NaNs.
    p = F.normalize(predicted.masked_fill(~support[..., None], 0), dim=-1)
    o = F.normalize(observed.masked_fill(~support[..., None], 0), dim=-1)
    per_cell = 1.0 - (p * o).sum(-1)
    count = support.sum(-1)
    mean = per_cell.masked_fill(~support, 0).sum(-1) / count.clamp_min(1)
    return torch.where(count >= min_support, mean, torch.full_like(mean, float("inf")))


def counterfactual_margin_loss(positive: Tensor, negative: Tensor, valid: Tensor, margin: float = 0.1) -> Tensor:
    if positive.shape != negative.shape or valid.shape != positive.shape or valid.dtype != torch.bool:
        raise ValueError("positive, negative, valid must have identical shapes; valid must be bool")
    if margin < 0:
        raise ValueError("margin must be nonnegative")
    usable = valid & torch.isfinite(positive) & torch.isfinite(negative)
    if not usable.any().item():
        return torch.where(torch.isfinite(positive), positive, torch.zeros_like(positive)).sum() * 0
    return F.relu(margin + positive[usable] - negative[usable]).mean()
