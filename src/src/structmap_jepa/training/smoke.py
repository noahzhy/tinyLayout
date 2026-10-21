"""Finite CPU forward/backward/EMA smoke with random tensors, not model training evidence."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import platform
import torch
from structmap_jepa.config import load_config
from structmap_jepa.data.toy import random_batch, model_inputs
from structmap_jepa.losses import known_semantic_loss, masked_jepa_loss
from structmap_jepa.models.jepa import StructMapJEPA


def run_smoke(config: Path, steps: int, output: Path) -> dict:
    if steps < 1:
        raise ValueError("steps must be positive")
    cfg, runtime = load_config(config)
    torch.set_num_threads(runtime.num_threads)
    torch.manual_seed(runtime.seed)
    model = StructMapJEPA(cfg).cpu().train()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),
                                 lr=runtime.learning_rate)
    history = []
    for step in range(steps):
        batch = random_batch(cfg, runtime, runtime.seed + step)
        result = model(**model_inputs(batch))
        assert result.target is not None
        mask = batch["teacher_support"] & batch["target_region"]
        jepa = masked_jepa_loss(result.prediction, result.target, mask)
        semantic = known_semantic_loss(result.semantic_logits, batch["semantic_labels"])
        loss = jepa + 0.1 * semantic
        if not torch.isfinite(loss):
            raise RuntimeError("nonfinite smoke loss")
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        gradients = [p.grad for p in model.parameters() if p.requires_grad and p.grad is not None]
        if not gradients or not all(torch.isfinite(g).all().item() for g in gradients):
            raise RuntimeError("missing or nonfinite gradients")
        if any(p.grad is not None for p in model.target_encoder.parameters()):
            raise RuntimeError("teacher incorrectly received gradients")
        grad_norm = torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        optimizer.step()
        model.update_target()
        history.append({"step": step, "total": float(loss.detach()), "jepa": float(jepa.detach()),
                        "semantic": float(semantic.detach()), "valid_target_cells": int(mask.sum()),
                        "grad_norm_before_clip": float(grad_norm)})
    model.eval()
    # In a real sample this observation must be the independent held-out arrived view.
    context = model.observe(batch["context_images"], batch["context_valid"], batch["context_times"])
    tc = runtime.context_frames
    observation = model.observe(batch["teacher_images"][:, tc:], batch["teacher_valid"][:, tc:],
                                batch["teacher_times"][:, tc:])
    candidates = torch.stack([batch["memory_features"], -batch["memory_features"]], dim=1)
    valid = batch["memory_valid"][:, None].expand(-1, 2, -1)
    energies = model.score_candidates(context.bev, observation.bev, candidates, valid,
                                     batch["teacher_support"], min_support=1)
    if not torch.isfinite(energies).all().item():
        raise RuntimeError("nonfinite candidate score with sufficient support")
    report = {
        "status": "passed", "data_kind": "random_tensor_interface_smoke",
        "not_real_mapping_performance": True, "device": "cpu",
        "python": platform.python_version(), "torch": torch.__version__,
        "model_config": asdict(cfg), "runtime_config": asdict(runtime),
        "trainable_parameters": sum(p.numel() for p in model.parameters() if p.requires_grad),
        "teacher_parameters": sum(p.numel() for p in model.target_encoder.parameters()),
        "steps": history, "candidate_energies": energies.tolist(),
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/smoke.yaml"))
    parser.add_argument("--steps", type=int, default=3)
    parser.add_argument("--output", type=Path, default=Path("runs/smoke"))
    args = parser.parse_args()
    print(json.dumps(run_smoke(args.config, args.steps, args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
