import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  validateVisualReviewAttestation,
  VISUAL_REVIEW_ATTESTATION_PATH,
} from "./lib/visual-review-attestation.mjs";
import { computeVisualSourceFingerprint } from "./lib/visual-source-fingerprint.mjs";

const root = process.cwd();
let attestation;
try {
  attestation = JSON.parse(await readFile(resolve(root, VISUAL_REVIEW_ATTESTATION_PATH), "utf8"));
} catch (error) {
  throw new Error(
    `Cannot read ${VISUAL_REVIEW_ATTESTATION_PATH}: ${error.message}. Have the project owner complete and attest a current human visual review.`,
  );
}
const currentFingerprint = await computeVisualSourceFingerprint(root);
const result = validateVisualReviewAttestation({ attestation, currentFingerprint });
if (!result.pass) {
  throw new Error(`${result.errors.join("\n")}\nRun npm run visual:test, have the project owner complete holistic-review.md, then run npm run visual:review:attest.`);
}
console.log(
  `PASS visual review attestation: current inputs match ${attestation.runId}, reviewed by ${attestation.reviewer} at ${attestation.reviewedAt}`,
);
