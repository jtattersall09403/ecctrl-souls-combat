import type { WeaponDefinition } from "./types";

// Timings are data, not branches in the controller. A new weapon can supply a
// complete moveset without changing the combat state machine.
export const STRAIGHT_SWORD: WeaponDefinition = {
  id: "straight-sword",
  label: "Weathered Straight Sword",
  attacks: {
    light1: {
      id: "light1",
      animation: "LIGHT_1",
      damage: 24,
      stamina: 18,
      windup: 0.18,
      active: 0.13,
      recovery: 0.37,
      range: 2.05,
      arc: 1.4,
      lunge: 1.45,
      hitStop: 0.055,
    },
    light2: {
      id: "light2",
      animation: "LIGHT_2",
      damage: 29,
      stamina: 20,
      windup: 0.16,
      active: 0.14,
      recovery: 0.42,
      range: 2.15,
      arc: 1.28,
      lunge: 1.6,
      hitStop: 0.065,
    },
    heavy: {
      id: "heavy",
      animation: "HEAVY",
      damage: 45,
      stamina: 32,
      windup: 0.52,
      active: 0.17,
      recovery: 0.66,
      range: 2.3,
      arc: 1.05,
      lunge: 1.85,
      hitStop: 0.085,
    },
    riposte: {
      id: "riposte",
      animation: "RIPOSTE",
      damage: 82,
      stamina: 0,
      windup: 0.22,
      active: 0.12,
      recovery: 0.72,
      range: 1.65,
      arc: 0.55,
      lunge: 1.1,
      hitStop: 0.13,
    },
  },
};

export const COMBAT_TUNING = {
  maxHealth: 100,
  maxStamina: 100,
  staminaRegenPerSecond: 30,
  staminaRegenDelay: 0.72,
  sprintDrainPerSecond: 15,
  rollCost: 28,
  backstepCost: 22,
  parryCost: 14,
  guardStability: 0.58,
  guardDamageReduction: 0.92,
  rollDuration: 0.72,
  rollIFrameStart: 0.12,
  rollIFrameEnd: 0.43,
  parryActiveStart: 0.1,
  parryActiveEnd: 0.29,
  healDuration: 1.55,
  healAmount: 45,
  comboQueueWindow: 0.25,
} as const;

export function phaseAt(elapsed: number, attack: WeaponDefinition["attacks"]["light1"]) {
  if (elapsed < attack.windup) return "windup" as const;
  if (elapsed < attack.windup + attack.active) return "active" as const;
  if (elapsed < attack.windup + attack.active + attack.recovery) return "recovery" as const;
  return "none" as const;
}

export function isRollInvulnerable(elapsed: number) {
  return elapsed >= COMBAT_TUNING.rollIFrameStart && elapsed <= COMBAT_TUNING.rollIFrameEnd;
}

export function isParryActive(elapsed: number) {
  return elapsed >= COMBAT_TUNING.parryActiveStart && elapsed <= COMBAT_TUNING.parryActiveEnd;
}
