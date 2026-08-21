import { describe, expect, it } from "vitest";
import {
  buildVisualReviewAttestation,
  hashVisualReview,
  validateVisualReviewAttestation,
} from "./visual-review-attestation.mjs";

const fingerprint = {
  version: 1,
  algorithm: "sha256",
  digest: "a".repeat(64),
  fileCount: 12,
};

function passingAttestation() {
  return buildVisualReviewAttestation({
    sourceFingerprint: fingerprint,
    reviewer: "Project owner",
    reviewerType: "HUMAN PROJECT OWNER",
    reviewedAt: "2026-08-21T12:00:00.000Z",
    runId: "latest",
    scenarioCount: 23,
    artifactCount: 164,
    markdown: "# completed fresh-eyes review\n",
  });
}

describe("visual review attestation", () => {
  it("accepts a complete attestation for the exact current source fingerprint", () => {
    expect(validateVisualReviewAttestation({
      attestation: passingAttestation(),
      currentFingerprint: fingerprint,
    })).toEqual({ pass: true, errors: [] });
  });

  it("rejects stale source inputs and placeholder review metadata", () => {
    const attestation = {
      ...passingAttestation(),
      sourceFingerprint: { ...fingerprint, digest: "b".repeat(64) },
      reviewer: "",
      reviewerType: "AGENT",
      reviewedAt: "yesterday",
      scenarioCount: 0,
      artifactCount: 0,
      reviewSha256: "pending",
    };
    const result = validateVisualReviewAttestation({ attestation, currentFingerprint: fingerprint });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/differ from the last human-reviewed/);
    expect(result.errors.join(" ")).toMatch(/human reviewer/);
    expect(result.errors.join(" ")).toMatch(/HUMAN PROJECT OWNER/);
    expect(result.errors.join(" ")).toMatch(/ISO timestamp/);
    expect(result.errors.join(" ")).toMatch(/scenarioCount/);
    expect(result.errors.join(" ")).toMatch(/artifactCount/);
    expect(result.errors.join(" ")).toMatch(/reviewSha256/);
  });

  it("hashes the exact completed review text", () => {
    expect(hashVisualReview("review A")).toHaveLength(64);
    expect(hashVisualReview("review A")).toBe(hashVisualReview("review A"));
    expect(hashVisualReview("review A")).not.toBe(hashVisualReview("review B"));
  });
});
