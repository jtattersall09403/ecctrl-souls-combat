import type { CombatAction } from "../core/types";
import { BLOCK_RECOIL_DURATION } from "./blockReaction";
import { COMBAT_TUNING } from "./weapon";

export const PLAYER_MAX_HEALTH = COMBAT_TUNING.maxHealth;
export const ENEMY_MAX_HEALTH = 150;
export const PLAYER_ESTUS = 3;
export const ENEMY_ESTUS = 1;

// Fixed durations for the actions whose length is not encoded in a weapon
// definition. Attack lengths come from the weapon moveset instead.
export const ACTION_DURATIONS: Partial<Record<CombatAction, number>> = {
  roll: COMBAT_TUNING.rollDuration,
  backstep: 0.52,
  parry: 0.66,
  heal: COMBAT_TUNING.healDuration,
  equip: 0.62,
  unequip: 0.62,
  hit: 0.62,
  hitHeavy: 0.62,
  recoil: BLOCK_RECOIL_DURATION,
  guardBreak: 1.05,
};

// Timeouts for the enemy state machine's non-attack states.
export const ENEMY_STATE_DURATIONS = {
  strafe: 0.62,
  guard: 0.82,
  parry: 0.66,
  recover: 0.72,
  recoil: BLOCK_RECOIL_DURATION,
  parried: 1.75,
  staggerLight: 0.62,
  staggerDefault: 0.58,
} as const;

export const CRITICAL_FALL_DURATION = 1.55;
export const CRITICAL_GET_UP_DURATION = 1.72;

// Initial dodge/backstep launch speeds. The controllers decay these over the
// action's duration.
export const DODGE_SPEED = {
  playerRoll: 7.2,
  playerBackstep: 4.2,
  enemyRoll: 6.7,
  enemyBackstep: 4.1,
  backstepLift: 2.15,
} as const;

export const ENEMY_LOCOMOTION = {
  walkVel: 1.75,
  runVel: 2.55,
  runDistance: 6,
  decisionMin: 0.3,
  decisionJitter: 0.2,
} as const;

export const DEFAULT_ENEMY_COUNT = 1;
export const MAX_ENEMIES = 3;
