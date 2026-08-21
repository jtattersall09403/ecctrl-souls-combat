import { describe, expect, it } from "vitest";
import {
  buildReviewMarkdown,
  REQUIRED_VIEWING_ORDER,
  validateReview,
} from "./visual-review.mjs";

const expectedScenarios = ["roll"];
const passingEvidence = {
  strips: [{
    reviewId: "run:player:01:ROLL#1:part:1-of-1",
    path: "motion-strips/001-player-roll-part-1-of-1.png",
    actor: "player",
    animation: "ROLL",
    start: 0.4,
    end: 0.8,
  }],
  transitionBoundaryStrips: [{
    reviewId: "edge:player:01:SWORD_IDLE#1->ROLL#1",
    path: "transition-boundaries/001-player-sword-idle-to-roll.png",
    fromAnimation: "SWORD_IDLE",
    fromCommandSerial: 1,
    toAnimation: "ROLL",
    toCommandSerial: 2,
    start: 0.35,
    transitionTime: 0.5,
    end: 0.75,
  }],
  reviewChecklist: [{
    id: "run:player:01:ROLL#1:part:1-of-1",
    kind: "animation-run",
    artifact: "motion-strips/001-player-roll-part-1-of-1.png",
    start: 0.4,
    end: 0.8,
  }, {
    id: "edge:player:01:SWORD_IDLE#1->ROLL#1",
    kind: "animation-transition",
    artifact: "transition-boundaries/001-player-sword-idle-to-roll.png",
    start: 0.35,
    end: 0.75,
  }],
};
const scenarios = [{ scenario: "roll", label: "Forward dodge", evidence: passingEvidence }];
const passingRun = {
  evidenceVersion: 6,
  recordVideo: true,
  automatedAssertions: "pass",
  probeAssertions: "pass",
  crossScenarioAssertions: "pass",
  transitionObligationCoverage: { pass: true, obligations: 50, resolvedEdges: [] },
  qualitativeReview: "PENDING",
  scenarios: expectedScenarios,
  scenarioEvidence: {
    roll: passingEvidence,
  },
};

function completedMarkdown() {
  return buildReviewMarkdown({
    generatedAt: "2026-08-20T00:00:00.000Z",
    runId: "test",
    coverageSummary: "covered",
    scenarios,
  })
    .replace("Reviewer: **PENDING**", "Reviewer: **Project owner**")
    .replace("Reviewed at: **PENDING**", "Reviewed at: **2026-08-21T12:00:00.000Z**")
    .replace("Qualitative status: **PENDING**", "Qualitative status: **PASS**")
    .replace("Viewing order: **PENDING**", `Viewing order: **${REQUIRED_VIEWING_ORDER}**`)
    .replace(
      "First-watch observation [00:00.000]: PENDING",
      "First-watch observation [00:00.400]: The roll reads immediately but keeps the actor planted on the arena plane.",
    )
    .replace(
      "Artifact observation [00:00.000]: PENDING",
      "Artifact observation [00:00.500]: The roll occurrence shows continuous pelvis, feet, and weapon motion across this exact window.",
    )
    .replace(
      "Artifact observation [00:00.000]: PENDING",
      "Artifact observation [00:00.500]: The idle-to-roll boundary preserves a readable crouch and uninterrupted silhouette.",
    )
    .replace(
      "Artifact rationale [00:00.000]: PENDING",
      "Artifact rationale [00:00.500]: The roll pose keeps credible support and weight while each limb follows one smooth trajectory.",
    )
    .replace(
      "Artifact rationale [00:00.000]: PENDING",
      "Artifact rationale [00:00.500]: Anticipation flows into the dodge without a pose pop, frozen frame, or semantic detour.",
    )
    .replaceAll("Evidence verdict: **PENDING**", "Evidence verdict: **PASS**")
    .replace(
      "Frame-level observation [00:00.000]: PENDING",
      "Frame-level observation [00:00.733]: The pelvis and both feet clear the floor without a visible pose pop.",
    )
    .replace(
      "First-principles rationale [00:00.000]: PENDING",
      "First-principles rationale [00:00.733]: Continuous silhouettes, credible support, and coherent anticipation make the dodge intentional.",
    )
    .replaceAll("- [ ]", "- [x]")
    .replace("Verdict: **PENDING**", "Verdict: **PASS**");
}

describe("strict qualitative visual-review gate", () => {
  it("accepts a named, ordered, timestamped, fully checked unequivocal review", () => {
    const result = validateReview({
      runId: "test",
      run: passingRun,
      markdown: completedMarkdown(),
      expectedScenarios,
    });
    expect(result).toEqual({
      pass: true,
      reviewer: "Project owner",
      reviewerType: "HUMAN PROJECT OWNER",
      reviewedAt: "2026-08-21T12:00:00.000Z",
      errors: [],
    });
  });

  it("rejects the generated pending template and an unnamed reviewer", () => {
    const markdown = buildReviewMarkdown({
      generatedAt: "2026-08-20T00:00:00.000Z",
      runId: "test",
      coverageSummary: "covered",
      scenarios,
    });
    const result = validateReview({ runId: "test", run: { ...passingRun, qualitativeReview: "PENDING" }, markdown, expectedScenarios });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Reviewer/);
    expect(result.errors.join(" ")).toMatch(/normal-speed first-watch observation/);
    expect(result.errors.join(" ")).toMatch(/unchecked|incomplete/);
  });

  it("rejects missing timestamped observations and unchecked rubric items", () => {
    const markdown = completedMarkdown()
      .replace(/^Frame-level observation.*$/m, "Frame-level observation [00:00.000]: PENDING")
      .replace("- [x] Immediate read:", "- [ ] Immediate read:");
    const result = validateReview({ runId: "test", run: passingRun, markdown, expectedScenarios });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/frame-level observation/);
    expect(result.errors.join(" ")).toMatch(/unchecked/);
  });

  it("requires an observation, rationale, and verdict for every emitted artifact id", () => {
    const markdown = completedMarkdown()
      .replace(
        "Artifact observation [00:00.500]: The roll occurrence shows continuous pelvis, feet, and weapon motion across this exact window.",
        "Artifact observation [00:00.000]: PENDING",
      )
      .replace("Evidence verdict: **PASS**", "Evidence verdict: **PENDING**");
    const result = validateReview({ runId: "test", run: passingRun, markdown, expectedScenarios });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/timestamped artifact observation/);
    expect(result.errors.join(" ")).toMatch(/evidence verdict/);
  });

  it("rejects copy-pasted per-artifact judgments", () => {
    const markdown = completedMarkdown()
      .replace(
        "The idle-to-roll boundary preserves a readable crouch and uninterrupted silhouette.",
        "The roll occurrence shows continuous pelvis, feet, and weapon motion across this exact window.",
      )
      .replace(
        "Anticipation flows into the dodge without a pose pop, frozen frame, or semantic detour.",
        "The roll pose keeps credible support and weight while each limb follows one smooth trajectory.",
      );
    const result = validateReview({ runId: "test", run: passingRun, markdown, expectedScenarios });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/copy-pasted duplicates/);
  });

  it("rejects generic or telemetry-only text in place of visual inspection", () => {
    const markdown = completedMarkdown()
      .replace(
        "The roll occurrence shows continuous pelvis, feet, and weapon motion across this exact window.",
        "Telemetry and the expected animation state both report that this artifact passes all metrics.",
      )
      .replace(
        "The roll pose keeps credible support and weight while each limb follows one smooth trajectory.",
        "Everything seems correct and acceptable here, so there are no issues worth describing further.",
      );
    const result = validateReview({ runId: "test", run: passingRun, markdown, expectedScenarios });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/concrete visible|telemetry\/probe language/);
  });

  it("rejects stale, missing, duplicate, or reordered checklist entries", () => {
    const staleEvidence = {
      ...passingEvidence,
      reviewChecklist: [
        passingEvidence.reviewChecklist[1],
        { ...passingEvidence.reviewChecklist[1], id: "stale", artifact: "motion-strips/stale.png" },
      ],
    };
    const result = validateReview({
      runId: "test",
      run: { ...passingRun, scenarioEvidence: { roll: staleEvidence } },
      markdown: completedMarkdown(),
      expectedScenarios,
    });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not exactly match/);
  });

  it("accepts a same-semantic restart boundary only when command serial changes", () => {
    const restartTransition = {
      ...passingEvidence.transitionBoundaryStrips[0],
      reviewId: "edge:enemy:03:CRITICAL_KNOCKDOWN#1->CRITICAL_KNOCKDOWN#2",
      path: "transition-boundaries/001-enemy-critical-restart.png",
      fromAnimation: "CRITICAL_KNOCKDOWN",
      fromCommandSerial: 3,
      toAnimation: "CRITICAL_KNOCKDOWN",
      toCommandSerial: 4,
    };
    const restartEvidence = {
      ...passingEvidence,
      transitionBoundaryStrips: [restartTransition],
      reviewChecklist: [
        passingEvidence.reviewChecklist[0],
        {
          ...passingEvidence.reviewChecklist[1],
          id: restartTransition.reviewId,
          artifact: restartTransition.path,
        },
      ],
    };
    const restartScenarios = [{ scenario: "roll", label: "Forward dodge", evidence: restartEvidence }];
    const markdown = buildReviewMarkdown({
      generatedAt: "2026-08-20T00:00:00.000Z",
      runId: "test",
      coverageSummary: "covered",
      scenarios: restartScenarios,
    })
      .replace("Reviewer: **PENDING**", "Reviewer: **Project owner**")
      .replace("Reviewed at: **PENDING**", "Reviewed at: **2026-08-21T12:00:00.000Z**")
      .replace("Qualitative status: **PENDING**", "Qualitative status: **PASS**")
      .replace("Viewing order: **PENDING**", `Viewing order: **${REQUIRED_VIEWING_ORDER}**`)
      .replace("First-watch observation [00:00.000]: PENDING", "First-watch observation [00:00.500]: The restart reads as one continuous paired victim reaction.")
      .replace("Artifact observation [00:00.000]: PENDING", "Artifact observation [00:00.500]: The roll run stays grounded and keeps a continuous weapon and limb silhouette.")
      .replace("Artifact observation [00:00.000]: PENDING", "Artifact observation [00:00.500]: The same semantic command visibly restarts without a pose pop or frozen frame.")
      .replace("Artifact rationale [00:00.000]: PENDING", "Artifact rationale [00:00.500]: The dodge retains credible support and uninterrupted momentum throughout its rendered run.")
      .replace("Artifact rationale [00:00.000]: PENDING", "Artifact rationale [00:00.500]: Changed command ownership is continuous in the rendered silhouette and source-time handoff.")
      .replaceAll("Evidence verdict: **PENDING**", "Evidence verdict: **PASS**")
      .replace("Frame-level observation [00:00.000]: PENDING", "Frame-level observation [00:00.500]: Both sides of the restart boundary preserve limb and weapon continuity.")
      .replace("First-principles rationale [00:00.000]: PENDING", "First-principles rationale [00:00.500]: The reaction remains readable, grounded, and intentional throughout its ownership transfer.")
      .replaceAll("- [ ]", "- [x]")
      .replace("Verdict: **PENDING**", "Verdict: **PASS**");
    const result = validateReview({
      runId: "test",
      run: { ...passingRun, scenarioEvidence: { roll: restartEvidence } },
      markdown,
      expectedScenarios,
    });
    expect(result.pass).toBe(true);

    const unchangedSerial = {
      ...restartEvidence,
      transitionBoundaryStrips: [{ ...restartTransition, toCommandSerial: 3 }],
    };
    expect(validateReview({
      runId: "test",
      run: { ...passingRun, scenarioEvidence: { roll: unchangedSerial } },
      markdown,
      expectedScenarios,
    }).errors.join(" ")).toMatch(/does not span/);
  });

  it("rejects presentation-caveat verdicts at both run and scenario level", () => {
    const markdown = completedMarkdown()
      .replace("Qualitative status: **PASS**", "Qualitative status: **PASS WITH PRESENTATION CAVEATS**")
      .replace("Verdict: **PASS**", "Verdict: **PASS WITH PRESENTATION CAVEATS**");
    const result = validateReview({
      runId: "test",
      run: { ...passingRun, qualitativeReview: "PASS WITH PRESENTATION CAVEATS" },
      markdown,
      expectedScenarios,
    });
    expect(result.pass).toBe(false);
    expect(result.errors.join(" ")).toMatch(/unequivocal PASS/);
  });

  it("rejects a review bundle without a strip spanning each transition boundary", () => {
    const missing = validateReview({
      runId: "test",
      run: { ...passingRun, scenarioEvidence: {} },
      markdown: completedMarkdown(),
      expectedScenarios,
    });
    expect(missing.pass).toBe(false);
    expect(missing.errors.join(" ")).toMatch(/transition boundary strips/);

    const notSpanning = validateReview({
      runId: "test",
      run: {
        ...passingRun,
        scenarioEvidence: {
          roll: {
            transitionBoundaryStrips: [{
              path: "transition-boundaries/bad.png",
              fromAnimation: "SWORD_IDLE",
              toAnimation: "ROLL",
              start: 0.5,
              transitionTime: 0.5,
              end: 0.75,
            }],
          },
        },
      },
      markdown: completedMarkdown(),
      expectedScenarios,
    });
    expect(notSpanning.pass).toBe(false);
    expect(notSpanning.errors.join(" ")).toMatch(/does not span/);
  });
});
