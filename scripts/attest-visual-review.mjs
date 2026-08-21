import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  buildVisualReviewAttestation,
  VISUAL_REVIEW_ATTESTATION_PATH,
} from "./lib/visual-review-attestation.mjs";
import { validateVisualReviewBundle } from "./lib/visual-review-bundle.mjs";
import {
  computeVisualSourceFingerprint,
  sameVisualSourceFingerprint,
} from "./lib/visual-source-fingerprint.mjs";
import { assertVisualRunId, visualRunDirectory } from "./lib/visual-run-directory.mjs";

const runId = assertVisualRunId(process.argv[2] ?? "latest");

const root = process.cwd();
const bundle = await validateVisualReviewBundle({ root, runId });
if (!bundle.pass) throw new Error(bundle.errors.join("\n"));

const sourceFingerprint = await computeVisualSourceFingerprint(root);
if (!sameVisualSourceFingerprint(bundle.run.sourceFingerprint, sourceFingerprint)) {
  throw new Error(
    `${runId}: reviewed capture source fingerprint does not match current animation/capture inputs; recapture and review the current tree`,
  );
}

const attestation = buildVisualReviewAttestation({
  sourceFingerprint,
  reviewer: bundle.review.reviewer,
  reviewerType: bundle.review.reviewerType,
  reviewedAt: bundle.review.reviewedAt,
  runId,
  scenarioCount: bundle.scenarioCount,
  artifactCount: bundle.artifactCount,
  markdown: bundle.markdown,
});
await writeFile(
  resolve(visualRunDirectory(root, runId), "run.json"),
  `${JSON.stringify({ ...bundle.run, qualitativeReview: "PASS" }, null, 2)}\n`,
);
await writeFile(
  resolve(root, VISUAL_REVIEW_ATTESTATION_PATH),
  `${JSON.stringify(attestation, null, 2)}\n`,
);
console.log(
  `ATTESTED ${runId}: ${bundle.scenarioCount} scenarios and ${bundle.artifactCount} run/transition artifacts reviewed by human project owner ${bundle.review.reviewer}`,
);
