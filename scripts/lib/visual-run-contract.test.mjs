import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRunEdges,
  buildRunEvidenceSegments,
  buildRunReviewChecklist,
  buildRunTransitionSegments,
  collectContractEdges,
  compareRenderedRunPath,
  extractRenderedRuns,
  validateTransitionObligations,
} from "./visual-run-contract.mjs";

const productionContracts = JSON.parse(readFileSync(
  new URL("../../src/game/validation/visualScenarioExpectations.json", import.meta.url),
  "utf8",
));
const productionTransitionObligations = JSON.parse(readFileSync(
  new URL("../../src/game/validation/visualTransitionObligations.json", import.meta.url),
  "utf8",
));

function frame(time, playerAnimation, clipTime = time, enemyAnimation = null, commandSerial = 1) {
  return {
    time,
    player: playerAnimation ? { animation: playerAnimation, clipTime, commandSerial } : null,
    enemy: enemyAnimation ? { animation: enemyAnimation, clipTime, commandSerial } : null,
  };
}

describe("rendered animation run contracts", () => {
  it("extracts occurrence-aware semantic runs and adjacent edge ids", () => {
    const telemetry = { visualFrames: [
      frame(0, "SWORD_IDLE", 0),
      frame(0.033, "SWORD_IDLE", 0.033),
      frame(0.067, "SWORD_IDLE", 0.067),
      frame(0.1, "ROLL", 0),
      frame(0.133, "ROLL", 0.04),
      frame(0.167, "ROLL", 0.08),
      frame(0.2, "SWORD_IDLE", 0),
      frame(0.233, "SWORD_IDLE", 0.033),
      frame(0.267, "SWORD_IDLE", 0.067),
    ] };
    const runs = extractRenderedRuns(telemetry, "player");
    expect(runs.map(({ id }) => id)).toEqual([
      "player:01:SWORD_IDLE#1",
      "player:02:ROLL#1",
      "player:03:SWORD_IDLE#2",
    ]);
    expect(buildRunEdges(runs).map(({ id }) => id)).toEqual([
      "player:01:SWORD_IDLE#1->ROLL#1",
      "player:02:ROLL#1->SWORD_IDLE#2",
    ]);
  });

  it("requires the exact complete path and rejects detours or re-entry", () => {
    const samples = (states) => states.flatMap((state, runIndex) => (
      [0, 1, 2].map((offset) => frame(runIndex * 0.15 + offset / 30, state, offset / 30))
    ));
    const requiredRuns = ["SWORD_IDLE", "RIPOSTE", "CRITICAL_KNOCKDOWN", "SWORD_IDLE"];
    expect(compareRenderedRunPath({
      telemetry: { visualFrames: samples(requiredRuns) },
      actor: "player",
      requiredRuns,
    }).pass).toBe(true);

    const detour = compareRenderedRunPath({
      telemetry: { visualFrames: samples(["SWORD_IDLE", "RIPOSTE", "GUARD", "CRITICAL_KNOCKDOWN", "SWORD_IDLE"]) },
      actor: "player",
      requiredRuns,
    });
    expect(detour.pass).toBe(false);
    expect(detour.failures.join(" ")).toMatch(/expected CRITICAL_KNOCKDOWN, observed GUARD|unexpected rendered run/);

    const reentry = compareRenderedRunPath({
      telemetry: { visualFrames: samples(["SWORD_IDLE", "RIPOSTE", "SWORD_IDLE", "RIPOSTE", "CRITICAL_KNOCKDOWN", "SWORD_IDLE"]) },
      actor: "player",
      requiredRuns,
    });
    expect(reentry.pass).toBe(false);
    expect(reentry.failures.join(" ")).toMatch(/expected CRITICAL_KNOCKDOWN, observed SWORD_IDLE|unexpected rendered run/);
  });

  it("enforces sample, duration, source-span, and continuity minima", () => {
    const telemetry = { visualFrames: [
      frame(0, "ROLL", 0),
      frame(0.2, "ROLL", 0.02),
    ] };
    const result = compareRenderedRunPath({
      telemetry,
      actor: "player",
      requiredRuns: [{
        state: "ROLL",
        minSamples: 3,
        minDurationSeconds: 0.3,
        minClipSpanSeconds: 0.2,
      }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures.join(" ")).toMatch(/rendered samples/);
    expect(result.failures.join(" ")).toMatch(/lasts/);
    expect(result.failures.join(" ")).toMatch(/source time/);
    expect(result.failures.join(" ")).toMatch(/frame gap/);
  });

  it("does not misclassify a looping clip-time wrap as a command restart", () => {
    const telemetry = { visualFrames: [
      frame(0, "RUN", 0.58),
      frame(0.033, "RUN", 0.61),
      frame(0.067, "RUN", 0.01),
      frame(0.1, "RUN", 0.04),
    ] };
    expect(extractRenderedRuns(telemetry, "player")).toHaveLength(1);
  });

  it("splits and reviews a deliberate same-semantic command restart", () => {
    const telemetry = { visualFrames: [
      frame(0, "CRITICAL_KNOCKDOWN", 1.38, null, 4),
      frame(0.033, "CRITICAL_KNOCKDOWN", 1.41, null, 4),
      frame(0.067, "CRITICAL_KNOCKDOWN", 1.433, null, 5),
      frame(0.1, "CRITICAL_KNOCKDOWN", 1.466, null, 5),
    ] };
    const runs = extractRenderedRuns(telemetry, "player");
    expect(runs.map(({ state, occurrence, commandSerial }) => ({ state, occurrence, commandSerial })))
      .toEqual([
        { state: "CRITICAL_KNOCKDOWN", occurrence: 1, commandSerial: 4 },
        { state: "CRITICAL_KNOCKDOWN", occurrence: 2, commandSerial: 5 },
      ]);
    expect(buildRunTransitionSegments(runs, 0.2)).toMatchObject([{
      reviewId: "edge:player:01:CRITICAL_KNOCKDOWN#1->CRITICAL_KNOCKDOWN#2",
      fromCommandSerial: 4,
      toCommandSerial: 5,
    }]);
  });

  it("creates a distinct checklist id for every run chunk", () => {
    const runs = extractRenderedRuns({ visualFrames: [
      frame(0, "RUN", 0),
      frame(0.5, "RUN", 0.5),
      frame(1, "RUN", 0.37),
      frame(1.5, "RUN", 0.24),
      frame(1.9, "RUN", 0.01),
    ] }, "player");
    const segments = buildRunEvidenceSegments(runs, 2);
    expect(segments.map(({ reviewId }) => reviewId)).toEqual([
      "run:player:01:RUN#1:part:1-of-2",
      "run:player:01:RUN#1:part:2-of-2",
    ]);
  });

  it("balances a barely-over-boundary run without inventing a sub-frame tail", () => {
    const segments = buildRunEvidenceSegments([{
      id: "enemy:05:SWORD_IDLE#3",
      actor: "enemy",
      index: 4,
      state: "SWORD_IDLE",
      occurrence: 3,
      commandSerial: 5,
      start: 4.1,
      end: 7.067,
      samples: 90,
    }], 7.067);

    expect(segments).toHaveLength(4);
    expect(segments[0].start).toBe(4.05);
    expect(segments.at(-1).end).toBe(7.067);
    expect(segments.every(({ duration }) => duration > 0.7 && duration <= 1)).toBe(true);
    expect(segments.every(({ start, end, duration }) => duration === Number((end - start).toFixed(3))))
      .toBe(true);
  });

  it("binds every emitted run and transition artifact to one review item", () => {
    const checklist = buildRunReviewChecklist([{
      reviewId: "run:player:01:ROLL#1:part:1-of-1",
      path: "motion-strips/001-player-roll-part-1-of-1.png",
      actor: "player",
      animation: "ROLL",
      occurrence: 1,
      commandSerial: 2,
      start: 0.4,
      end: 0.8,
      part: 1,
      parts: 1,
    }], [{
      reviewId: "edge:player:01:SWORD_IDLE#1->ROLL#1",
      path: "transition-boundaries/001-player-sword-idle-to-roll.png",
      actor: "player",
      fromAnimation: "SWORD_IDLE",
      fromOccurrence: 1,
      fromCommandSerial: 1,
      toAnimation: "ROLL",
      toOccurrence: 1,
      toCommandSerial: 2,
      transitionTime: 0.5,
      start: 0.35,
      end: 0.75,
    }]);
    expect(checklist).toMatchObject([
      {
        id: "run:player:01:ROLL#1:part:1-of-1",
        kind: "animation-run",
        artifact: "motion-strips/001-player-roll-part-1-of-1.png",
      },
      {
        id: "edge:player:01:SWORD_IDLE#1->ROLL#1",
        kind: "animation-transition",
        artifact: "transition-boundaries/001-player-sword-idle-to-roll.png",
      },
    ]);
  });

  it("rejects duplicate review ids or artifact paths", () => {
    const strip = {
      reviewId: "run:player:01:ROLL#1:part:1-of-1",
      path: "motion-strips/001.png",
    };
    expect(() => buildRunReviewChecklist([strip, strip], [])).toThrow(/duplicate review checklist id/);
    expect(() => buildRunReviewChecklist([
      strip,
      { ...strip, reviewId: "run:player:02:ROLL#2:part:1-of-1" },
    ], [])).toThrow(/duplicate review artifact path/);
  });

  it("fails exact validation when command serial evidence is absent", () => {
    const result = compareRenderedRunPath({
      telemetry: { visualFrames: [{ time: 0, player: { animation: "ROLL", clipTime: 0 } }] },
      actor: "player",
      requiredRuns: [{ state: "ROLL", minSamples: 1 }],
    });
    expect(result.pass).toBe(false);
    expect(result.failures.join(" ")).toMatch(/missing commandSerial/);
  });
});

describe("runtime transition obligations", () => {
  const contracts = {
    roll: {
      requiredAnimationRuns: {
        player: ["SWORD_IDLE", "RUN", "ROLL", "RUN", "SWORD_IDLE"],
      },
    },
    "dodge-followups": {
      requiredAnimationRuns: {
        player: ["SWORD_IDLE", "RUN", "ROLL", "LIGHT_1", "SWORD_IDLE", "ROLL", "LIGHT_1", "SWORD_IDLE"],
      },
    },
  };

  it("collects occurrence-aware static edges from scenario contracts", () => {
    const edges = collectContractEdges(contracts);
    expect(edges.find(({ scenario, id }) => (
      scenario === "dodge-followups" && id === "player:06:ROLL#2->LIGHT_1#2"
    ))).toBeTruthy();
  });

  it("proves each named FSM obligation is an adjacent scenario edge", () => {
    const result = validateTransitionObligations(contracts, [{
      id: "roll-light-followup-second",
      scenario: "dodge-followups",
      actor: "player",
      from: "ROLL",
      fromOccurrence: 2,
      to: "LIGHT_1",
      toOccurrence: 2,
    }]);
    expect(result.pass).toBe(true);
    expect(result.coverage[0].matches).toEqual([{
      id: "player:06:ROLL#2->LIGHT_1#2",
      scenario: "dodge-followups",
    }]);
  });

  it("rejects uncovered and ambiguous obligations", () => {
    const uncovered = validateTransitionObligations(contracts, [{
      id: "roll-heavy-followup",
      scenario: "dodge-followups",
      actor: "player",
      from: "ROLL",
      to: "HEAVY",
    }]);
    expect(uncovered.pass).toBe(false);
    expect(uncovered.failures.join(" ")).toMatch(/is not an adjacent/);

    const ambiguous = validateTransitionObligations(contracts, [{
      id: "some-roll-light-followup",
      scenario: "dodge-followups",
      actor: "player",
      from: "ROLL",
      to: "LIGHT_1",
    }]);
    expect(ambiguous.pass).toBe(false);
    expect(ambiguous.failures.join(" ")).toMatch(/matches 2 edges/);
  });

  it("rejects duplicate obligation ids as malformed registry data", () => {
    const duplicate = {
      id: "roll-entry",
      scenario: "roll",
      actor: "player",
      from: "RUN",
      to: "ROLL",
    };
    expect(() => validateTransitionObligations(contracts, [duplicate, duplicate]))
      .toThrow(/duplicate transition obligation id/);
  });

  it("maps every curated production obligation to exactly one occurrence-aware adjacent edge", () => {
    for (const obligation of productionTransitionObligations) {
      expect(Number.isInteger(obligation.fromOccurrence), `${obligation.id} from occurrence`).toBe(true);
      expect(Number.isInteger(obligation.toOccurrence), `${obligation.id} to occurrence`).toBe(true);
      expect(obligation.fromOccurrence).toBeGreaterThan(0);
      expect(obligation.toOccurrence).toBeGreaterThan(0);
    }
    const result = validateTransitionObligations(
      productionContracts,
      productionTransitionObligations,
    );
    expect(result.failures).toEqual([]);
    expect(result.coverage).toHaveLength(productionTransitionObligations.length);
    expect(result.coverage.every(({ matches }) => matches.length === 1)).toBe(true);
    expect(result.coverage.find(({ id }) => id === "riposte-victim-contact-reaction")?.matches)
      .toEqual([{ id: "enemy:03:GUARD_BREAK#1->RIPOSTED_HIT1#1", scenario: "riposte" }]);
    expect(result.coverage.find(({ id }) => id === "lethal-riposte-victim-death-at-contact")?.matches)
      .toEqual([{ id: "enemy:01:GUARD_BREAK#1->CRITICAL_DEATH#1", scenario: "riposte-lethal" }]);
  });
});
