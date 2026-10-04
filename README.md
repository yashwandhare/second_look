# Second Look

**Don't ask AI what to decide. Ask it what you might be missing.**

Second Look audits *how* you are thinking about a decision. It surfaces the
assumptions you have not checked, the factors you never mentioned, and the
places your reasoning disagrees with itself. It never recommends an option.

Live: https://yash-promptwars.antideploy.app

---

## The problem

People decide using the information that is most visible to them. A stipend is
obvious; a missing mentor is not. So they weigh what they can see and miss the
rest — and they cannot see their own blind spot, because that is what makes it
a blind spot.

Second Look gives you an outside view of your own reasoning.

## How it maps to the problem statement

| Problem statement | What Second Look does |
| --- | --- |
| "information that is most visible to them" | **Measured attention.** Counts every reference you make to each decision dimension and reports the imbalance. |
| "overlook important factors" | **Omission detection.** Names the dimensions that appear nowhere in your reasoning. |
| "rely on unstated assumptions" | **Assumption ledger.** Records what you believe against the evidence you actually gave, and flags critical assumptions (high importance, no evidence). |
| "fail to recognize conflicts within their own reasoning" | **Contradiction detection.** Quotes two of your own statements that do not fit together. |
| "explore questions that could lead to a more informed decision" | **Ranked questions.** At most five, ordered by impact × how little you know. |
| "should not make the decision for the user" | **Non-prescriptive by construction.** No verdict, no score, no ranking of options. Findings are questions. |

---

## What makes the attention analysis trustworthy

Most tools would ask a language model whether you "over-focused" on something.
Second Look measures it instead.

The model decides which dimensions matter *for this decision* and supplies the
words you used for each. **Python then counts those words in your text.** The
result is a claim you can check:

> "Most of your description is about monthly housing cost (5 of 13 references).
> You did not mention resale value or exit costs at all."

That claim is unit-tested, and it adapts to any decision — a house purchase, a
job offer, or an internship — rather than only career questions.

## Cross-decision pattern

Individually, one omission is just a decision. Repeated across several, it is a
habit. Second Look aggregates stored audits to show what you *habitually* leave
out:

> "Across your past 6 decisions, you habitually omitted 'What you give up' in
> 4 of them (67%)."

---

## Architecture

```text
Decision + reasons + priorities
        │
        ├──► Deterministic layer (pure Python, no model)
        │      • decision-specific dimension counts
        │      • attention shares and silent dimensions
        │
        └──► Gemini 3.5 Flash Lite (validated JSON via Pydantic)
               • assumptions + evidence level
               • omissions, contradictions, perspective gaps
               • blind-spot typing
               • impact × uncertainty ranking
                        │
                        ▼
        Merged audit → cognitive-forcing UI → Firestore
```

The model supplies judgement. Python supplies everything that must be
defensible.

### Google services used

| Service | Use |
| --- | --- |
| **Gemini** (official `google-genai` SDK) | Structured audit via `response_schema`, with a model fallback chain |
| **Cloud Firestore** | Audit history, cross-decision aggregation, per-user persistence |

---

## Layout

```text
├── backend/
│   ├── main.py                  # app factory, security headers, static mount
│   ├── models/schemas.py        # Pydantic contracts
│   ├── routes/audit.py          # /api/audit, /api/decisions, /api/silence-report
│   ├── services/
│   │   ├── audit.py             # Gemini call, prompt, model fallback
│   │   ├── salience.py          # deterministic attention counting
│   │   ├── firestore.py         # Firestore REST client
│   │   └── ratelimit.py         # per-client rate limiting
│   └── tests/                   # 43 tests
├── frontend/
│   ├── index.html               # accessible intake and results
│   ├── css/style.css            # warm parchment design system
│   └── js/                      # api client + rendering
├── Dockerfile
└── deploy.sh
```

## Run it locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env          # then fill in the values below

.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
# http://localhost:8000
```

Run commands from the repository root so `backend` resolves as a package.

### Environment

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key for the audit |
| `GEMINI_MODEL` | Optional, defaults to `gemini-3.5-flash-lite` |
| `FIREBASE_PROJECT_ID` | Firestore project |
| `FIREBASE_API_KEY` | Firestore web API key |
| `CORS_ORIGINS` | Optional. Unset by default because the frontend is served same-origin |

## Tests

```bash
.venv/bin/python -m pytest backend/tests -q
# 43 passed
```

Coverage: API contracts, security headers, rate limiting windows and pruning,
deterministic counting including overlap handling, decision-specific dimensions,
Firestore value codecs.

---

## Engineering notes

**Security.** No secrets in the repository; keys are read from the environment.
CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and
`Permissions-Policy` on every response. All user- and model-derived text is
inserted with `textContent`, never `innerHTML`. Per-client rate limiting on the
audit endpoint so one caller cannot drain the model quota.

**Accessibility.** Semantic landmarks, skip link, labelled inputs, `aria-live`
announcements for async state, focus moved to results on completion, visible
focus rings, 44px touch targets, `prefers-reduced-motion` support, and contrast
verified at or above 4.5:1 for every text token.

**Efficiency.** The counting layer makes no model calls. Static assets are
served same-origin with revalidation headers. Firestore writes never block the
response — a failed save costs the user nothing.

**Failure handling.** A chain of models is tried in order when one is
unavailable. If storage is unreachable the audit still returns. Rate-limited
callers receive a `Retry-After` hint.
