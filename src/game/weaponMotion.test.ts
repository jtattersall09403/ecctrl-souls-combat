import { describe, expect, it } from "vitest";
import {
  EXECUTION_ANCHOR_DISTANCE,
  EXECUTION_DAMAGE_PROGRESS,
  bladeCenter,
  executionAnchor,
  executionBladeIntersectsVictim,
  executionFacingYaw,
  executionWeaponPath,
  parryWeaponPath,
} from "./weaponMotion";

describe("paired weapon motion", () => {
  it("anchors a backstab behind and a riposte in front of the victim", () => {
    const enemy = { x: 2, z: 4 };
    const forward = { x: 0, z: 1 };
    expect(executionAnchor(enemy, forward, "backstab")).toEqual({ x: 2, z: 4 - EXECUTION_ANCHOR_DISTANCE });
    expect(executionAnchor(enemy, forward, "riposte")).toEqual({ x: 2, z: 4 + EXECUTION_ANCHOR_DISTANCE });
    expect(executionFacingYaw(0.4, "backstab")).toBeCloseTo(0.4);
    expect(executionFacingYaw(0.4, "riposte")).toBeCloseTo(0.4 + Math.PI);
  });

  it("drives the blade through the torso and then withdraws it", () => {
    const before = executionWeaponPath(0);
    const impact = executionWeaponPath(EXECUTION_DAMAGE_PROGRESS);
    const withdrawn = executionWeaponPath(0.8);
    expect(impact.tip.z).toBeGreaterThan(1.35);
    expect(impact.grip.z).toBeGreaterThan(before.grip.z);
    expect(withdrawn.tip.z).toBeLessThan(impact.tip.z);
    expect(executionBladeIntersectsVictim(0)).toBe(false);
    expect(executionBladeIntersectsVictim(EXECUTION_DAMAGE_PROGRESS)).toBe(true);
    expect(executionBladeIntersectsVictim(0.8)).toBe(false);
  });

  it("keeps the complete parry arc in front of either fighter", () => {
    for (let step = 0; step <= 20; step += 1) {
      const path = parryWeaponPath(step / 20);
      expect(path.grip.z).toBeGreaterThanOrEqual(0.2);
      expect(path.tip.z).toBeGreaterThanOrEqual(0.2);
      expect(bladeCenter(path).z).toBeGreaterThan(0.2);
    }
  });
});
