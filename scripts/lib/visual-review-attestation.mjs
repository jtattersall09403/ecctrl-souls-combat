import { createHash } from "node:crypto";
import { sameVisualSourceFingerprint } from "./visual-source-fingerprint.mjs";

export const VISUAL_REVIEW_ATTESTATION_VERSION = 2;
export const VISUAL_REVIEW_ATTESTATION_PATH = "visual-review-attestation.json";

export function hashVisualReview(markdown) {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export function buildVisualReviewAttestation({
  sourceFingerprint,
  reviewer,
  reviewerType,
  reviewedAt,
  runId,
  scenarioCount,
  artifactCount,
  markdown,
}) {
  return {
    version: VISUAL_REVIEW_ATTESTATION_VERSION,
    sourceFingerprint,
    reviewer,
    reviewerType,
    reviewedAt,
    runId,
    scenarioCount,
    artifactCount,
    reviewSha256: hashVisualReview(markdown),
  };
}

/** Validate schema plus the only approval claim CI relies on: reviewed bytes equal current bytes. */
export function validateVisualReviewAttestation({ attestation, currentFingerprint }) {
  const errors = [];
  if (attestation?.version !== VISUAL_REVIEW_ATTESTATION_VERSION) {
    errors.push(`attestation version must be ${VISUAL_REVIEW_ATTESTATION_VERSION}`);
  }
  if (!sameVisualSourceFingerprint(attestation?.sourceFingerprint, currentFingerprint)) {
    errors.push("animation/capture inputs differ from the last human-reviewed source fingerprint");
  }
  if (typeof attestation?.reviewer !== "string" || attestation.reviewer.trim().length < 3) {
    errors.push("attestation must name the human reviewer");
  }
  if (attestation?.reviewerType !== "HUMAN PROJECT OWNER") {
    errors.push("attestation reviewerType must be HUMAN PROJECT OWNER");
  }
  const reviewedAt = attestation?.reviewedAt;
  if (typeof reviewedAt !== "string"
    || Number.isNaN(Date.parse(reviewedAt))
    || new Date(reviewedAt).toISOString() !== reviewedAt) {
    errors.push("attestation reviewedAt must be an ISO timestamp");
  }
  if (typeof attestation?.runId !== "string" || !/^[a-zA-Z0-9._-]+$/.test(attestation.runId)) {
    errors.push("attestation must name a valid reviewed run");
  }
  if (!Number.isInteger(attestation?.scenarioCount) || attestation.scenarioCount < 1) {
    errors.push("attestation scenarioCount must be positive");
  }
  if (!Number.isInteger(attestation?.artifactCount) || attestation.artifactCount < 1) {
    errors.push("attestation artifactCount must be positive");
  }
  if (typeof attestation?.reviewSha256 !== "string" || !/^[a-f0-9]{64}$/.test(attestation.reviewSha256)) {
    errors.push("attestation reviewSha256 must be a SHA-256 digest");
  }
  return { pass: errors.length === 0, errors };
}
