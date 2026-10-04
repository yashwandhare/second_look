/**
 * Reasoning Auditor UI.
 *
 * All user- and model-derived text is inserted with textContent, never with
 * innerHTML, so nothing from the model or the user can inject markup.
 */

import { ApiError, getSilenceReport, listDecisions, runAudit } from "./api.js";

/* -------------------------------------------------------------------------
   Examples
   ------------------------------------------------------------------------- */

const EXAMPLES = {
  internship: {
    decision: "Whether to accept a 6-month internship",
    leaning: "Leaning toward accepting it",
    reasons:
      "The stipend is good. The company is close to home so I save on travel and can stay with my family. " +
      "It will give me industry experience and look good on my resume. The stipend is better than anything " +
      "else I have been offered, and honestly the stipend alone makes it worth it.",
    priorities: "Career growth and my academics. My degree matters most to me.",
  },
  job: {
    decision: "Whether to take this job offer or stay where I am",
    leaning: "Leaning toward taking the new job",
    reasons:
      "The new role pays about 30 percent more and the team works on newer technology, which I think " +
      "will help my career. My current job is comfortable and I like the people. The new company is a " +
      "startup, so there is more risk. The new office is further away.",
    priorities: "Learning new things and job stability.",
  },
  masters: {
    decision: "Whether to do a masters degree or start working",
    leaning: "Leaning toward the masters",
    reasons:
      "A masters would let me specialise and I have always wanted to study further. It costs a lot and " +
      "takes two years. My friends are all either working or applying abroad. I think a masters is the " +
      "safer path for a better salary later.",
    priorities: "Long-term earning and not falling behind my peers.",
  },
};

const KIND_LABELS = {
  salience: "Attention",
  assumption: "Assumption",
  omission: "Omission",
  conflict: "Contradiction",
  perspective: "Perspective",
  uncertainty: "Uncertainty",
};

const EVIDENCE_LABELS = {
  none: "None given",
  low: "Low",
  medium: "Moderate",
  high: "Well supported",
};

const IMPORTANCE_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * A critical assumption matters a great deal and has little support.
 *
 * Computed here rather than read from the payload: `is_critical` is a server
 * side property, and the response arrives as plain JSON, so it is absent.
 * @param {{importance: string, evidence_level: string}} assumption
 * @returns {boolean}
 */
function isCritical(assumption) {
  return (
    assumption.importance === "high" &&
    (assumption.evidence_level === "none" || assumption.evidence_level === "low")
  );
}

/* -------------------------------------------------------------------------
   Element helpers
   ------------------------------------------------------------------------- */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [options]
 * @param {string} [options.class]
 * @param {string} [options.text]
 * @param {string} [options.id]
 * @param {object} [options.attrs]
 * @returns {HTMLElement}
 */
function el(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      node.setAttribute(key, String(value));
    }
  }
  return node;
}

/**
 * Append children to a parent and return the parent.
 * @param {HTMLElement} parent
 * @param {Array<Node|null|undefined|false>} children
 * @returns {HTMLElement}
 */
function append(parent, children) {
  for (const child of children) {
    if (child) parent.append(child);
  }
  return parent;
}

/** Remove every child of a node. */
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* -------------------------------------------------------------------------
   Views
   ------------------------------------------------------------------------- */

const views = {
  intake: document.querySelector("#intake-view"),
  loading: document.querySelector("#loading-view"),
  results: document.querySelector("#results-view"),
};

const form = document.querySelector("#audit-form");
const submitButton = document.querySelector("#submit-button");
const formError = document.querySelector("#form-error");
const formStatus = document.querySelector("#form-status");
const loadingStatus = document.querySelector("#loading-status");
const loadingSteps = document.querySelector("#loading-steps");

function showView(name) {
  for (const [key, node] of Object.entries(views)) {
    node.hidden = key !== name;
  }
}

/* -------------------------------------------------------------------------
   Loading
   ------------------------------------------------------------------------- */

const LOADING_MESSAGES = [
  "Reading your reasoning…",
  "Measuring where your attention went…",
  "Looking for unexamined assumptions…",
  "Checking your reasoning against itself…",
  "Ranking the questions worth answering…",
];

let loadingTimer = null;

function startLoading() {
  let tick = 0;
  const items = [...loadingSteps.querySelectorAll("li")];

  const advance = () => {
    loadingStatus.textContent =
      LOADING_MESSAGES[Math.min(tick, LOADING_MESSAGES.length - 1)];

    items.forEach((item, index) => {
      item.classList.toggle("is-done", index < tick);
      item.classList.toggle("is-active", index === tick);
    });

    tick += 1;
  };

  advance();
  loadingTimer = window.setInterval(advance, 1800);
}

function stopLoading() {
  if (loadingTimer !== null) {
    window.clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

/* -------------------------------------------------------------------------
   Renderers
   ------------------------------------------------------------------------- */

/** A labelled progress bar for one decision dimension. */
function barRow(dimension, topMentions, isSilent) {
  const row = el("div", { class: isSilent ? "bar-row is-silent" : "bar-row" });

  const label = el("span", { class: "bar-label", text: dimension.label });

  const track = el("div", { class: "bar-track" });
  const fill = el("div", { class: "bar-fill" });
  if (isSilent) {
    fill.classList.add("is-silent");
    fill.style.width = "0%";
  } else {
    if (topMentions > 0) {
      fill.classList.add("is-top");
    }
    const ratio = topMentions > 0 ? dimension.mentions / topMentions : 0;
    fill.style.width = `${Math.max(ratio * 100, 6)}%`;
  }
  track.append(fill);

  const count = el("span", {
    class: "bar-count",
    text: isSilent ? "never" : `${dimension.mentions}×`,
  });

  const spoken = isSilent
    ? `${dimension.label}: never mentioned`
    : `${dimension.label}: mentioned ${dimension.mentions} times`;
  row.setAttribute("aria-label", spoken);

  return append(row, [label, track, count]);
}

function renderAttention(audit) {
  const section = el("section", { class: "section" });
  append(section, [
    el("p", { class: "section-label", text: "Measured attention" }),
    el("h2", { class: "section-title", text: "Where your attention went" }),
    el("p", {
      class: "section-sub",
      text:
        "These counts come from your own words. Each factor is counted every " +
        "time you referred to it. Nothing here is judged by a model.",
    }),
  ]);

  const card = el("div", { class: "attention" });
  append(card, [el("p", { class: "attention-note", text: audit.salience.note })]);

  const scored = [...audit.salience.emphasised];
  const topMentions = scored.length ? scored[0].mentions : 0;

  const silent = [...audit.salience.silent].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  // Mentioned factors first, then the dimensions that never appeared.
  for (const dimension of scored) {
    card.append(barRow(dimension, topMentions, false));
  }
  for (const dimension of silent) {
    card.append(barRow(dimension, topMentions, true));
  }

  // A silent bar looks like a rendering failure unless it is explained.
  if (silent.length) {
    card.append(
      el("p", {
        class: "bars-note",
        text:
          "A dimension you never mentioned is the finding, not an error. It " +
          "may genuinely not matter here, or it may be the part you have not " +
          "looked at yet.",
      }),
    );
  }

  section.append(card);
  return section;
}

/** One blind-spot finding, with the engage controls. */
function findingCard(finding, index, isTop) {
  const card = el("article", {
    class: isTop ? "finding is-top" : "finding",
  });

  const head = el("div", { class: "finding-head" });
  append(head, [
    el("span", {
      class: "kind",
      text: KIND_LABELS[finding.kind] ?? finding.kind,
    }),
    el("span", { class: "rank", text: `Finding ${index + 1}` }),
  ]);

  append(card, [
    head,
    el("h3", { text: finding.title }),
    el("p", { class: "finding-detail", text: finding.detail }),
  ]);

  if (finding.evidence) {
    const evidence = el("div", { class: "evidence" });
    append(evidence, [
      el("span", { class: "evidence-label", text: "From your reasoning" }),
      el("em", { text: `“${finding.evidence}”` }),
    ]);
    card.append(evidence);
  }

  card.append(el("p", { class: "finding-question", text: finding.question }));

  const scores = el("div", { class: "score-row" });
  append(scores, [
    el("span", { class: "score", text: "Impact " }).append(
      el("strong", { text: `${finding.impact}/5` }),
    ),
    el("span", { class: "score", text: "Known " }).append(
      el("strong", { text: `${5 - finding.uncertainty}/5` }),
    ),
  ]);
  card.append(scores);

  return card;
}

function renderFindings(audit) {
  const section = el("section", { class: "section" });
  append(section, [
    el("p", { class: "section-label", text: "Blind spots" }),
    el("h2", { class: "section-title", text: "What your reasoning may be missing" }),
    el("p", {
      class: "section-sub",
      text:
        "Ordered by how much each one could matter, weighted by how little you " +
        "currently know about it. Strongest first.",
    }),
  ]);

  audit.blind_spots.forEach((finding, index) => {
    section.append(findingCard(finding, index, index === 0));
  });

  return section;
}

function renderLedger(audit) {
  const section = el("section", { class: "section" });
  append(section, [
    el("p", { class: "section-label", text: "Assumption ledger" }),
    el("h2", { class: "section-title", text: "What you believe, and what supports it" }),
    el("p", {
      class: "section-sub",
      text:
        "The most useful row is a belief that matters a lot and has little " +
        "evidence behind it.",
    }),
  ]);

  const table = el("table", { class: "ledger" });
  table.append(
    el("caption", {
      text: "Evidence is judged only from what you provided.",
    }),
  );

  const thead = el("thead");
  const headRow = el("tr");
  for (const heading of ["Assumption", "Evidence", "Importance", "Ask yourself"]) {
    headRow.append(el("th", { attrs: { scope: "col" }, text: heading }));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const assumption of audit.assumptions) {
    const row = el("tr");

    const statement = el("td", { text: assumption.statement });
    statement.setAttribute("data-label", "Assumption");

    const evidenceCell = el("td");
    evidenceCell.setAttribute("data-label", "Evidence");
    const evidenceTag = el("span", {
      class: isCritical(assumption) ? "tag tag-critical" : "tag",
      text: EVIDENCE_LABELS[assumption.evidence_level] ?? assumption.evidence_level,
    });
    evidenceCell.append(evidenceTag);

    const importanceCell = el("td", {
      text: IMPORTANCE_LABELS[assumption.importance] ?? assumption.importance,
    });
    importanceCell.setAttribute("data-label", "Importance");

    const questionCell = el("td", { text: assumption.question });
    questionCell.setAttribute("data-label", "Ask yourself");

    append(row, [statement, evidenceCell, importanceCell, questionCell]);
    tbody.append(row);
  }
  table.append(tbody);
  section.append(table);

  const critical = audit.assumptions.filter(isCritical);
  if (critical.length) {
    section.append(
      el("p", {
        class: "ledger-note",
        text:
          `${critical.length} of ${audit.assumptions.length} assumptions matter a ` +
          "great deal but have little evidence behind them. Those are marked.",
      }),
    );
  }

  return section;
}

function renderQuestions(audit) {
  const section = el("section", { class: "section" });
  append(section, [
    el("p", { class: "section-label", text: "Worth answering" }),
    el("h2", { class: "section-title", text: "Questions that could change your mind" }),
    el("p", {
      class: "section-sub",
      text:
        "Only the questions whose answers would materially change how you " +
        "evaluate this decision.",
    }),
  ]);

  audit.questions.forEach((question, index) => {
    const card = el("article", { class: "question" });

    const body = el("div", { class: "question-body" });
    append(body, [
      el("h3", { text: question.text }),
      el("p", { class: "question-why", text: question.why }),
    ]);

    const meta = el("div", { class: "question-meta" });
    append(meta, [
      el("span", { class: "tag", text: `Impact ${question.impact}/5` }),
      el("span", {
        class: "tag",
        text: `Known ${5 - question.uncertainty}/5`,
      }),
    ]);
    body.append(meta);

    append(card, [
      el("span", { class: "question-rank", text: String(index + 1) }),
      body,
    ]);
    section.append(card);
  });

  return section;
}

function renderClosing(audit) {
  const closing = el("section", { class: "closing" });

  append(closing, [
    el("h2", { text: "Your reasoning is still yours to finish" }),
    el("p", { text: audit.closing }),
  ]);

  const fieldset = el("fieldset", { class: "reconsider" });
  fieldset.append(el("legend", { text: "Has anything shifted for you?" }));

  const options = [
    ["shifted", "Yes — I see this differently now"],
    ["partly", "Partly — some points landed, others did not"],
    ["same", "No — my reasoning already accounted for this"],
  ];

  for (const [value, text] of options) {
    const row = el("div", { class: "radio-row" });
    const id = `reconsider-${value}`;
    const input = el("input", {
      id,
      attrs: { type: "radio", name: "reconsider", value },
    });
    const label = el("label", { text, attrs: { for: id } });
    append(row, [input, label]);
    fieldset.append(row);
  }

  const ack = el("p", { class: "reconsider-ack", attrs: { hidden: "" } });
  fieldset.addEventListener("change", (event) => {
    const value = event.target.value;
    ack.hidden = false;
    if (value === "shifted") {
      ack.textContent =
        "That is the whole point of the exercise. Nothing here decided for you — " +
        "you did the reconsidering.";
    } else if (value === "partly") {
      ack.textContent =
        "Useful to know which points landed. The ones that did not may simply " +
        "not apply to your situation, and that is worth noticing too.";
    } else {
      ack.textContent =
        "Then your reasoning was already more complete than the audit assumed. " +
        "That is a good outcome, not a failed one.";
    }
  });

  fieldset.append(ack);
  closing.append(fieldset);

  closing.append(
    el("p", {
      class: "disclaimer",
      text:
        "This audit examined how you are thinking, not what you should do. It " +
        "found gaps in the reasoning you provided; it did not weigh facts it " +
        "does not have. The decision remains yours.",
    }),
  );

  return closing;
}

/* -------------------------------------------------------------------------
   Export
   ------------------------------------------------------------------------- */

/** Render an audit as plain text, for copying or saving. */
function auditToText(audit) {
  const lines = [];
  lines.push("SECOND LOOK — reasoning audit");
  lines.push("=".repeat(44));
  lines.push("");
  lines.push(audit.restatement);
  lines.push("");
  lines.push("WHERE YOUR ATTENTION WENT");
  lines.push("  " + audit.salience.note);
  for (const d of audit.salience.emphasised) {
    lines.push(`    ${d.mentions}x    ${d.label}`);
  }
  for (const d of audit.salience.silent) {
    lines.push(`    never  ${d.label}`);
  }

  lines.push("");
  lines.push("WHAT YOUR REASONING MAY BE MISSING");
  audit.blind_spots.forEach((b, i) => {
    lines.push(`  ${i + 1}. [${String(b.kind).toUpperCase()}] ${b.title}`);
    lines.push(`     ${b.detail}`);
    if (b.evidence) lines.push(`     From your words: "${b.evidence}"`);
    lines.push(`     Ask yourself: ${b.question}`);
    lines.push("");
  });

  lines.push("ASSUMPTION LEDGER");
  for (const a of audit.assumptions) {
    const flag = isCritical(a) ? "  <-- needs evidence" : "";
    lines.push(`  - ${a.statement}`);
    lines.push(
      `    evidence: ${EVIDENCE_LABELS[a.evidence_level] ?? a.evidence_level}` +
        `, importance: ${IMPORTANCE_LABELS[a.importance] ?? a.importance}${flag}`,
    );
  }

  lines.push("");
  lines.push("QUESTIONS WORTH ANSWERING");
  audit.questions.forEach((q, i) => {
    lines.push(`  ${i + 1}. ${q.text}`);
    lines.push(`     ${q.why}`);
  });

  lines.push("");
  lines.push(audit.closing);
  lines.push("");
  lines.push("This audit examined how you were thinking, not what to choose.");
  return lines.join("\n");
}

/** Offer text as a file download. */
function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { attrs: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderResults(audit) {
  const container = views.results;
  clear(container);

  const head = el("div", { class: "results-head" });
  append(head, [
    el("p", { class: "section-label", text: "Audit complete" }),
    el("h2", { id: "results-title", text: "Here is how your reasoning reads" }),
  ]);
  container.append(head);

  container.append(el("p", { class: "restatement", text: audit.restatement }));

  // An action bar that stays reachable, so the next step is never hidden.
  const bar = el("div", { class: "action-bar" });
  const summary = el("p", { class: "action-bar-summary" });
  append(summary, [
    el("strong", { text: `${audit.blind_spots.length} gaps` }),
    document.createTextNode(
      ` found, and ${audit.questions.length} questions worth answering`,
    ),
  ]);

  const buttons = el("div", { class: "action-bar-buttons" });

  const auditAnother = el("button", {
    class: "btn btn-primary btn-sm",
    text: "Take another look",
    attrs: { type: "button" },
  });
  auditAnother.addEventListener("click", resetForm);

  const jumpToQuestions = el("button", {
    class: "btn btn-ghost btn-sm",
    text: "Skip to the questions",
    attrs: { type: "button" },
  });
  jumpToQuestions.addEventListener("click", () => {
    document
      .querySelector("#questions-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const copyReport = el("button", {
    class: "btn btn-ghost btn-sm",
    text: "Copy as text",
    attrs: { type: "button" },
  });
  copyReport.addEventListener("click", async () => {
    const text = auditToText(audit);
    try {
      await navigator.clipboard.writeText(text);
      copyReport.textContent = "Copied";
      window.setTimeout(() => {
        copyReport.textContent = "Copy as text";
      }, 2000);
    } catch {
      // Clipboard access can be blocked; fall back to a download.
      downloadText(text, "second-look-audit.txt");
    }
  });

  append(buttons, [jumpToQuestions, copyReport, auditAnother]);
  append(bar, [summary, buttons]);
  container.append(bar);

  const attention = renderAttention(audit);
  attention.id = "attention-section";
  const findings = renderFindings(audit);
  findings.id = "findings-section";
  const ledger = renderLedger(audit);
  ledger.id = "ledger-section";
  const questions = renderQuestions(audit);
  questions.id = "questions-section";

  container.append(attention, findings, ledger, questions, renderClosing(audit));
}

/* -------------------------------------------------------------------------
   Validation and submission
   ------------------------------------------------------------------------- */

/**
 * Read the form, validate it, and report problems next to the field.
 * @returns {object|null} the payload, or null when invalid
 */
function readForm() {
  const decision = document.querySelector("#decision");
  const reasons = document.querySelector("#reasons");
  const priorities = document.querySelector("#priorities");

  for (const node of [decision, reasons]) {
    node.removeAttribute("aria-invalid");
  }
  for (const id of ["#decision-error", "#reasons-error"]) {
    const node = document.querySelector(id);
    node.hidden = true;
    node.textContent = "";
  }

  let firstInvalid = null;

  if (decision.value.trim().length < 3) {
    const error = document.querySelector("#decision-error");
    error.textContent = "Describe the decision in a few words.";
    error.hidden = false;
    decision.setAttribute("aria-invalid", "true");
    firstInvalid ??= decision;
  }

  if (reasons.value.trim().length < 10) {
    const error = document.querySelector("#reasons-error");
    error.textContent =
      "Add a little more about why you are leaning that way. The audit needs " +
      "your own words to measure.";
    error.hidden = false;
    reasons.setAttribute("aria-invalid", "true");
    firstInvalid ??= reasons;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }

  return {
    decision: decision.value.trim(),
    reasons: reasons.value.trim(),
    priorities: priorities.value.trim(),
    leaning: document.querySelector("#leaning").value.trim(),
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  formError.hidden = true;
  document.querySelector("#retry-row")?.remove();

  const payload = readForm();
  if (!payload) return;

  submitButton.disabled = true;
  formStatus.textContent = "Running the audit…";
  showView("loading");
  startLoading();
  views.loading.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const audit = await runAudit(payload);
    stopLoading();
    renderResults(audit);
    showView("results");

    // Move focus to the results so keyboard and screen reader users land on the
    // new content instead of staying on a button that no longer exists.
    views.results.focus({ preventScroll: true });
    views.results.scrollIntoView({ behavior: "smooth", block: "start" });

    // A fresh audit should appear in the history list immediately.
    loadHistory();
    loadSilenceReport();
  } catch (error) {
    stopLoading();
    showView("intake");
    const message =
      error instanceof ApiError
        ? error.message
        : "Something went wrong while running the audit.";
    formError.textContent = message;
    formError.hidden = false;

    // Offer the recovery action next to the error, not somewhere else.
    const retry = el("div", { class: "retry-row", id: "retry-row" });
    append(retry, [
      el("p", { text: "Your text is still here. You can try again." }),
    ]);
    const retryButton = el("button", {
      class: "btn btn-ghost btn-sm",
      text: "Try again",
      attrs: { type: "button" },
    });
    retryButton.addEventListener("click", () => form.requestSubmit());
    retry.append(retryButton);
    formError.insertAdjacentElement("afterend", retry);

    submitButton.focus();
  } finally {
    submitButton.disabled = false;
    formStatus.textContent = "";
  }
}

function resetForm() {
  form.reset();
  formError.hidden = true;
  for (const chip of document.querySelectorAll("[data-example]")) {
    chip.classList.remove("is-filled");
  }
  showView("intake");
  document.querySelector("#decision").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* -------------------------------------------------------------------------
   Init
   ------------------------------------------------------------------------- */

form.addEventListener("submit", handleSubmit);

// Ctrl/Cmd + Enter submits from anywhere in the form.
form.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
});

for (const chip of document.querySelectorAll("[data-example]")) {
  chip.addEventListener("click", () => {
    const example = EXAMPLES[chip.dataset.example];
    if (!example) return;
    document.querySelector("#decision").value = example.decision;
    document.querySelector("#leaning").value = example.leaning ?? "";
    document.querySelector("#reasons").value = example.reasons;
    document.querySelector("#priorities").value = example.priorities;

    // Show which example is loaded, so the click has visible feedback.
    for (const other of document.querySelectorAll("[data-example]")) {
      other.classList.toggle("is-filled", other === chip);
    }

    document.querySelector("#reasons").focus();
  });
}

/* -------------------------------------------------------------------------
   History
   ------------------------------------------------------------------------- */

/** Format a stored timestamp for display. */
function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Load stored audits and offer them as a starting point. */
async function loadHistory() {
  const section = document.querySelector("#history");
  const list = document.querySelector("#history-list");
  if (!section || !list) return;

  let records = [];
  try {
    records = await listDecisions();
  } catch {
    section.hidden = true;
    return;
  }

  if (!Array.isArray(records) || records.length === 0) {
    section.hidden = true;
    return;
  }

  clear(list);
  for (const record of records.slice(0, 5)) {
    const item = el("li");
    const button = el("button", {
      class: "history-item",
      attrs: { type: "button" },
    });

    append(button, [
      el("span", { class: "history-decision", text: record.decision }),
      el("span", {
        class: "history-meta",
        text: `${record.blind_spot_count} gaps · ${formatWhen(record.created_at)}`,
      }),
    ]);

    button.addEventListener("click", () => {
      document.querySelector("#decision").value = record.decision ?? "";
      document.querySelector("#leaning").value = record.leaning ?? "";
      document.querySelector("#reasons").value = record.reasons ?? "";
      document.querySelector("#priorities").value = record.priorities ?? "";
      document.querySelector("#reasons").focus();
      document
        .querySelector(".intake")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    item.append(button);
    list.append(item);
  }

  section.hidden = false;
}

/* -------------------------------------------------------------------------
   Cross-decision pattern
   ------------------------------------------------------------------------- */

/**
 * Render the habitual blind-spot pattern across stored decisions.
 * @param {{total_audits: number, findings: Array<object>, note: string}} report
 * @returns {HTMLElement|null}
 */
function renderSilencePattern(report) {
  if (!report || !Array.isArray(report.findings) || report.findings.length === 0) {
    return null;
  }

  const section = el("section", { class: "pattern" });
  append(section, [
    el("p", { class: "section-label", text: "Across your decisions" }),
    el("h2", { class: "section-title", text: "Your habitual blind spots" }),
    el("p", { class: "section-sub", text: report.note }),
  ]);

  const list = el("ul", { class: "pattern-list" });
  for (const finding of report.findings.slice(0, 5)) {
    const item = el("li", { class: "pattern-item" });

    const missed = Number(finding.missed_in) || 0;
    const total = Number(finding.total_audits) || 0;
    const ratio = total > 0 ? missed / total : 0;

    const track = el("div", { class: "pattern-track" });
    const fill = el("div", { class: "pattern-fill" });
    fill.style.width = `${Math.round(ratio * 100)}%`;
    track.append(fill);

    append(item, [
      el("span", { class: "pattern-label", text: finding.label }),
      track,
      el("span", {
        class: "pattern-count",
        text: `${missed} of ${total}`,
      }),
    ]);
    list.append(item);
  }

  section.append(list);
  section.append(
    el("p", {
      class: "bars-note",
      text:
        "One omission is a decision. The same omission across several is a " +
        "habit worth knowing about.",
    }),
  );

  return section;
}

/** Load the cross-decision pattern, when enough history exists. */
async function loadSilenceReport() {
  const host = document.querySelector("#silence");
  if (!host) return;

  let report;
  try {
    report = await getSilenceReport();
  } catch {
    host.hidden = true;
    return;
  }

  const node = renderSilencePattern(report);
  clear(host);
  if (!node) {
    host.hidden = true;
    return;
  }

  host.append(node);
  host.hidden = false;
}

showView("intake");
loadHistory();
loadSilenceReport();
