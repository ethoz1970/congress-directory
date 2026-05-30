"""Fixture tests for Network Centrality.

A small co-cosponsorship graph where one member ("HUB") is on every bill
and bridges two otherwise-separate pairs — it should top centrality.
"""
from feeder.influence import centrality


def test_hub_is_most_central():
    bill_members = {
        "b1": ["HUB", "A", "B"],
        "b2": ["HUB", "C", "D"],
        "b3": ["HUB", "A", "C"],
    }
    out = centrality.compute(bill_members)

    # Only members on bills are scored.
    assert set(out) == {"HUB", "A", "B", "C", "D"}
    # HUB connects to all four others and bridges {A,B} ↔ {C,D}.
    assert out["HUB"]["evidence"]["degree"] == 4
    assert out["HUB"]["score"] == 100.0
    assert out["HUB"]["raw"] >= max(out[m]["raw"] for m in out if m != "HUB")
    assert all(0.0 <= out[m]["score"] <= 100.0 for m in out)


def test_empty_graph():
    assert centrality.compute({}) == {}


def test_weight_accumulates_on_shared_bills():
    g = centrality.build_graph({"b1": ["A", "B"], "b2": ["A", "B"]})
    assert g["A"]["B"]["weight"] == 2
