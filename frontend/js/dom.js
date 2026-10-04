/**
 * Minimal DOM helpers.
 *
 * Every helper builds nodes and sets text with textContent, so nothing derived
 * from user input or model output can inject markup.
 */

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


export { el, append, clear };
