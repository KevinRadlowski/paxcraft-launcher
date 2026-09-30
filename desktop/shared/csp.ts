/**
 * CSP strings derived from RendererTrustPolicy — pure (no Electron).
 */
import type { RendererTrustPolicy } from "./trust-policy.js";
import { usesDevelopmentCsp } from "./trust-policy.js";

export function productionCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Angular component styles may inject inline style attributes; keep scripts strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function developmentCsp(origin: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origin}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${origin.replace(/^http/, "ws")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function cspForPolicy(policy: RendererTrustPolicy): string {
  if (usesDevelopmentCsp(policy) && policy.target.kind === "dev-server") {
    return developmentCsp(policy.target.origin);
  }
  return productionCsp();
}
