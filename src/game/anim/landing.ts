import type { AnimationState } from "../core/types";

export type LandingKind = "stationary" | "moving" | "sprint" | "hard";

export type LandingSelection = {
  animation: Extract<AnimationState, "JUMP_LAND" | "JUMP_LAND_LEFT" | "JUMP_LAND_RIGHT">;
  duration: number;
  kind: LandingKind;
  impactSpeed: number;
  planarSpeed: number;
};

const MOVING_SPEED = 0.75;
const SPRINT_SPEED = 4.4;
const HARD_IMPACT_SPEED = 6.5;

/**
 * Resolve the touchdown clip without taking horizontal authority from the
 * movement controller. Vanilla's left/right clips were auditioned but contain
 * authored quarter-turns, so they are unsafe while controller facing remains
 * authoritative. Moving landings instead compress the neutral clip into a
 * very short touchdown before locomotion resumes.
 */
export function selectLandingAnimation({
  velocity,
  impactSpeed,
}: {
  velocity: { x: number; z: number };
  impactSpeed: number;
}): LandingSelection {
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  const hard = impactSpeed >= HARD_IMPACT_SPEED;
  if (planarSpeed < MOVING_SPEED) {
    return {
      animation: "JUMP_LAND",
      duration: hard ? 0.34 : 0.42,
      kind: hard ? "hard" : "stationary",
      impactSpeed,
      planarSpeed,
    };
  }

  const kind: LandingKind = hard ? "hard" : planarSpeed >= SPRINT_SPEED ? "sprint" : "moving";
  return {
    animation: "JUMP_LAND",
    duration: hard ? 0.24 : kind === "sprint" ? 0.16 : 0.2,
    kind,
    impactSpeed,
    planarSpeed,
  };
}
