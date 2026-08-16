import { describe, expect, it } from "vitest";
import { combatPoseAt } from "./combatPose";

describe("procedural combat poses", () => {
  it("makes the second light attack an opposing backswing", () => {
    const first = combatPoseAt("LIGHT_1", 0.3);
    const second = combatPoseAt("LIGHT_2", 0.34);
    expect(Math.sign(first.bodyYaw)).toBe(-Math.sign(second.bodyYaw));
    expect(Math.abs(second.rightArmY)).toBeGreaterThan(0.4);
  });

  it("matches the procedural pose at both active combo joins", () => {
    const firstEnd = combatPoseAt("LIGHT_1", 0.46);
    const secondEntry = combatPoseAt("LIGHT_2", 0.16);
    const secondEnd = combatPoseAt("LIGHT_2", 0.46);
    const thirdEntry = combatPoseAt("LIGHT_3", 0.2);

    expect(secondEntry.bodyYaw).toBeCloseTo(firstEnd.bodyYaw, 1);
    expect(secondEntry.rightArmZ).toBeCloseTo(firstEnd.rightArmZ, 1);
    expect(thirdEntry.bodyYaw).toBeCloseTo(secondEnd.bodyYaw, 1);
    expect(thirdEntry.rightArmY).toBeCloseTo(secondEnd.rightArmY, 1);
    expect(thirdEntry.rightArmZ).toBeCloseTo(secondEnd.rightArmZ, 1);
  });

  it("turns critical attacks into a thrust followed by withdrawal", () => {
    const impact = combatPoseAt("BACKSTAB", 0.62);
    const withdrawal = combatPoseAt("BACKSTAB", 1.18);
    expect(impact.weaponPitch).toBeGreaterThan(1);
    expect(impact.weaponForward).toBeGreaterThan(0.2);
    expect(withdrawal.weaponForward).toBeLessThan(0);
  });
});
