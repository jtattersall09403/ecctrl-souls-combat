import type { AnimationState, CombatAction, WeaponDefinition } from "../core/types";
import { clipConfig } from "../anim/animationManifest";

export const LIGHT_ATTACK_BASE_DAMAGE = 24;
export const CRITICAL_DAMAGE_MULTIPLIER = 2;
export const CRITICAL_ATTACK_DAMAGE = LIGHT_ATTACK_BASE_DAMAGE * CRITICAL_DAMAGE_MULTIPLIER;

export type ComboInput = "light" | "heavy";

// A brief anticipation and follow-through bookend the swing; the hitbox is
// active for everything in between, matching the clip's actual authored
// length (previously tuned in frame units for a since-replaced placeholder
// clip, leaving the hitbox active for only ~half the real swing).
const LIGHT_WINDUP_FRACTION = 0.15;
const LIGHT_RECOVERY_FRACTION = 0.15;

function lightAttackTiming(animation: Extract<AnimationState, "LIGHT_1" | "LIGHT_2" | "LIGHT_3">) {
  const duration = clipConfig(animation).sourceDuration ?? 0.72 / (1 - LIGHT_WINDUP_FRACTION - LIGHT_RECOVERY_FRACTION);
  const windup = duration * LIGHT_WINDUP_FRACTION;
  const recovery = duration * LIGHT_RECOVERY_FRACTION;
  return { windup, active: duration - windup - recovery, recovery };
}

const RIPOSTE_DURATION = clipConfig("RIPOSTE").sourceDuration ?? 4.1;
const RIPOSTE_CONTACT_TIME = 1.9333;
const RIPOSTE_RELEASE_TIME = 3.3667;
const BACKSTAB_DURATION = clipConfig("BACKSTAB").sourceDuration ?? 3.1667;
const BACKSTAB_CONTACT_TIME = 1.5;
const BACKSTAB_RELEASE_TIME = 2.2;

function criticalAttackTiming(duration: number, contactTime: number) {
  // Keep damage tightly around the visually audited blade contact, while the
  // complete authored critical continues through withdrawal and recovery.
  const active = 0.28;
  return { windup: contactTime, active, recovery: duration - contactTime - active };
}

// Timings are data, not branches in the controller. A new weapon can supply a
// complete moveset without changing the combat state machine.
export const STRAIGHT_SWORD: WeaponDefinition = {
  id: "straight-sword",
  label: "Weathered Straight Sword",
  visual: {
    asset: "weapon-steel-sword.glb",
    held: {
      socket: "Weapon",
      localPosition: [0, 0, 0],
      localRotation: [0.408263, -0.550300, -0.472324, 0.554439],
      localScale: 1,
    },
    sheathed: {
      socket: "WeaponSword",
      localPosition: [0, 0, 0],
      localRotation: [-0.487106, -0.441521, 0, 0.753516],
      localScale: 1,
    },
  },
  animations: {
    combatIdle: "SWORD_IDLE",
    sprintOverride: "SPRINT",
    guard: {
      enter: "GUARD_ENTER",
      loop: "GUARD",
      hitVariants: ["GUARD_HIT_A", "GUARD_HIT_B"],
    },
    parry: {
      intro: "PARRY",
      followThrough: "PARRY_FOLLOW_THROUGH",
    },
    lightAttacks: ["LIGHT_1", "LIGHT_2", "LIGHT_3"],
    heavyAttacks: ["HEAVY", "HEAVY_2"],
    guardBreak: "GUARD_BREAK",
    riposte: {
      attackerAction: "RIPOSTE",
      victimAction: "RIPOSTED",
      startingSeparation: 1.45,
      relativeFacing: Math.PI,
      alignmentAnchor: "victim",
      damageProgress: RIPOSTE_CONTACT_TIME / RIPOSTE_DURATION,
      releaseProgress: RIPOSTE_RELEASE_TIME / RIPOSTE_DURATION,
      rootMotionPolicy: "controller-aligned-strip-horizontal",
    },
    backstab: {
      attackerAction: "BACKSTAB",
      victimAction: "BACKSTABBED",
      // paired HKX group offset: 56.062 Skyrim units * 0.1 import scale
      // * 0.1496 runtime character scale = 0.8387 metres.
      startingSeparation: 0.839,
      relativeFacing: 0,
      alignmentAnchor: "victim",
      damageProgress: BACKSTAB_CONTACT_TIME / BACKSTAB_DURATION,
      releaseProgress: BACKSTAB_RELEASE_TIME / BACKSTAB_DURATION,
      rootMotionPolicy: "controller-aligned-strip-horizontal",
    },
    equip: "EQUIP",
    unequip: "UNEQUIP",
  },
  attacks: {
    light1: {
      id: "light1",
      animation: "LIGHT_1",
      damage: LIGHT_ATTACK_BASE_DAMAGE,
      stamina: 22,
      ...lightAttackTiming("LIGHT_1"),
      range: 2.05,
      arc: 1.4,
      lunge: 1.45,
      hitStop: 0.055,
    },
    light2: {
      id: "light2",
      animation: "LIGHT_2",
      damage: 29,
      stamina: 24,
      ...lightAttackTiming("LIGHT_2"),
      range: 2.15,
      arc: 1.28,
      lunge: 1.6,
      hitStop: 0.065,
    },
    light3: {
      id: "light3",
      animation: "LIGHT_3",
      damage: 34,
      stamina: 26,
      ...lightAttackTiming("LIGHT_3"),
      range: 2.2,
      arc: 0.82,
      lunge: 1.85,
      hitStop: 0.075,
    },
    heavy: {
      id: "heavy",
      animation: "HEAVY",
      damage: 45,
      stamina: 45,
      // The clip starts its visible release before the old 0.52s boundary.
      // Keep the full visible swing inside the active phase and reserve the
      // final settle for recovery.
      windup: 0.38,
      active: 0.52,
      recovery: 0.45,
      range: 2.3,
      arc: 1.05,
      lunge: 1.85,
      hitStop: 0.085,
    },
    heavy2: {
      id: "heavy2",
      animation: "HEAVY_2",
      damage: 58,
      stamina: 48,
      windup: 0.43,
      active: 0.62,
      recovery: 0.46,
      range: 2.4,
      arc: 0.92,
      lunge: 1.7,
      hitStop: 0.1,
    },
    riposte: {
      id: "riposte",
      animation: "RIPOSTE",
      damage: CRITICAL_ATTACK_DAMAGE,
      stamina: 0,
      ...criticalAttackTiming(RIPOSTE_DURATION, RIPOSTE_CONTACT_TIME),
      range: 1.65,
      arc: 0.55,
      lunge: 1.1,
      hitStop: 0.13,
    },
    backstab: {
      id: "backstab",
      animation: "BACKSTAB",
      damage: CRITICAL_ATTACK_DAMAGE,
      stamina: 0,
      ...criticalAttackTiming(BACKSTAB_DURATION, BACKSTAB_CONTACT_TIME),
      range: 1.75,
      arc: 0.45,
      lunge: 0,
      hitStop: 0.14,
    },
  },
};

export function getComboSuccessor(
  current: WeaponDefinition["attacks"]["light1"],
  queued: ComboInput | null,
) {
  if (queued === "light" && current.id === "light1") return STRAIGHT_SWORD.attacks.light2;
  if (queued === "light" && current.id === "light2") return STRAIGHT_SWORD.attacks.light3;
  if (queued === "heavy" && current.id === "heavy") return STRAIGHT_SWORD.attacks.heavy2;
  return null;
}

/** The current attack branches into its queued successor as its active swing ends. */
export function comboTransitionTime(attack: WeaponDefinition["attacks"]["light1"]) {
  return attack.windup + attack.active;
}

/** A queued successor starts at its authored chain-entry pose. */
export function comboEntryTime(_attack: WeaponDefinition["attacks"]["light1"]) {
  return 0;
}

export function comboQueueOpen(
  elapsed: number,
  previousElapsed: number,
  attack: WeaponDefinition["attacks"]["light1"],
) {
  const phase = phaseAt(elapsed, attack);
  return phase === "active"
    || (phase === "recovery" && phaseAt(previousElapsed, attack) === "active");
}

export function comboSuccessorStartTime(
  elapsed: number,
  attack: WeaponDefinition["attacks"]["light1"],
) {
  return Math.max(0, elapsed - comboTransitionTime(attack));
}

export function hitReactionForAttack(attack: WeaponDefinition["attacks"]["light1"] | null): {
  action: Extract<CombatAction, "hit" | "hitHeavy">;
  animation: Extract<AnimationState, "HIT" | "HIT_HEAVY">;
} {
  const heavy = attack?.id === "heavy" || attack?.id === "heavy2";
  return heavy
    ? { action: "hitHeavy", animation: "HIT_HEAVY" }
    : { action: "hit", animation: "HIT" };
}

export const COMBAT_TUNING = {
  maxHealth: 100,
  maxStamina: 100,
  staminaRegenPerSecond: 24,
  staminaRegenDelay: 1.05,
  sprintDrainPerSecond: 15,
  rollCost: 32,
  backstepCost: 26,
  parryCost: 18,
  jumpCost: 15,
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

export function isWeaponHitboxActive(elapsed: number, attack: WeaponDefinition["attacks"]["light1"]) {
  return phaseAt(elapsed, attack) === "active";
}

export function isRollInvulnerable(elapsed: number) {
  return elapsed >= COMBAT_TUNING.rollIFrameStart && elapsed <= COMBAT_TUNING.rollIFrameEnd;
}

export function isParryActive(elapsed: number) {
  return elapsed >= COMBAT_TUNING.parryActiveStart && elapsed <= COMBAT_TUNING.parryActiveEnd;
}

export function isBackstabPosition(
  enemyForward: { x: number; z: number },
  enemyToPlayer: { x: number; z: number },
  distance: number,
) {
  if (distance < 0.25 || distance > STRAIGHT_SWORD.attacks.backstab.range) return false;
  const forwardLength = Math.hypot(enemyForward.x, enemyForward.z);
  const playerLength = Math.hypot(enemyToPlayer.x, enemyToPlayer.z);
  if (forwardLength < 0.001 || playerLength < 0.001) return false;
  const facingDot = (enemyForward.x * enemyToPlayer.x + enemyForward.z * enemyToPlayer.z) / (forwardLength * playerLength);
  return facingDot <= -0.6;
}
