import { describe, expect, it } from "vitest";
import { SWITCH_GAMEPAD, analogueMoveSpeed, cameraRelativeDirection, resolveAttackDirection } from "./input";

describe("movement translation", () => {
  it("maps stick forward away from a camera behind the player", () => {
    expect(cameraRelativeDirection({ x: 0, y: 1 }, 0)).toEqual({ x: 0, y: 0, z: -1 });
    expect(cameraRelativeDirection({ x: 0, y: -1 }, 0)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("preserves left and right at the default camera yaw", () => {
    expect(cameraRelativeDirection({ x: 1, y: 0 }, 0)).toEqual({ x: 1, y: 0, z: -0 });
  });

  it("scales movement speed with analogue magnitude", () => {
    expect(analogueMoveSpeed(0.25, false)).toBeCloseTo(0.9);
    expect(analogueMoveSpeed(0.5, false)).toBeCloseTo(1.8);
    expect(analogueMoveSpeed(1, false)).toBeCloseTo(3.6);
    expect(analogueMoveSpeed(1, true)).toBeCloseTo(5.5);
  });

  it("resolves a queued attack from the current stick instead of the prior roll", () => {
    const rollDirection = { x: 0, z: -1 };
    expect(resolveAttackDirection({ x: 1, y: 0 }, 0, rollDirection)).toEqual({ x: 1, y: 0, z: -0 });
    expect(resolveAttackDirection({ x: 0, y: -1 }, 0, rollDirection)).toEqual({ x: 0, y: 0, z: 1 });
    expect(resolveAttackDirection({ x: 0, y: 0 }, 0, rollDirection)).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("honours small movement that has already passed the controller dead zone", () => {
    const direction = resolveAttackDirection({ x: 0.1, y: 0 }, Math.PI / 2, { x: 1, z: 0 });
    expect(direction.x).toBeCloseTo(0);
    expect(direction.z).toBeCloseTo(-1);
  });
});

describe("GameSir controls", () => {
  it("maps jump to the Nintendo-layout A face button and L3", () => {
    expect(SWITCH_GAMEPAD.A_RIGHT_JUMP).toBe(1);
    expect(SWITCH_GAMEPAD.L_STICK_JUMP).toBe(10);
  });
});
