"""Validated small-model settings. Unrecognized options fail loudly."""
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import yaml


@dataclass(frozen=True)
class ModelConfig:
    dim: int = 128
    heads: int = 4
    layers: int = 2
    bev_h: int = 16
    bev_w: int = 16
    patch_h: int = 7
    patch_w: int = 7
    identity_dim: int = 256
    memory_dim: int = 12
    semantic_classes: int = 4
    ema_decay: float = 0.996
    dropout: float = 0.0

    def __post_init__(self) -> None:
        for name in ("dim", "heads", "layers", "bev_h", "bev_w", "patch_h",
                     "patch_w", "identity_dim", "memory_dim", "semantic_classes"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if self.dim % self.heads:
            raise ValueError("dim must be divisible by heads")
        if not 0 <= self.ema_decay < 1:
            raise ValueError("ema_decay must be in [0, 1)")
        if not 0 <= self.dropout < 1:
            raise ValueError("dropout must be in [0, 1)")

    @property
    def cells(self) -> int:
        return self.bev_h * self.bev_w


@dataclass(frozen=True)
class RuntimeConfig:
    seed: int = 17
    batch_size: int = 2
    image_size: int = 32
    context_frames: int = 2
    teacher_frames: int = 3
    memory_tokens: int = 4
    learning_rate: float = 1e-3
    num_threads: int = 1

    def __post_init__(self) -> None:
        for name in ("batch_size", "image_size", "context_frames", "teacher_frames", "num_threads"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if self.image_size < 8:
            raise ValueError("image_size must be >= 8")
        if not isinstance(self.memory_tokens, int) or self.memory_tokens < 0:
            raise ValueError("memory_tokens must be a nonnegative integer")
        if self.teacher_frames <= self.context_frames:
            raise ValueError("teacher must have at least one additional view in this smoke")
        if self.learning_rate <= 0:
            raise ValueError("learning_rate must be positive")


def load_config(path: str | Path) -> tuple[ModelConfig, RuntimeConfig]:
    with Path(path).open(encoding="utf-8") as f:
        data: Any = yaml.safe_load(f)
    if not isinstance(data, dict) or set(data) != {"model", "runtime"}:
        raise ValueError("config must contain exactly model and runtime mappings")
    if not isinstance(data["model"], dict) or not isinstance(data["runtime"], dict):
        raise ValueError("model and runtime must be mappings")
    return ModelConfig(**data["model"]), RuntimeConfig(**data["runtime"])
