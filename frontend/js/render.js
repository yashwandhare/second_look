/**
 * Rendering.
 *
 * These functions build the results view from an audit payload. They hold no
 * application state: the results container arrives as an argument, and the
 * "start again" action arrives as a callback.
 */

import {
  EVIDENCE_LABELS,
  IMPORTANCE_LABELS,
  KIND_LABELS,
  isCritical,
} from "./content.js";
import { append, clear, el } from "./dom.js";
import { auditToText, downloadText } from "./format.js";

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

function renderResults(container, audit, options = {}) {
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
  auditAnother.addEventListener("click", () => options.onNewAudit?.());

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


export {
  renderAttention,
  renderFindings,
  renderLedger,
  renderQuestions,
  renderClosing,
  renderResults,
  renderSilencePattern,
};
