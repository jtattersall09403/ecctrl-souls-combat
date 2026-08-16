import { describe, expect, it } from "vitest";
import { COMBAT_TUNING, STRAIGHT_SWORD, isParryActive, isRollInvulnerable, phaseAt } from "./weapon";

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
});
