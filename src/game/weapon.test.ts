import { describe, expect, it } from "vitest";
import { COMBAT_TUNING, STRAIGHT_SWORD, isBackstabPosition, isParryActive, isRollInvulnerable, phaseAt } from "./weapon";

describe("straight sword moveset", () => {
  it("advances through deterministic attack phases", () => {
    const attack = STRAIGHT_SWORD.attacks.light1;
    expect(phaseAt(0.1, attack)).toBe("windup");
    expect(phaseAt(attack.windup + 0.01, attack)).toBe("active");
    expect(phaseAt(attack.windup + attack.active + 0.01, attack)).toBe("recovery");
    expect(phaseAt(10, attack)).toBe("none");
  });

  it("has finite roll and parry windows", () => {
    expect(isRollInvulnerable(COMBAT_TUNING.rollIFrameStart)).toBe(true);
    expect(isRollInvulnerable(COMBAT_TUNING.rollIFrameEnd + 0.01)).toBe(false);
    expect(isParryActive(COMBAT_TUNING.parryActiveStart + 0.01)).toBe(true);
    expect(isParryActive(COMBAT_TUNING.parryActiveEnd + 0.01)).toBe(false);
  });

  it("keeps heavier attacks slower, stronger, and more expensive", () => {
    const { light1, heavy } = STRAIGHT_SWORD.attacks;
    expect(heavy.damage).toBeGreaterThan(light1.damage);
    expect(heavy.stamina).toBeGreaterThan(light1.stamina);
    expect(heavy.windup).toBeGreaterThan(light1.windup);
  });

  it("defines complete stamina-limited light and heavy chains", () => {
    const { light1, light2, light3, heavy, heavy2 } = STRAIGHT_SWORD.attacks;
    expect([light1.animation, light2.animation, light3.animation]).toEqual(["LIGHT_1", "LIGHT_2", "LIGHT_3"]);
    expect([heavy.animation, heavy2.animation]).toEqual(["HEAVY", "HEAVY_2"]);
    expect(light1.stamina + light2.stamina + light3.stamina).toBe(72);
    expect(light1.stamina + light2.stamina + light3.stamina).toBeLessThanOrEqual(COMBAT_TUNING.maxStamina);
    expect(heavy.stamina + heavy2.stamina).toBe(93);
  });

  it("recognises a close rear approach and rejects front or distant attacks", () => {
    const facingNorth = { x: 0, z: 1 };
    expect(isBackstabPosition(facingNorth, { x: 0.1, z: -1 }, 1.2)).toBe(true);
    expect(isBackstabPosition(facingNorth, { x: 0, z: 1 }, 1.2)).toBe(false);
    expect(isBackstabPosition(facingNorth, { x: 0, z: -1 }, 2.2)).toBe(false);
  });
});
