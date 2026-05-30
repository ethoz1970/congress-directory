"""Tests for the composite — especially the renormalization when some
components aren't computable yet (the first-pass reality)."""
from feeder.influence import composite
from feeder.influence.config import COMPONENT_WEIGHTS


def test_renormalizes_over_present_components():
    # First-pass reality: 3 derivable components present, votes + media None.
    s = {
        "legislative_effectiveness": 100,
        "network_centrality": 0,
        "committee_power": 0,
        "vote_pivotality": None,
        "media_salience": None,
    }
    # eff weight 0.30 of present-sum 0.80 → 0.30/0.80*100 = 37.5
    assert composite.composite(s) == 37.5


def test_all_present_full_weight():
    assert composite.composite({k: 100 for k in COMPONENT_WEIGHTS}) == 100.0


def test_all_none_is_zero():
    assert composite.composite({k: None for k in COMPONENT_WEIGHTS}) == 0.0


def test_single_component_passes_through():
    s = {
        "committee_power": 80,
        "legislative_effectiveness": None,
        "network_centrality": None,
        "vote_pivotality": None,
        "media_salience": None,
    }
    assert composite.composite(s) == 80.0
