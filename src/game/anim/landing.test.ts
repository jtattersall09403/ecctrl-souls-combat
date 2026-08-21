import { describe, expect, it } from "vitest";
import { selectLandingAnimation } from "./landing";

describe("velocity-aware landing selection", () => {
  it("keeps the full stationary compression for a soft vertical landing", () => {
    expect(selectLandingAnimation({
      velocity: { x: 0.2, z: 0.1 },
      impactSpeed: 3,
    })).toMatchObject({ animation: "JUMP_LAND", kind: "stationary", duration: 0.58 });
  });

  it("uses a short neutral compression while preserving moving and sprint categories", () => {
    const moving = selectLandingAnimation({
      velocity: { x: 0, z: 2.5 },
      impactSpeed: 4,
    });
    const sprint = selectLandingAnimation({
      velocity: { x: 0, z: 5.2 },
      impactSpeed: 4,
    });
    expect(moving).toMatchObject({ animation: "JUMP_LAND", kind: "moving", duration: 0.42 });
    expect(sprint).toMatchObject({ animation: "JUMP_LAND", kind: "sprint", duration: 0.36 });
  });

  it("keeps neutral facing for lateral velocity and flags hard impacts", () => {
    expect(selectLandingAnimation({
      velocity: { x: -2, z: 1 },
      impactSpeed: 7,
    })).toMatchObject({ animation: "JUMP_LAND", kind: "hard", duration: 0.46 });
  });
});
