import type { CombatAction } from "../core/types";
import { clipConfig } from "../anim/animationManifest";
import { BLOCK_RECOIL_DURATION } from "./blockReaction";
import { COMBAT_TUNING } from "./weapon";

export const PLAYER_MAX_HEALTH = COMBAT_TUNING.maxHealth;
export const ENEMY_MAX_HEALTH = 150;
export const PLAYER_ESTUS = 3;
export const ENEMY_ESTUS = 1;

function clipPlaybackDuration(state: Parameters<typeof clipConfig>[0], fallback: number) {
  const config = clipConfig(state);
  return config.sourceDuration && config.playbackRate > 0
    ? config.sourceDuration / config.playbackRate
    : fallback;
}

// Fixed durations for the actions whose length is not encoded in a weapon
// definition. Attack lengths come from the weapon moveset instead. EQUIP and
// UNEQUIP must match their clip's actual source duration (playback rate 1) —
// a shorter fixed value here cuts the draw/sheathe animation off partway
// through.
export const ACTION_DURATIONS: Partial<Record<CombatAction, number>> = {
  roll: COMBAT_TUNING.rollDuration,
  backstep: 0.52,
  parry: COMBAT_TUNING.parryDuration,
  heal: COMBAT_TUNING.healDuration,
  equip: clipConfig("EQUIP").sourceDuration ?? 0.62,
  unequip: clipConfig("UNEQUIP").sourceDuration ?? 0.62,
  hit: 0.62,
  hitHeavy: 0.62,
  recoil: BLOCK_RECOIL_DURATION,
  guardBreak: clipPlaybackDuration("GUARD_BREAK", 1.75),
};

// Timeouts for the enemy state machine's non-attack states.
export const ENEMY_STATE_DURATIONS = {
  strafe: 0.62,
  guard: 0.82,
  parry: COMBAT_TUNING.parryDuration,
  recover: 0.72,
  recoil: BLOCK_RECOIL_DURATION,
  parried: clipPlaybackDuration("GUARD_BREAK", 1.75),
  staggerLight: 0.62,
  staggerDefault: 0.58,
} as const;

// Initial dodge/backstep launch speeds. The controllers decay these over the
// action's duration.
export const DODGE_SPEED = {
  playerRoll: 10.0,
  playerBackstep: 7.0,
  enemyRoll: 10.0,
  enemyBackstep: 7.0,
} as const;

export const ENEMY_LOCOMOTION = {
  walkVel: 1.75,
  runVel: 4.5,
  runDistance: 6,
  decisionMin: 0.3,
  decisionJitter: 0.2,
} as const;

export const DEFAULT_ENEMY_COUNT = 1;
export const MAX_ENEMIES = 3;
