import { describe, expect, it } from "vitest";
import { combatPoseAt } from "./combatPose";

describe("procedural combat poses", () => {
  it("makes the second light attack an opposing backswing", () => {
    const first = combatPoseAt("LIGHT_1", 0.3);
    const second = combatPoseAt("LIGHT_2", 0.34);
    expect(Math.sign(first.bodyYaw)).toBe(-Math.sign(second.bodyYaw));
    expect(Math.abs(second.rightArmY)).toBeGreaterThan(0.4);
  });

  it("turns critical attacks into a thrust followed by withdrawal", () => {
    const impact = combatPoseAt("BACKSTAB", 0.62);
    const withdrawal = combatPoseAt("BACKSTAB", 1.18);
    expect(impact.weaponPitch).toBeGreaterThan(1);
    expect(impact.weaponForward).toBeGreaterThan(0.2);
    expect(withdrawal.weaponForward).toBeLessThan(0);
  });

  it("gives heavy hits a stronger recoil than light hits", () => {
    const light = combatPoseAt("HIT", 0.18);
    const heavy = combatPoseAt("HIT_HEAVY", 0.18);
    expect(Math.abs(heavy.modelPitch)).toBeGreaterThan(Math.abs(light.modelPitch));
    expect(Math.abs(heavy.bodyPitch)).toBeGreaterThan(Math.abs(light.bodyPitch));
  });
});
