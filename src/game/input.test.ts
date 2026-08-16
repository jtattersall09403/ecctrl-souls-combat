import { describe, expect, it } from "vitest";
import { SWITCH_GAMEPAD, analogueMoveSpeed, cameraRelativeDirection } from "./input";

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
});

describe("GameSir controls", () => {
  it("maps jump to the Nintendo-layout A face button and L3", () => {
    expect(SWITCH_GAMEPAD.A_RIGHT_JUMP).toBe(1);
    expect(SWITCH_GAMEPAD.L_STICK_JUMP).toBe(10);
  });
});
