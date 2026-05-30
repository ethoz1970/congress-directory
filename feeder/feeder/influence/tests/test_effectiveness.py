"""Fixture tests for the Legislative Effectiveness component.

Fixtures mirror the real Prism bill shape (bill_number, title, status).
"""
from feeder.influence import effectiveness


def test_ranks_by_stage_and_significance():
    bills_by_member = {
        # Workhorse: enacted + passed-chamber + a substantive bill in committee.
        "A": [
            {"bill_number": "HR 100", "title": "Clean Water Restoration Act", "status": "signed"},
            {"bill_number": "HR 101", "title": "Rural Broadband Act", "status": "passed_one_chamber"},
            {"bill_number": "HR 102", "title": "Veterans Housing Act", "status": "committee"},
        ],
        # Show-horse: all commemorative resolutions.
        "B": [
            {"bill_number": "HRES 1", "title": "Recognizing National Pickle Week", "status": "introduced"},
            {"bill_number": "HRES 2", "title": "Congratulating the hometown team", "status": "introduced"},
            {"bill_number": "HRES 3", "title": "Expressing support for the goals and ideals of X", "status": "committee"},
        ],
        # One substantive bill stuck in committee.
        "C": [
            {"bill_number": "S 50", "title": "Small Business Tax Relief Act", "status": "committee"},
        ],
        # No sponsored bills.
        "D": [],
    }

    out = effectiveness.compute(bills_by_member)

    # Top of the roster normalizes to 100, floor to 0.
    assert out["A"]["score"] == 100.0
    assert out["D"]["score"] == 0.0

    # Substantive progress > stuck-substantive > commemoratives (by raw).
    assert out["A"]["raw"] > out["C"]["raw"] > out["B"]["raw"]

    # Scores stay in range.
    assert all(0.0 <= out[p]["score"] <= 100.0 for p in out)

    # Evidence is transparent.
    assert out["A"]["evidence"]["by_stage"].get("enacted") == 1
    assert out["A"]["evidence"]["commemorative"] == 0
    assert out["B"]["evidence"]["commemorative"] == 3


def test_commemorative_detection():
    assert effectiveness.is_commemorative({"title": "Recognizing National Donut Day"})
    assert effectiveness.is_commemorative(
        {"title": "Expressing support for the goals and ideals of Earth Day"}
    )
    assert effectiveness.is_commemorative({"title": "Congratulating the team on a championship"})
    assert not effectiveness.is_commemorative({"title": "Affordable Insulin Act of 2026"})
    assert not effectiveness.is_commemorative({"title": "National Defense Authorization Act"})


def test_enacted_beats_introduced_one_to_one():
    out = effectiveness.compute(
        {
            "enactor": [{"bill_number": "HR 1", "title": "Big Substantive Act", "status": "signed"}],
            "filer": [{"bill_number": "HR 2", "title": "Another Substantive Act", "status": "introduced"}],
        }
    )
    assert out["enactor"]["raw"] > out["filer"]["raw"]
    assert out["enactor"]["score"] == 100.0
    assert out["filer"]["score"] == 0.0
