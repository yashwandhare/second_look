/**
 * Second Look — application entry point.
 *
 * Owns view state, the intake form, and the loading sequence. Rendering lives
 * in render.js, static copy in content.js, text export in format.js, and DOM
 * construction in dom.js.
 */

import { ApiError, getSilenceReport, listDecisions, runAudit } from "./api.js";
import { EXAMPLES } from "./content.js";
import { append, clear, el } from "./dom.js";
import { formatWhen } from "./format.js";
import { renderResults, renderSilencePattern } from "./render.js";

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
    renderResults(views.results, audit, { onNewAudit: resetForm });
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
