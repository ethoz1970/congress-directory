"""Network Centrality component — the cosponsorship graph.

Nodes = members. An edge links two members who appear together on a bill
(as sponsor or cosponsor), weighted by how many bills they share. A
member's centrality blends weighted **eigenvector centrality** (who sits
at the center of the cosponsorship web — connected to other
well-connected members; the standard measure in the cosponsorship-network
literature) and **betweenness** (who bridges otherwise-separate clusters).
Uses networkx — a real graph lib, not hand-rolled.

Input: {bill_id: [member_id, ...]} — every member attached to each bill
(sponsor + cosponsors). Output: {member_id: {score 0-100, raw, evidence}}.

Note on edge weight vs. distance: cosponsorship weight is *strength*
(more shared bills = closer). Eigenvector centrality wants strength
directly. networkx betweenness treats `weight` as *distance*, so we feed
it 1/weight — heavy ties become short paths.
"""
from __future__ import annotations

from itertools import combinations

from .normalize import minmax_0_100

DEFAULT_EIGENVECTOR_WEIGHT = 0.7
DEFAULT_BETWEENNESS_WEIGHT = 0.3


def build_graph(bill_members: dict):
    """Project bills into a weighted co-cosponsorship graph."""
    import networkx as nx

    g = nx.Graph()
    for members in bill_members.values():
        uniq = sorted({m for m in members if m})
        g.add_nodes_from(uniq)
        for a, b in combinations(uniq, 2):
            if g.has_edge(a, b):
                g[a][b]["weight"] += 1
            else:
                g.add_edge(a, b, weight=1)
    return g


def compute(
    bill_members: dict,
    *,
    eigenvector_weight: float = DEFAULT_EIGENVECTOR_WEIGHT,
    betweenness_weight: float = DEFAULT_BETWEENNESS_WEIGHT,
    betweenness_k: int | None = None,
) -> dict:
    """Score Network Centrality for every member in the graph.

    `betweenness_k` samples that many pivot nodes for an approximate (much
    faster) betweenness on the full ~540-node roster; None = exact.
    """
    import networkx as nx

    g = build_graph(bill_members)
    if g.number_of_nodes() == 0:
        return {}

    if g.number_of_edges() > 0:
        try:
            ev = nx.eigenvector_centrality(g, weight="weight", max_iter=1000, tol=1e-6)
        except (nx.PowerIterationFailedConvergence, nx.NetworkXError):
            # Disconnected / pathological graph — degree centrality is a
            # robust fallback that's still a real centrality signal.
            ev = nx.degree_centrality(g)
        for _u, _v, d in g.edges(data=True):
            d["distance"] = 1.0 / d["weight"]
        bt = nx.betweenness_centrality(
            g, weight="distance", k=betweenness_k, normalized=True
        )
    else:
        ev = {n: 0.0 for n in g}
        bt = {n: 0.0 for n in g}

    # Normalize each measure to 0–100, blend, then re-normalize so the
    # component output is a clean 0–100 sub-score.
    ev_n = minmax_0_100(ev)
    bt_n = minmax_0_100(bt)
    raw = {
        n: eigenvector_weight * ev_n[n] + betweenness_weight * bt_n[n] for n in g
    }
    scores = minmax_0_100(raw)

    return {
        n: {
            "score": scores[n],
            "raw": round(raw[n], 2),
            "evidence": {
                "eigenvector": round(ev[n], 5),
                "betweenness": round(bt[n], 5),
                "degree": g.degree(n),
            },
        }
        for n in g
    }
