/**
 * Turning an audit into text: plain-text export and date display.
 */

import { isCritical, EVIDENCE_LABELS, IMPORTANCE_LABELS } from "./content.js";
import { el } from "./dom.js";

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


export { auditToText, downloadText, formatWhen };
