export const BLOCK_RECOIL_DURATION = 0.42;
export const BLOCK_RECOIL_SPEED = 1.25;
export const BLOCK_HIT_STOP = 0.04;

export type PlanarPoint = Readonly<{ x: number; z: number }>;

export type GuardImpactInput = Readonly<{
  health: number;
  stamina: number;
  incomingDamage: number;
  stability: number;
  damageReduction: number;
  guardBreakDamage?: number;
}>;

export function resolveGuardImpact({
  health,
  stamina,
  incomingDamage,
  stability,
  damageReduction,
  guardBreakDamage = 0,
}: GuardImpactInput) {
  const staminaDamage = incomingDamage * 1.25 * (1 - stability);
  const blocked = stamina >= staminaDamage;
  const damage = blocked ? Math.ceil(incomingDamage * (1 - damageReduction)) : guardBreakDamage;
  return {
    blocked,
    health: Math.max(0, health - damage),
    stamina: blocked ? stamina - staminaDamage : 0,
    staminaDamage,
    damage,
    recoilAttacker: blocked,
    triggerDamageVignette: !blocked,
  } as const;
}

/** Authored recoil for sensor-only weapon clashes, directed away from the defender. */
export function blockRecoilVelocity(
  attacker: PlanarPoint,
  defender: PlanarPoint,
  verticalVelocity: number,
  speed = BLOCK_RECOIL_SPEED,
) {
  let x = attacker.x - defender.x;
  let z = attacker.z - defender.z;
  const length = Math.hypot(x, z);
  if (length <= Number.EPSILON) {
    x = 0;
    z = 1;
  } else {
    x /= length;
    z /= length;
  }
  return { x: x * speed, y: verticalVelocity, z: z * speed };
}
