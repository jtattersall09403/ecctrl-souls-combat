import { describe, expect, it } from "vitest";
import { BLOCK_HIT_STOP, BLOCK_RECOIL_DURATION, BLOCK_RECOIL_SPEED, blockRecoilVelocity, resolveGuardImpact } from "./blockReaction";

describe("blocked-attack recoil", () => {
  it("moves the attacker away from the defender while preserving vertical speed", () => {
    const velocity = blockRecoilVelocity({ x: 2, z: 1 }, { x: 1, z: 1 }, -0.7);
    expect(velocity).toEqual({ x: BLOCK_RECOIL_SPEED, y: -0.7, z: 0 });
  });

  it("normalizes diagonal separation and has a stable coincident fallback", () => {
    const diagonal = blockRecoilVelocity({ x: 2, z: 2 }, { x: 0, z: 0 }, 0);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(BLOCK_RECOIL_SPEED, 8);
    expect(blockRecoilVelocity({ x: 0, z: 0 }, { x: 0, z: 0 }, 1)).toEqual({ x: 0, y: 1, z: BLOCK_RECOIL_SPEED });
  });

  it("uses a short readable recovery and contact stop", () => {
    expect(BLOCK_RECOIL_DURATION).toBeGreaterThan(0.3);
    expect(BLOCK_RECOIL_DURATION).toBeLessThan(0.5);
    expect(BLOCK_HIT_STOP).toBeGreaterThan(0);
    expect(BLOCK_HIT_STOP).toBeLessThan(BLOCK_RECOIL_DURATION);
  });

  it("marks a successful block for recoil without a wound vignette", () => {
    const impact = resolveGuardImpact({
      health: 100,
      stamina: 100,
      incomingDamage: 24,
      stability: 0.55,
      damageReduction: 0.72,
    });
    expect(impact.blocked).toBe(true);
    expect(impact.recoilAttacker).toBe(true);
    expect(impact.triggerDamageVignette).toBe(false);
    expect(impact.health).toBe(93);
  });

  it("preserves lethal chip damage and distinguishes guard break feedback", () => {
    const lethalChip = resolveGuardImpact({
      health: 4,
      stamina: 100,
      incomingDamage: 24,
      stability: 0.55,
      damageReduction: 0.72,
    });
    expect(lethalChip.blocked).toBe(true);
    expect(lethalChip.health).toBe(0);

    const guardBreak = resolveGuardImpact({
      health: 100,
      stamina: 0,
      incomingDamage: 24,
      stability: 0.55,
      damageReduction: 0.72,
      guardBreakDamage: 18,
    });
    expect(guardBreak.blocked).toBe(false);
    expect(guardBreak.recoilAttacker).toBe(false);
    expect(guardBreak.triggerDamageVignette).toBe(true);
    expect(guardBreak.health).toBe(82);
  });
});
