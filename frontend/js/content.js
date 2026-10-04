/**
 * Static content: example decisions and the vocabulary used to describe
 * findings in the interface.
 */

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

export {
  EXAMPLES,
  KIND_LABELS,
  EVIDENCE_LABELS,
  IMPORTANCE_LABELS,
  isCritical,
};
