"""Fixture tests for Committee Power."""
from feeder.influence import committee


def test_chair_of_power_committee_tops():
    m = {
        "CHAIR_APPROP": [
            {"title": "chair", "rank": 1, "is_subcommittee": False, "committee_external_id": "HSAP"},
        ],
        "RANKING_MINOR": [
            {"title": "ranking", "rank": 1, "is_subcommittee": False, "committee_external_id": "HSXX"},
        ],
        "MEMBER_MANY": [
            {"title": None, "rank": 5, "is_subcommittee": False, "committee_external_id": "HSAG"},
            {"title": None, "rank": 9, "is_subcommittee": False, "committee_external_id": "HSED"},
            {"title": None, "rank": 12, "is_subcommittee": False, "committee_external_id": "HSSY"},
        ],
        "SUBCOMM_ONLY": [
            {"title": None, "rank": 3, "is_subcommittee": True, "committee_external_id": "HSAG"},
        ],
    }
    out = committee.compute(m)

    assert out["CHAIR_APPROP"]["score"] == 100.0
    assert out["CHAIR_APPROP"]["raw"] > max(
        out[p]["raw"] for p in out if p != "CHAIR_APPROP"
    )
    # A lone subcommittee seat is the floor.
    assert out["SUBCOMM_ONLY"]["score"] == 0.0
    assert all(0.0 <= out[p]["score"] <= 100.0 for p in out)

    ev = out["CHAIR_APPROP"]["evidence"]
    assert ev["chairs"] == 1
    assert ev["top_committee"] == "HSAP"


def test_chair_beats_member_same_committee():
    out = committee.compute({
        "chair": [{"title": "chair", "is_subcommittee": False, "committee_external_id": "HSAP"}],
        "member": [{"title": None, "is_subcommittee": False, "committee_external_id": "HSAP"}],
    })
    assert out["chair"]["raw"] > out["member"]["raw"]


def test_power_committee_beats_minor():
    out = committee.compute({
        "power": [{"title": None, "is_subcommittee": False, "committee_external_id": "HSAP"}],
        "minor": [{"title": None, "is_subcommittee": False, "committee_external_id": "HSZZ"}],
    })
    assert out["power"]["raw"] > out["minor"]["raw"]
