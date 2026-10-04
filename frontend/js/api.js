/**
 * API client for the reasoning auditor.
 *
 * Same-origin by default, so the deployed app needs no CORS configuration.
 */

const API_BASE = globalThis.__API_BASE__ ?? "";

/** Error carrying the server's explanation when one was returned. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Send one JSON request.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  if (!response.ok) {
    let detail = `The server returned ${response.status}.`;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new ApiError(detail, response.status);
  }

  return response.json();
}

/**
 * Run an audit.
 * @param {{decision: string, reasons: string, priorities: string}} payload
 * @returns {Promise<object>} the audit result
 */
export function runAudit(payload) {
  return request("/api/audit", {
    method: "POST",
    body: JSON.stringify({
      decision: payload.decision,
      leaning: payload.leaning ?? "",
      reasons: payload.reasons,
      priorities: payload.priorities ?? "",
    }),
  });
}

/** Check backend and integration status. */
export function getHealth() {
  return request("/api/health");
}

/**
 * List previously stored audits.
 * @returns {Promise<Array<object>>} newest first
 */
export function listDecisions() {
  return request("/api/decisions?limit=8");
}

/**
 * Get aggregated habitual blind-spots across stored audits.
 * @returns {Promise<object>}
 */
export function getSilenceReport() {
  return request("/api/silence-report");
}
