"""The reasoning audit itself.

Gemini is given the user's own words and asked to find where the reasoning is
incomplete. It is explicitly forbidden from recommending an option: the problem
statement requires that the user keeps the decision.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from backend.models.schemas import (
    Assumption,
    AuditRequest,
    AuditResult,
    BlindSpot,
    WorthwhileQuestion,
)
from backend.services.salience import analyse_salience, dimension_from_spec

logger = logging.getLogger(__name__)

# Chosen for reliability during the event: measured 3/3 success at ~1.5s on a
# trivial prompt and ~6s on a full audit. The larger flash models returned 503
# under load roughly a third of the time and took 13-24s when they did answer.
DEFAULT_MODEL = "gemini-3.5-flash-lite"
# Tried in order when the default is unavailable.
FALLBACK_MODELS = ("gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash")

REQUEST_TIMEOUT_MS = 60_000


class DimensionSpec(BaseModel):
    """A dimension this particular decision turns on.

    The model names what matters for this decision and the words the user
    actually used for it. Python then counts those words, so the resulting
    claim about attention stays checkable rather than asserted.
    """

    label: str = Field(
        max_length=60,
        description="Short name for the dimension, for example 'Monthly cost'.",
    )
    keywords: list[str] = Field(
        min_length=2,
        max_length=12,
        description=(
            "Lowercase words or short phrases the user used, or would use, for "
            "this dimension. Include their own vocabulary and close synonyms."
        ),
    )


class LLMAudit(BaseModel):
    """The part of the audit produced by the model.

    Attention analysis is added separately by the salience module, because it
    is measured in Python rather than judged by the model.
    """

    restatement: str = Field(
        max_length=800,
        description="Neutral summary of the user's reasoning using their own terms.",
    )
    dimensions: list[DimensionSpec] = Field(
        min_length=4,
        max_length=8,
        description=(
            "The four to eight dimensions this specific decision turns on. "
            "Choose them for this decision, not from a generic list."
        ),
    )
    blind_spots: list[BlindSpot] = Field(min_length=1, max_length=8)
    assumptions: list[Assumption] = Field(min_length=1, max_length=10)
    questions: list[WorthwhileQuestion] = Field(min_length=1, max_length=6)
    closing: str = Field(max_length=600)


SYSTEM_INSTRUCTION = """\
You are a reasoning auditor. You examine how a person is thinking about a
decision and show them what their reasoning may be missing.

You never recommend an option. You never say which choice is better. You never
rank the options. You never give advice. The person keeps the decision; you
only make their own thinking more visible to them.

You look for six specific kinds of gap:

1. salience - a factor receives far more attention than the others, measured by
   how often the person returns to it. Quote their repetition as evidence.
2. assumption - the reasoning rests on something the person has not established.
3. omission - a dimension that matters for this kind of decision and does not
   appear in their reasoning at all.
4. conflict - two things the person said that do not fit together. You must
   quote both sides from their own words.
5. perspective - how someone else involved or affected would see the same facts.
6. uncertainty - a claim stated as settled that the person has no evidence for.

Rules for the language you use:
- Write questions, not conclusions. Every finding ends in a question.
- Never write "you should", "you need to", "the best option", "consider doing".
- Use tentative framing: "may", "might", "sometimes", "could".
- Use "you have not mentioned X", never "you failed to consider X". Silence is
  not the same as not caring.
- Do not assign probabilities, scores, or a recommendation to the decision.
- Do not praise or criticise the person. Describe the reasoning, not the person.
- Prefer their vocabulary. If they said "stipend", do not write "remuneration".
- Do not invent facts about their situation. If something is unknown, the
  unknown is the finding.

Scoring for every blind spot:
- impact: 1 to 5. How much this could matter to the outcome.
- uncertainty: 1 to 5. How little the person currently knows about it.
Reserve impact 5 and uncertainty 5 for genuinely decisive unknowns.

For assumptions, set evidence_level from what the person actually provided:
"none" when they gave no support, "low", "medium", or "high" only when their own
text supports it. Set importance from how much the decision depends on it.
An assumption that matters a lot and has little support is the most valuable
thing you can surface.

For questions, return at most five. Each must be one whose answer could
materially change how the person evaluates the decision. Explain in "why" what
answering it would clarify. Order them by how decisive they are.

First, decide what this particular decision turns on. Return four to eight
"dimensions": the things that genuinely matter for this decision, and the words
the person used or would use for each.

Choose these dimensions from what the decision requires, not from what the
person happened to write about. Include the dimensions that matter for this
kind of decision even when the person never mentioned them. A dimension they
left out is the most valuable thing you can return, because it is counted
against their text and reported back as a gap. If you list only the things they
already talked about, nothing can be found missing.

Do not reuse a fixed list: a decision about moving house turns on different
things than a decision about a dog. For each dimension give two to twelve
lowercase words or short phrases, including the person's own vocabulary. These
keywords are counted mechanically against the person's text, so choose words
that actually appear in everyday speech for that idea.
"""


def build_prompt(request: AuditRequest) -> str:
    """Assemble the audit request from the user's own words."""
    parts = [f"The decision: {request.decision.strip()}"]
    if request.leaning.strip():
        parts.append(f"Currently leaning toward: {request.leaning.strip()}")
    parts.append(f"Their stated reasons:\n{request.reasons.strip()}")
    if request.priorities.strip():
        parts.append(f"What they say matters most:\n{request.priorities.strip()}")

    parts.append(
        "Audit this reasoning. Find the gaps. Quote their words as evidence. "
        "Ask questions. Do not recommend anything."
    )
    return "\n\n".join(parts)


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    """Build the Gemini client once, from the environment."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to the environment before "
            "starting the server."
        )
    return genai.Client(api_key=api_key)


def _candidate_models() -> list[str]:
    """Return the models to try, in order."""
    configured = os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    ordered = [configured]
    ordered.extend(m for m in FALLBACK_MODELS if m != configured)
    return ordered


def _generate(model: str, prompt: str) -> LLMAudit:
    """Call one model and return the validated audit."""
    response = get_client().models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=LLMAudit,
            temperature=0.8,
            http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
        ),
    )

    parsed = response.parsed
    if isinstance(parsed, LLMAudit):
        return parsed
    if isinstance(parsed, dict):
        return LLMAudit.model_validate(parsed)
    raise RuntimeError("The model returned no usable structured output.")


def run_audit(request: AuditRequest) -> AuditResult:
    """Run the full audit: measured attention plus the model's analysis.

    Raises:
        RuntimeError: when every candidate model fails.
    """
    prompt = build_prompt(request)

    last_error: Exception | None = None
    for model in _candidate_models():
        try:
            audit = _generate(model, prompt)
            logger.info("audit produced by %s", model)
            break
        except Exception as exc:  # noqa: BLE001 - try the next model
            logger.warning("model %s failed: %s", model, exc)
            last_error = exc
    else:
        raise RuntimeError(
            f"Every candidate model failed. Last error: {last_error}"
        )

    # Measured in Python, not asked of the model. Dimensions come from the
    # model so the analysis fits this decision; the counting does not.
    dimensions = tuple(
        dimension_from_spec(spec.label, spec.keywords) for spec in audit.dimensions
    )
    dimensions = tuple(d for d in dimensions if d.keywords)
    if len(dimensions) < 4:
        # Too few usable dimensions to measure with; fall back to the
        # built-in general set rather than reporting nothing.
        logger.warning(
            "only %d usable dimensions from %s; using the general set",
            len(dimensions),
            "the model",
        )
        dimensions = None

    salience = analyse_salience(
        request.reasons,
        request.priorities,
        request.leaning,
        dimensions=dimensions,
    )

    # Strongest findings first: impact weighted by how little is known.
    blind_spots = sorted(audit.blind_spots, key=lambda b: b.priority, reverse=True)
    questions = sorted(audit.questions, key=lambda q: q.priority, reverse=True)

    return AuditResult(
        restatement=audit.restatement,
        salience=salience,
        blind_spots=blind_spots,
        assumptions=audit.assumptions,
        questions=questions,
        closing=audit.closing,
    )
