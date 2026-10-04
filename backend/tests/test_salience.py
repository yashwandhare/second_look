"""Tests for the deterministic attention analysis.

This is the part of the audit that must be provably correct: it makes claims
about the user's own text, so the counting has to be right.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.salience import analyse_salience  # noqa: E402


def test_counts_repeated_mentions() -> None:
    """A word used several times is counted each time."""
    report = analyse_salience("stipend stipend stipend location")
    pay = next(s for s in report.emphasised if s.key == "compensation")
    assert pay.mentions == 3


def test_identifies_silent_dimensions() -> None:
    """Dimensions with no mention are reported as silent."""
    report = analyse_salience("The stipend is good and the commute is short.")
    silent_keys = {s.key for s in report.silent}
    assert "learning" in silent_keys
    assert "opportunity_cost" in silent_keys
    assert "compensation" not in silent_keys


def test_dominant_dimension_is_first() -> None:
    """The emphasised list is ordered by attention."""
    report = analyse_salience("stipend pay salary money commute")
    assert report.emphasised[0].key == "compensation"
    assert report.emphasised[0].mentions == 4


def test_shares_sum_to_one_when_mentions_exist() -> None:
    """Attention shares form a distribution."""
    report = analyse_salience("stipend academics stipend")
    total_share = sum(s.share for s in report.emphasised)
    assert abs(total_share - 1.0) < 0.001


def test_no_mentions_produces_a_honest_note() -> None:
    """Text with none of the tracked words admits it measured nothing."""
    report = analyse_salience("zzz qqq")
    assert report.total_mentions == 0
    assert "no attention pattern could be measured" in report.note
    assert report.emphasised == []


def test_note_names_the_dominant_dimension() -> None:
    """The plain-language note leads with what dominated."""
    report = analyse_salience("stipend stipend stipend")
    assert "pay and compensation" in report.note


def test_word_boundaries_avoid_false_matches() -> None:
    """A keyword inside a longer word does not count as a mention."""
    # "pay" must not match "paying".
    report = analyse_salience("paying attention to the situation")
    assert report.total_mentions == 0


def test_phrases_are_matched_whole() -> None:
    """Multi-word signals are matched as phrases."""
    report = analyse_salience("The opportunity cost is real. What I give up matters.")
    opportunity = next(s for s in report.emphasised if s.key == "opportunity_cost")
    assert opportunity.mentions == 2


def test_multiple_text_arguments_are_combined() -> None:
    """Reasons and priorities are analysed together."""
    report = analyse_salience("stipend is good", "academics matter most")
    keys = {s.key for s in report.emphasised}
    assert {"compensation", "academics"} <= keys


def test_empty_input_is_handled() -> None:
    """Empty text does not raise."""
    report = analyse_salience("", "")
    assert report.total_mentions == 0


# ---------------------------------------------------------------------------
# Decision-specific dimensions
# ---------------------------------------------------------------------------


def test_custom_dimensions_replace_the_builtin_set() -> None:
    """A decision-specific dimension set is what gets measured."""
    from backend.services.salience import Dimension

    dims = (
        Dimension(key="rent", label="Monthly rent", keywords=("rent", "emi")),
        Dimension(
            key="deposit",
            label="Upfront deposit",
            keywords=("deposit", "down payment"),
        ),
    )
    report = analyse_salience(
        "The rent keeps rising and the deposit is large.", dimensions=dims
    )
    assert report.total_mentions == 2
    assert {d.key for d in report.emphasised} == {"rent", "deposit"}


def test_missing_dimension_role_is_reported_silent() -> None:
    """With custom dimensions, an unmentioned one is the finding."""
    from backend.services.salience import Dimension

    dims = (
        Dimension(key="rent", label="Monthly rent", keywords=("rent",)),
        Dimension(key="resale", label="Resale value", keywords=("resale",)),
    )
    report = analyse_salience("The rent is high.", dimensions=dims)
    assert [d.key for d in report.silent] == ["resale"]


def test_house_decision_no_longer_reports_nothing() -> None:
    """The regression this generalisation exists to prevent.

    Before dimensions became decision-specific, a non-career decision matched
    no keywords and the UI reported that nothing could be measured, which
    reads as a broken tool.
    """
    from backend.services.salience import Dimension

    dims = (
        Dimension(
            key="monthly_cost",
            label="Monthly housing cost",
            keywords=("rent", "emi", "mortgage"),
        ),
        Dimension(
            key="upfront",
            label="Upfront cost",
            keywords=("deposit", "down payment"),
        ),
    )
    report = analyse_salience(
        "The rent is nearly my whole salary and the down payment is huge.",
        dimensions=dims,
    )
    assert report.total_mentions > 0
    assert "no attention pattern could be measured" not in report.note


def test_dimension_from_spec_builds_a_usable_dimension() -> None:
    """A model-supplied label and keywords become a countable dimension."""
    from backend.services.salience import dimension_from_spec

    dim = dimension_from_spec("Monthly Housing Cost", ["Rent", " EMI "])
    assert dim.key == "monthly_housing_cost"
    assert dim.keywords == ("rent", "emi")


def test_dimension_from_spec_discards_blank_keywords() -> None:
    """Blank or missing keywords do not create empty patterns."""
    from backend.services.salience import dimension_from_spec

    dim = dimension_from_spec("Cost", ["rent", "", "   "])
    assert dim.keywords == ("rent",)
