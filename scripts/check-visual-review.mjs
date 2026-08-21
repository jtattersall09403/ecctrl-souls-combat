import process from "node:process";
import { validateVisualReviewBundle } from "./lib/visual-review-bundle.mjs";
import { assertVisualRunId } from "./lib/visual-run-directory.mjs";

const runId = assertVisualRunId(process.argv[2] ?? "latest");

const root = process.cwd();
const result = await validateVisualReviewBundle({ root, runId });
if (!result.pass) throw new Error(result.errors.join("\n"));

console.log(
  `PASS ${runId}: automated probes, evidence bundle, and ${result.scenarioCount} unequivocal human-reviewed verdicts by ${result.review.reviewer} are green`,
);
