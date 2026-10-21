import io
import pytest
import torch
from structmap_jepa.data.toy import random_batch, model_inputs
from structmap_jepa.models.jepa import StructMapJEPA
from structmap_jepa.models.bev import chart_grid
from structmap_jepa.losses import masked_jepa_loss, known_semantic_loss
from structmap_jepa.config import ModelConfig, load_config


def test_forward_backward_ema(cfg, runtime):
    model = StructMapJEPA(cfg).train()
    batch = random_batch(cfg, runtime)
    output = model(**model_inputs(batch))
    assert output.prediction.shape == (runtime.batch_size, cfg.cells, cfg.dim)
    assert output.semantic_logits.shape == (runtime.batch_size, cfg.cells, cfg.semantic_classes)
    assert output.identity.shape == (runtime.batch_size, cfg.identity_dim)
    assert not model.target_encoder.training
    assert output.target is not None and not output.target.requires_grad
    loss = masked_jepa_loss(output.prediction, output.target, batch["teacher_support"])
    loss = loss + known_semantic_loss(output.semantic_logits, batch["semantic_labels"])
    loss.backward()
    assert model.predictor.queries.grad is not None
    assert model.online_encoder.bev_queries.grad is not None
    assert all(p.grad is None for p in model.target_encoder.parameters())
    optimizer = torch.optim.SGD((p for p in model.parameters() if p.requires_grad), lr=0.01)
    optimizer.step()
    old = next(model.target_encoder.parameters()).detach().clone()
    online = next(model.online_encoder.parameters()).detach().clone()
    model.update_target(0.5)
    assert torch.allclose(next(model.target_encoder.parameters()), 0.5 * old + 0.5 * online)


def test_target_views_cannot_change_prediction(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    first = model(**model_inputs(batch))
    batch["teacher_images"] = torch.rand_like(batch["teacher_images"])
    second = model(**model_inputs(batch))
    assert torch.equal(first.prediction, second.prediction)
    assert not torch.allclose(first.target, second.target)


def test_padding_contents_do_not_change_encoder(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    valid = batch["context_valid"].clone()
    valid[:, -1] = False
    images = batch["context_images"].clone()
    times = batch["context_times"].clone()
    first = model.observe(images, valid, times).bev
    images[:, -1] = float("nan")
    times[:, -1] = float("nan")
    second = model.observe(images, valid, times).bev
    assert torch.equal(first, second)


def test_all_padding_rejected(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    batch["context_valid"][:] = False
    with pytest.raises(ValueError, match="at least one"):
        model(**model_inputs(batch))


def test_null_memory_and_padded_memory(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    batch["memory_features"] = torch.empty(runtime.batch_size, 0, cfg.memory_dim)
    batch["memory_valid"] = torch.empty(runtime.batch_size, 0, dtype=torch.bool)
    empty = model(**model_inputs(batch)).prediction
    assert torch.isfinite(empty).all()
    batch["memory_features"] = torch.full((runtime.batch_size, 3, cfg.memory_dim), float("nan"))
    batch["memory_valid"] = torch.zeros(runtime.batch_size, 3, dtype=torch.bool)
    padded = model(**model_inputs(batch)).prediction
    assert torch.allclose(empty, padded, atol=1e-6)


def test_times_affect_output(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    first = model(**model_inputs(batch)).context_bev
    batch["context_times"] = batch["context_times"] * 10
    second = model(**model_inputs(batch)).context_bev
    assert not torch.allclose(first, second)


def test_candidate_score_and_observer_independence(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    context = model.observe(batch["context_images"], batch["context_valid"], batch["context_times"])
    observer_before = model.observe(batch["teacher_images"], batch["teacher_valid"], batch["teacher_times"]).bev
    candidates = torch.randn(runtime.batch_size, 3, 2, cfg.memory_dim)
    valid = torch.ones(runtime.batch_size, 3, 2, dtype=torch.bool)
    score = model.score_candidates(context.bev, observer_before, candidates, valid, batch["teacher_support"])
    assert score.shape == (runtime.batch_size, 3)
    assert torch.isfinite(score).all()
    observer_after = model.observe(batch["teacher_images"], batch["teacher_valid"], batch["teacher_times"]).bev
    assert torch.equal(observer_before, observer_after)
    no_support = torch.zeros_like(batch["teacher_support"])
    rejected = model.score_candidates(context.bev, observer_before, candidates, valid, no_support)
    assert torch.isinf(rejected).all()


def test_scoring_requires_eval(cfg, runtime):
    model = StructMapJEPA(cfg).train()
    batch = random_batch(cfg, runtime)
    with pytest.raises(RuntimeError, match="eval"):
        model.observe(batch["context_images"], batch["context_valid"], batch["context_times"])


def test_state_dict_roundtrip(cfg, runtime):
    model = StructMapJEPA(cfg).eval()
    batch = random_batch(cfg, runtime)
    expected = model(**model_inputs(batch)).prediction
    stream = io.BytesIO()
    torch.save(model.state_dict(), stream)
    stream.seek(0)
    restored = StructMapJEPA(cfg).eval()
    restored.load_state_dict(torch.load(stream, weights_only=True))
    actual = restored(**model_inputs(batch)).prediction
    assert torch.equal(expected, actual)


def test_grid_convention():
    grid = chart_grid(2, 2)
    expected = torch.tensor([[-.5, .5], [.5, .5], [-.5, -.5], [.5, -.5]])
    assert torch.equal(grid, expected)


def test_bad_configuration_rejected(tmp_path):
    with pytest.raises(ValueError):
        ModelConfig(dim=31, heads=4)
    with pytest.raises(ValueError):
        ModelConfig(ema_decay=1.0)
    p = tmp_path / "bad.yaml"
    p.write_text("model: {unexpected: 1}\nruntime: {}\n")
    with pytest.raises(TypeError):
        load_config(p)


def test_teacher_arguments_are_all_or_none(cfg, runtime):
    model = StructMapJEPA(cfg)
    batch = model_inputs(random_batch(cfg, runtime))
    del batch["teacher_times"]
    with pytest.raises(ValueError, match="together"):
        model(**batch)
