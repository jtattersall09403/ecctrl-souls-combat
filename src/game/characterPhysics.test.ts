import { describe, expect, it } from "vitest";
import {
  BASE_JUMP_VELOCITY,
  CHARACTER_BODY_CENTER_HEIGHT,
  CHARACTER_MODEL_OFFSET,
  JUMP_GRAVITY_SCALE,
  JUMP_VELOCITY,
  jumpApexHeight,
  jumpApexTime,
} from "./characterPhysics";

describe("shared character grounding and jump arc", () => {
  it("places model feet exactly on the support plane at equilibrium", () => {
    expect(CHARACTER_BODY_CENTER_HEIGHT + CHARACTER_MODEL_OFFSET).toBeCloseTo(0, 8);
  });

  it("keeps jump height while reaching the apex sooner", () => {
    const oldHeight = jumpApexHeight(BASE_JUMP_VELOCITY, 1);
    const newHeight = jumpApexHeight(JUMP_VELOCITY, JUMP_GRAVITY_SCALE);
    expect(newHeight).toBeCloseTo(oldHeight, 8);
    expect(jumpApexTime(JUMP_VELOCITY, JUMP_GRAVITY_SCALE)).toBeLessThan(jumpApexTime(BASE_JUMP_VELOCITY, 1));
  });
});
