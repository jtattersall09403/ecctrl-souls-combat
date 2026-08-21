import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validateReview } from "./visual-review.mjs";
import { visualRunDirectory } from "./visual-run-directory.mjs";

async function requireNonEmpty(path, label, errors) {
  try {
    const artifact = await stat(path);
    if (!artifact.isFile() || artifact.size === 0) errors.push(`${label} is empty`);
  } catch {
    errors.push(`${label} is missing`);
  }
}

/** Validate the complete on-disk review bundle used by both check and attest CLIs. */
export async function validateVisualReviewBundle({ root, runId }) {
  const runDir = visualRunDirectory(root, runId);
  const expectations = JSON.parse(await readFile(
    resolve(root, "src/game/validation/visualScenarioExpectations.json"),
    "utf8",
  ));
  const run = JSON.parse(await readFile(resolve(runDir, "run.json"), "utf8"));
  const markdown = await readFile(resolve(runDir, "holistic-review.md"), "utf8");
  const expectedScenarios = Object.keys(expectations);
  const review = validateReview({ runId, run, markdown, expectedScenarios });
  const evidenceErrors = [];
  if (run.runId !== runId) {
    evidenceErrors.push(`${runId}: run.json belongs to ${run.runId ?? "an unnamed run"}`);
  }

  for (const scenario of expectedScenarios) {
    const scenarioDir = resolve(runDir, scenario);
    const required = [
      "recording.webm",
      "normal-speed-review.gif",
      "action-closeup.webm",
      "contact-sheet.png",
      "telemetry.json",
      "motion-analysis.json",
      "evidence.json",
      "recording-frame-map.json",
      "capture-alignment.json",
    ];
    for (const filename of required) {
      await requireNonEmpty(resolve(scenarioDir, filename), `${runId}: ${scenario} ${filename}`, evidenceErrors);
    }
    try {
      const evidence = JSON.parse(await readFile(resolve(scenarioDir, "evidence.json"), "utf8"));
      if (evidence.version !== 6
        || evidence.normalization?.strategy !== "in-pixel-simulation-frame-marker"
        || evidence.normalization?.framesPerSecond !== 30
        || evidence.normalization?.markerExcludedFromReviewPixels !== true
        || evidence.recordingFrameMap !== "recording-frame-map.json"
        || evidence.agentReviewGif !== "normal-speed-review.gif") {
        evidenceErrors.push(`${runId}: ${scenario} evidence is not in-pixel synchronized human-review format version 6`);
      }
      const frameMap = JSON.parse(await readFile(resolve(scenarioDir, "recording-frame-map.json"), "utf8"));
      if (frameMap.version !== 2 || frameMap.alignment !== "decoded-in-pixel-frame-marker"
        || frameMap.markerProtocol?.excludedFromReviewedDerivativesByGutterCrop !== true
        || frameMap.framesPerSecond !== 30
        || !Array.isArray(frameMap.frames) || frameMap.frames.length !== evidence.normalization?.outputFrames
        || frameMap.frames.some((frame, index) => (
          frame.outputFrame !== index
          || frame.decodedSourceMarkerFrame !== index
          || Math.abs(frame.simulationTime - index / 30) > 0.00002
          || !Number.isInteger(frame.rawSourceFrame)
          || frame.rawSourceFrame < 0
          || (index > 0 && frame.rawSourceFrame <= frameMap.frames[index - 1].rawSourceFrame)
        ))) {
        evidenceErrors.push(`${runId}: ${scenario} recording frame map is incomplete, offset, or not chronological`);
      }
      if (!Array.isArray(evidence.strips) || !evidence.strips.length) {
        evidenceErrors.push(`${runId}: ${scenario} has no dense action motion strips`);
      } else {
        for (const strip of evidence.strips) {
          if (strip.samplesPerSecond !== 30) {
            evidenceErrors.push(`${runId}: ${scenario} ${strip.path} is not on the 30 Hz simulation clock`);
          }
          if (!Number.isInteger(strip.realRecordingFrames) || strip.realRecordingFrames < 1) {
            evidenceErrors.push(`${runId}: ${scenario} ${strip.path} does not declare its real recording-frame count`);
          }
          await requireNonEmpty(resolve(scenarioDir, strip.path), `${runId}: ${scenario} ${strip.path}`, evidenceErrors);
        }
      }
      if (!Array.isArray(evidence.transitionBoundaryStrips) || !evidence.transitionBoundaryStrips.length) {
        evidenceErrors.push(`${runId}: ${scenario} has no semantic-transition boundary strips`);
      } else {
        for (const strip of evidence.transitionBoundaryStrips) {
          if (strip.samplesPerSecond !== 30) {
            evidenceErrors.push(`${runId}: ${scenario} ${strip.path} is not on the 30 Hz transition clock`);
          }
          if (!Number.isInteger(strip.realRecordingFrames) || strip.realRecordingFrames < 2) {
            evidenceErrors.push(`${runId}: ${scenario} ${strip.path} lacks two real frames across its transition`);
          }
          await requireNonEmpty(resolve(scenarioDir, strip.path), `${runId}: ${scenario} ${strip.path}`, evidenceErrors);
        }
      }
      if (!Array.isArray(evidence.reviewChecklist)
        || evidence.reviewChecklist.length !== (evidence.strips?.length ?? 0) + (evidence.transitionBoundaryStrips?.length ?? 0)) {
        evidenceErrors.push(`${runId}: ${scenario} review checklist does not cover every run/transition artifact`);
      } else {
        for (const item of evidence.reviewChecklist) {
          await requireNonEmpty(resolve(scenarioDir, item.artifact), `${runId}: ${scenario} checklist artifact ${item.artifact}`, evidenceErrors);
        }
      }
      const runContracts = Object.values(evidence.animationRunContracts ?? {});
      if (!runContracts.length || runContracts.some((contract) => contract.pass !== true)) {
        evidenceErrors.push(`${runId}: ${scenario} exact ordered animation-run contract is missing or failed`);
      }
    } catch (error) {
      evidenceErrors.push(`${runId}: ${scenario} evidence.json cannot be checked (${error.message})`);
    }
  }

  const errors = [...review.errors, ...evidenceErrors];
  const artifactCount = expectedScenarios.reduce(
    (count, scenario) => count + (run.scenarioEvidence?.[scenario]?.reviewChecklist?.length ?? 0),
    0,
  );
  return {
    pass: errors.length === 0,
    errors,
    review,
    run,
    markdown,
    scenarioCount: expectedScenarios.length,
    artifactCount,
  };
}
