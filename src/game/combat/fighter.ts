import type { AttackDefinition, CombatAction } from "../core/types";
import { COMBAT_TUNING } from "./weapon";
import {
  ENEMY_ESTUS,
  ENEMY_MAX_HEALTH,
  PLAYER_ESTUS,
  PLAYER_MAX_HEALTH,
} from "./tuning";

// The enemy state machine owns a few locomotion/decision states the player
// never enters. Both actors otherwise share the CombatAction vocabulary.
export type EnemyMode =
  | "watching"
  | "approach"
  | "strafe"
  | "attack"
  | "recover"
  | "guard"
  | "parry"
  | "dodge"
  | "backstep"
  | "heal"
  | "stagger"
  | "recoil"
  | "parried"
  | "critical"
  | "criticalFall"
  | "criticalGetUp"
  | "dead";

export type FighterState = CombatAction | EnemyMode;

export type Team = "player" | "enemy";

/** All mutable combat state for one actor. Replaces the scattered per-actor refs. */
export type Fighter = {
  id: string;
  team: Team;
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
  staminaCooldown: number;
  estus: number;
  equipped: boolean;

  state: FighterState;
  actionTime: number;
  attack: AttackDefinition | null;
  attackHit: boolean;
  healed: boolean;

  comboQueued: "light" | "heavy" | null;
  comboRemaining: number;

  yaw: number;
  attackDirection: { x: number; y: number; z: number };
  dodgeDirection: { x: number; y: number; z: number };

  decisionTimer: number;
  strafeSide: number;
  staggerDuration: number;

  criticalType: "riposte" | "backstab" | null;
  criticalVictimYaw: number;

  // Stable per-instance bias so identically-positioned enemies (e.g. the two
  // mirrored side spawns) don't score every intent identically and act like
  // clones. Persists across resetFighter; only real per-encounter randomness
  // (decisionTimer spread below) resets.
  personality: number;
};

export function createFighter(id: string, team: Team): Fighter {
  const player = team === "player";
  return {
    id,
    team,
    maxHealth: player ? PLAYER_MAX_HEALTH : ENEMY_MAX_HEALTH,
    health: player ? PLAYER_MAX_HEALTH : ENEMY_MAX_HEALTH,
    maxStamina: COMBAT_TUNING.maxStamina,
    stamina: COMBAT_TUNING.maxStamina,
    staminaCooldown: 0,
    estus: player ? PLAYER_ESTUS : ENEMY_ESTUS,
    equipped: true,
    state: player ? "idle" : "watching",
    actionTime: 0,
    attack: null,
    attackHit: false,
    healed: false,
    comboQueued: null,
    comboRemaining: 0,
    yaw: 0,
    attackDirection: { x: 0, y: 0, z: 1 },
    dodgeDirection: { x: 0, y: 0, z: -1 },
    decisionTimer: 0.4 + Math.random() * 0.6,
    strafeSide: 1,
    staggerDuration: 0.58,
    criticalType: null,
    criticalVictimYaw: 0,
    personality: Math.random(),
  };
}

/** Restores a fighter to full readiness without reallocating the object. */
export function resetFighter(fighter: Fighter) {
  fighter.health = fighter.maxHealth;
  fighter.stamina = fighter.maxStamina;
  fighter.staminaCooldown = 0;
  fighter.estus = fighter.team === "player" ? PLAYER_ESTUS : ENEMY_ESTUS;
  fighter.equipped = true;
  fighter.state = fighter.team === "player" ? "idle" : "watching";
  fighter.actionTime = 0;
  fighter.attack = null;
  fighter.attackHit = false;
  fighter.healed = false;
  fighter.comboQueued = null;
  fighter.comboRemaining = 0;
  fighter.yaw = 0;
  fighter.attackDirection = { x: 0, y: 0, z: 1 };
  fighter.dodgeDirection = { x: 0, y: 0, z: -1 };
  fighter.decisionTimer = 0.4 + Math.random() * 0.6;
  fighter.strafeSide = 1;
  fighter.staggerDuration = 0.58;
  fighter.criticalType = null;
  fighter.criticalVictimYaw = 0;
}

export function isAlive(fighter: Fighter) {
  return fighter.health > 0;
}

/** Spends stamina and arms the regen delay. Returns false when insufficient. */
export function spendStamina(fighter: Fighter, amount: number): boolean {
  if (fighter.stamina < amount) return false;
  fighter.stamina -= amount;
  fighter.staminaCooldown = COMBAT_TUNING.staminaRegenDelay;
  return true;
}

export function regenStamina(fighter: Fighter, delta: number) {
  if (fighter.staminaCooldown > 0) return;
  fighter.stamina = Math.min(
    fighter.maxStamina,
    fighter.stamina + COMBAT_TUNING.staminaRegenPerSecond * delta,
  );
}
