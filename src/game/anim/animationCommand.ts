import type { AnimationState } from "../core/types";

export type AnimationCommand = {
  state: AnimationState;
  startAt: number;
  serial: number;
};

export function createAnimationCommand(
  state: AnimationState,
  startAt = 0,
): AnimationCommand {
  return { state, startAt, serial: 0 };
}

/** Mutates a ref-owned command synchronously and reports whether it changed. */
export function updateAnimationCommand(
  command: AnimationCommand,
  state: AnimationState,
  startAt = 0,
  restart = false,
) {
  if (command.state === state && !restart) return false;
  command.state = state;
  command.startAt = startAt;
  command.serial += 1;
  return true;
}
