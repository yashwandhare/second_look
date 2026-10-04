"""Deterministic attention analysis.

The problem statement says people decide using "the information that is most
visible to them". This module measures that visibility directly: it counts how
much of the user's own text each decision dimension occupies.

The counting is done here, in plain Python, rather than asked of a language
model. That keeps the claim defensible ("you used these words this many times")
and makes the behaviour unit-testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from backend.models.schemas import DimensionScore, SalienceReport


@dataclass(frozen=True)
class Dimension:
    """A decision dimension and the words that signal it."""

    key: str
    label: str
    keywords: tuple[str, ...]


def dimension_from_spec(label: str, keywords: list[str]) -> Dimension:
    """Build a dimension from a model-supplied label and keyword list.

    The model names what this particular decision turns on; Python still does
    every count, so the resulting claim stays checkable.
    """
    cleaned = [k.strip().lower() for k in keywords if k and k.strip()]
    key = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_") or "dimension"
    return Dimension(key=key, label=label.strip(), keywords=tuple(cleaned))


# Fallback dimensions, used when a caller supplies none. These are general
# enough for most personal decisions but cannot cover every domain, which is
# why callers should pass decision-specific dimensions when they can.
DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(
        "compensation",
        "Pay and compensation",
        ("stipend", "salary", "pay", "paid", "money", "compensation", "wage",
         "package", "ctc", "remuneration", "income"),
    ),
    Dimension(
        "location",
        "Location and commute",
        ("location", "commute", "commuting", "near", "close to home", "distance",
         "travel", "relocate", "relocation", "city", "remote", "onsite"),
    ),
    Dimension(
        "career_growth",
        "Career growth",
        ("career", "growth", "promotion", "resume", "cv", "portfolio",
         "progression", "seniority", "title", "brand value", "experience"),
    ),
    Dimension(
        "learning",
        "Learning and mentorship",
        ("learn", "learning", "skill", "skills", "training", "mentor",
         "mentorship", "guidance", "mentored", "teaching", "exposure"),
    ),
    Dimension(
        "workload",
        "Workload and hours",
        ("hours", "workload", "overtime", "work-life", "worklife", "burnout",
         "schedule", "shift", "part-time", "full-time", "week"),
    ),
    Dimension(
        "academics",
        "Academics and study",
        ("academic", "academics", "college", "university", "semester", "exam",
         "exams", "gpa", "grades", "cgpa", "study", "studies", "course",
         "courses", "thesis", "project work", "attendance"),
    ),
    Dimension(
        "opportunity_cost",
        "What you give up",
        ("opportunity", "opportunity cost", "give up", "giving up", "instead",
         "alternative", "alternatives", "forego", "forgo", "miss out",
         "turn down", "say no", "other options"),
    ),
    Dimension(
        "conversion",
        "What happens after",
        ("conversion", "convert", "full-time offer", "full time offer", "ppo",
         "pre-placement", "return offer", "job offer", "permanent", "future role",
         "after the internship", "extension"),
    ),
    Dimension(
        "risk",
        "Risk and uncertainty",
        ("risk", "risky", "uncertain", "uncertainty", "worried", "worry",
         "concerned", "concern", "might fail", "backup", "fallback", "downside",
         "worst case", "safe"),
    ),
    Dimension(
        "wellbeing",
        "Health and wellbeing",
        ("health", "mental", "stress", "stressful", "wellbeing", "well-being",
         "sleep", "family", "friends", "partner", "happiness", "personal life"),
    ),
)

DIMENSION_BY_KEY = {d.key: d for d in DIMENSIONS}


def _normalise(text: str) -> str:
    """Lowercase and collapse whitespace so keyword matching is predictable."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def _count_keyword(haystack: str, keyword: str) -> int:
    """Count whole-word or whole-phrase occurrences of one keyword."""
    return len(_find_spans(haystack, keyword))


def _find_spans(haystack: str, keyword: str) -> list[tuple[int, int]]:
    """Return the character spans where a keyword occurs as a whole word."""
    pattern = r"(?<!\w)" + re.escape(keyword) + r"(?!\w)"
    return [(m.start(), m.end()) for m in re.finditer(pattern, haystack)]


def _match_dimensions(haystack: str, dimensions: tuple[Dimension, ...]) -> dict[str, int]:
    """Count mentions per dimension, resolving overlapping matches.

    A phrase and its component word can both match the same text, for example
    "opportunity cost" and "opportunity". Counting both would inflate the
    user's apparent attention, so the longest match wins and the spans it
    covers are not counted again.

    Returns:
        Mention counts keyed by dimension key.
    """
    candidates: list[tuple[int, int, str, int]] = []
    for dimension in dimensions:
        for keyword in dimension.keywords:
            for start, end in _find_spans(haystack, keyword):
                candidates.append((start, end, dimension.key, len(keyword)))

    # Earliest first; at the same position the longest keyword wins.
    candidates.sort(key=lambda c: (c[0], -c[3]))

    counts = {dimension.key: 0 for dimension in dimensions}
    taken: list[tuple[int, int]] = []
    for start, end, key, _length in candidates:
        if any(start < t_end and end > t_start for t_start, t_end in taken):
            continue  # overlaps a match already counted
        taken.append((start, end))
        counts[key] += 1

    return counts


def analyse_salience(
    *texts: str,
    dimensions: tuple[Dimension, ...] | None = None,
    silence_threshold: float = 0.0,
) -> SalienceReport:
    """Measure how much attention each decision dimension received.

    Args:
        *texts: The user's own words, for example reasons and priorities.
        dimensions: The dimensions to measure. Pass decision-specific ones when
            available; otherwise a general set is used.
        silence_threshold: Share at or below which a mentioned dimension counts
            as silent. The default treats only zero mentions as silent.

    Returns:
        A report listing emphasised dimensions and silent dimensions.
    """
    active = dimensions if dimensions else DIMENSIONS
    haystack = _normalise(" ".join(t for t in texts if t))

    counts = _match_dimensions(haystack, active)

    total = sum(counts.values())

    scores: list[DimensionScore] = []
    for dimension in active:
        mentions = counts[dimension.key]
        share = (mentions / total) if total else 0.0
        scores.append(
            DimensionScore(
                key=dimension.key,
                label=dimension.label,
                mentions=mentions,
                share=round(share, 4),
            )
        )

    mentioned = [s for s in scores if s.mentions > 0]
    silent = [s for s in scores if s.mentions == 0 or s.share <= silence_threshold]

    # Emphasised first, by how much attention they took.
    emphasised = sorted(mentioned, key=lambda s: s.mentions, reverse=True)

    if not total:
        note = (
            "Your description did not use any of the words this analysis looks "
            "for, so no attention pattern could be measured."
        )
    else:
        top = emphasised[0]
        silent_labels = [s.label.lower() for s in silent]
        if silent_labels:
            note = (
                f"Most of your description is about {top.label.lower()} "
                f"({top.mentions} of {total} references). You did not mention "
                f"{_join(silent_labels)} at all."
            )
        else:
            note = (
                f"Most of your description is about {top.label.lower()} "
                f"({top.mentions} of {total} references). Every dimension this "
                "analysis tracks appeared at least once."
            )

    return SalienceReport(
        total_mentions=total,
        emphasised=emphasised,
        silent=silent,
        note=note,
    )


def _join(items: list[str]) -> str:
    """Join labels into readable prose."""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return ", ".join(items[:-1]) + f", or {items[-1]}"
