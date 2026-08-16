import { describe, expect, it } from "vitest";
import { combatPoseAt } from "./combatPose";
import { STRAIGHT_SWORD, comboTransitionTime } from "./weapon";

describe("procedural combat poses", () => {
  it("makes the second light attack an opposing backswing", () => {
    const first = combatPoseAt("LIGHT_1", 0.36);
    const second = combatPoseAt("LIGHT_2", 0.36);
    expect(Math.sign(first.bodyYaw)).toBe(-Math.sign(second.bodyYaw));
    expect(Math.abs(second.hipsY + second.spineLowerYaw + second.spineMidYaw + second.bodyYaw)).toBeGreaterThan(0.2);
  });

  it("matches the procedural pose at both active combo joins", () => {
    const firstEnd = combatPoseAt("LIGHT_1", comboTransitionTime(STRAIGHT_SWORD.attacks.light1));
    const secondEntry = combatPoseAt("LIGHT_2", 0);
    const secondEnd = combatPoseAt("LIGHT_2", comboTransitionTime(STRAIGHT_SWORD.attacks.light2));
    const thirdEntry = combatPoseAt("LIGHT_3", 0);

    expect(secondEntry.bodyYaw).toBeCloseTo(firstEnd.bodyYaw, 5);
    expect(secondEntry.bodyPitch).toBeCloseTo(firstEnd.bodyPitch, 5);
    expect(secondEntry.hipsY).toBeCloseTo(firstEnd.hipsY, 5);
    expect(secondEntry.spineLowerYaw).toBeCloseTo(firstEnd.spineLowerYaw, 5);
    expect(secondEntry.spineMidYaw).toBeCloseTo(firstEnd.spineMidYaw, 5);
    expect(secondEntry.rightArmZ).toBeCloseTo(firstEnd.rightArmZ, 5);
    expect(secondEntry.weaponRoll).toBeCloseTo(firstEnd.weaponRoll, 5);
    expect(thirdEntry.bodyYaw).toBeCloseTo(secondEnd.bodyYaw, 5);
    expect(thirdEntry.bodyPitch).toBeCloseTo(secondEnd.bodyPitch, 5);
    expect(thirdEntry.hipsY).toBeCloseTo(secondEnd.hipsY, 5);
    expect(thirdEntry.spineLowerYaw).toBeCloseTo(secondEnd.spineLowerYaw, 5);
    expect(thirdEntry.spineMidYaw).toBeCloseTo(secondEnd.spineMidYaw, 5);
    expect(thirdEntry.rightArmZ).toBeCloseTo(secondEnd.rightArmZ, 5);
    expect(thirdEntry.weaponRoll).toBeCloseTo(secondEnd.weaponRoll, 5);
  });

  it("mirrors lateral gait warping while keeping the chest target-facing", () => {
    const left = combatPoseAt("STRAFE_LEFT", 0.4);
    const right = combatPoseAt("STRAFE_RIGHT", 0.4);
    expect(left.hipsY).toBeCloseTo(-right.hipsY);
    expect(left.bodyRoll).toBeCloseTo(-right.bodyRoll);
    expect(left.hipsY + left.spineLowerYaw + left.spineMidYaw + left.bodyYaw).toBeCloseTo(0);
    expect(right.hipsY + right.spineLowerYaw + right.spineMidYaw + right.bodyYaw).toBeCloseTo(0);
    const leftStride = { x: Math.sin(left.hipsY), z: Math.cos(left.hipsY) };
    const rightStride = { x: Math.sin(right.hipsY), z: Math.cos(right.hipsY) };
    // With fighter-forward +Z, Ecctrl's screen-right basis is forward × up = -X.
    expect(rightStride.x).toBeLessThan(-0.99);
    expect(leftStride.x).toBeGreaterThan(0.99);
  });

  it("turns critical attacks into a thrust followed by withdrawal", () => {
    const impact = combatPoseAt("BACKSTAB", 0.62);
    const withdrawal = combatPoseAt("BACKSTAB", 1.18);
    expect(impact.weaponPitch).toBeGreaterThan(1);
    expect(impact.weaponForward).toBeGreaterThan(0.2);
    expect(withdrawal.weaponForward).toBeLessThan(0);
  });

  it("adds a short weapon rebound to a blocked attacker", () => {
    const rebound = combatPoseAt("RECOIL", 0.14);
    const settled = combatPoseAt("RECOIL", 0.42);
    expect(rebound.bodyPitch).toBeLessThan(0);
    expect(Math.abs(rebound.weaponPitch)).toBeGreaterThan(0.1);
    expect(settled.bodyPitch).toBeCloseTo(0, 6);
    expect(settled.weaponPitch).toBeCloseTo(0, 6);
  });
});
