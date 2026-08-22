import type { Absorption, DamageType, GuardProfile, Loadout } from "./types";

/**
 * Stability bands, documented so a new item is statted against a scale rather
 * than against whichever item happened to be implemented first.
 *
 * Stability is the fraction of an incoming hit's stamina load a guard soaks.
 * A weapon guards with its edge and a braced forearm; a shield guards with a
 * face designed for it, so shields sit strictly above the weapon band. Nothing
 * reaches 1: a perfect guard would make blocking free.
 */
export const WEAPON_STABILITY_BAND = { min: 0.3, max: 0.62 } as const;
export const SHIELD_STABILITY_BAND = { min: 0.64, max: 0.9 } as const;

/** Multiplier from an attack's damage to the stamina it loads onto a guard. */
export const GUARD_STAMINA_LOAD = 1.25;

/** Fraction of `type` damage this guard absorbs. Unlisted types absorb none. */
export function absorbedFraction(absorption: Absorption, type: DamageType) {
  return absorption[type] ?? 0;
}

/**
 * The guard an actor is actually holding. A shield in the off hand always
 * wins: it is the thing physically between the actor and the blow.
 */
export function activeGuardProfile(loadout: Loadout): GuardProfile {
  return loadout.offHand?.stats.guard ?? loadout.mainHand.stats.guard;
}

/** Stamina an incoming hit costs the defender, given the guard's stability. */
export function guardStaminaCost(incomingDamage: number, guard: GuardProfile) {
  return incomingDamage * GUARD_STAMINA_LOAD * (1 - guard.stability);
}
