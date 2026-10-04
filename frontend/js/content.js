/**
 * Static content: example decisions and the vocabulary used to describe
 * findings in the interface.
 */

/* -------------------------------------------------------------------------
   Examples
   ------------------------------------------------------------------------- */

const EXAMPLES = {
  dog: {
    decision: "Whether to adopt a rescue dog",
    leaning: "Leaning toward adopting this weekend",
    reasons:
      "I have wanted a dog since college and the flat has felt empty for a year. " +
      "The shelter has a beagle mix that is already house-trained, and they say she is " +
      "good with people. I want the company. I think having a dog would get me out of the " +
      "house more, and honestly I have wanted this for so long that it feels like a life " +
      "thing rather than a purchase. The building does not officially allow pets but nobody " +
      "really checks, and half the flats have cats anyway.",
    priorities: "My independence, and my work commitments. I travel for work sometimes.",
  },
  relocate: {
    decision: "Whether to move to Pune for my partner's job",
    leaning: "Leaning toward moving in with them",
    reasons:
      "My partner got a much better offer in Pune and it is a genuinely big step for their " +
      "career. Rent there is cheaper than here, so we would actually save money. I can do " +
      "my own job remotely, at least for now. After two years of long distance it would be " +
      "good for us to finally live in the same city. I have not really looked at what my own " +
      "work looks like there, but I am not worried about that side of it.",
    priorities: "My career and my relationship. Both matter to me.",
  },
  housing: {
    decision: "Whether to buy a flat now or keep renting for two more years",
    leaning: "Leaning toward buying now",
    reasons:
      "My rent goes up every single year and I am paying off someone else's mortgage. " +
      "The EMI on the flat I like would be roughly what I already pay in rent, so the " +
      "monthly outgoing barely changes. My parents have offered to cover most of the down " +
      "payment. Prices in that area have only gone up since 2021 and everyone says it will " +
      "keep going. Renting just feels like throwing money away. Colleagues who bought two " +
      "years ago have more equity now than I have in savings.",
    priorities: "Long-term financial security.",
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
