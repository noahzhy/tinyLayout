import pytest
import torch
from structmap_jepa.losses import (masked_jepa_loss, known_semantic_loss,
                                    candidate_energy, counterfactual_margin_loss)


def test_empty_support_loss_is_zero_and_differentiable():
    p = torch.randn(2, 4, 8, requires_grad=True)
    t = torch.randn_like(p)
    loss = masked_jepa_loss(p, t, torch.zeros(2, 4, dtype=torch.bool))
    assert loss.item() == 0
    loss.backward()
    assert p.grad is not None and p.grad.abs().sum() == 0


def test_unknown_semantics_do_not_become_negatives():
    logits = torch.randn(2, 4, 3, requires_grad=True)
    labels = torch.full((2, 4), -1, dtype=torch.long)
    loss = known_semantic_loss(logits, labels)
    assert loss.item() == 0
    loss.backward()
    assert logits.grad.abs().sum() == 0


def test_unsupported_nan_targets_are_ignored():
    p = torch.randn(1, 4, 8, requires_grad=True)
    t = p.detach().clone()
    t[:, 2:] = float("nan")
    valid = torch.tensor([[True, True, False, False]])
    loss = masked_jepa_loss(p, t, valid)
    assert torch.isfinite(loss) and loss.item() == 0
    assert torch.isfinite(candidate_energy(p, t, valid)).all()


def test_low_support_is_not_a_good_score():
    p = torch.randn(2, 4, 8)
    valid = torch.tensor([[True, False, False, False], [True, True, False, False]])
    e = candidate_energy(p, p, valid, min_support=2)
    assert torch.isinf(e[0])
    assert abs(e[1].item()) < 1e-6


def test_target_is_stop_gradient():
    p = torch.randn(1, 4, 8, requires_grad=True)
    t = torch.randn(1, 4, 8, requires_grad=True)
    masked_jepa_loss(p, t, torch.ones(1, 4, dtype=torch.bool)).backward()
    assert p.grad is not None
    assert t.grad is None


def test_invalid_semantic_labels_rejected():
    with pytest.raises(ValueError):
        known_semantic_loss(torch.randn(1, 2, 3), torch.tensor([[0, 3]]))


def test_counterfactual_margin_has_expected_sign():
    pos = torch.tensor([0.2, 0.9], requires_grad=True)
    neg = torch.tensor([0.8, 0.3], requires_grad=True)
    loss = counterfactual_margin_loss(pos, neg, torch.tensor([True, True]), margin=0.1)
    assert abs(loss.item() - 0.35) < 1e-6
    loss.backward()
    assert pos.grad[1] > 0 and neg.grad[1] < 0


def test_invalid_counterfactuals_not_used():
    pos = torch.tensor([float("inf")], requires_grad=True)
    neg = torch.tensor([0.2], requires_grad=True)
    loss = counterfactual_margin_loss(pos, neg, torch.tensor([True]))
    assert torch.isfinite(loss) and loss.item() == 0
