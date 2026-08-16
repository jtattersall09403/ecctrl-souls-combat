import { describe, expect, it } from "vitest";
import {
  COMBAT_TUNING,
  CRITICAL_ATTACK_DAMAGE,
  CRITICAL_DAMAGE_MULTIPLIER,
  STRAIGHT_SWORD,
  comboEntryTime,
  comboTransitionTime,
  getComboSuccessor,
  hitReactionForAttack,
  isBackstabPosition,
  isParryActive,
  isRollInvulnerable,
  isWeaponHitboxActive,
  phaseAt,
} from "./weapon";

describe("straight sword moveset", () => {
  it("advances through deterministic attack phases", () => {
    const attack = STRAIGHT_SWORD.attacks.light1;
    expect(phaseAt(0.1, attack)).toBe("windup");
    expect(phaseAt(attack.windup + 0.01, attack)).toBe("active");
    expect(phaseAt(attack.windup + attack.active + 0.01, attack)).toBe("recovery");
    expect(phaseAt(10, attack)).toBe("none");
  });

  it("moves heavy swing frames into the active window and ends before recovery", () => {
    const { heavy, light1 } = STRAIGHT_SWORD.attacks;
    expect(isWeaponHitboxActive(heavy.windup + 0.01, heavy)).toBe(true);
    expect(isWeaponHitboxActive(heavy.windup + heavy.active + 0.01, heavy)).toBe(false);
    expect(isWeaponHitboxActive(light1.windup + light1.active + 0.01, light1)).toBe(false);
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

  it("branches directly from each active swing into the next chained swing", () => {
    const { light1, light2, light3 } = STRAIGHT_SWORD.attacks;
    expect(getComboSuccessor(light1, "light")).toBe(light2);
    expect(getComboSuccessor(light2, "light")).toBe(light3);
    expect(getComboSuccessor(light3, "light")).toBeNull();

    const phaseSequence = [
      phaseAt(0, light1),
      phaseAt(light1.windup + 0.01, light1),
      phaseAt(comboEntryTime(light2), light2),
      phaseAt(comboEntryTime(light3), light3),
      phaseAt(comboTransitionTime(light3) + 0.01, light3),
    ];
    expect(phaseSequence).toEqual(["windup", "active", "active", "active", "recovery"]);
    expect(phaseAt(comboTransitionTime(light1) - 0.001, light1)).toBe("active");
    expect(phaseAt(comboEntryTime(light2), light2)).toBe("active");
  });

  it("supports the heavy successor and rejects unrelated combo inputs", () => {
    const { light1, heavy, heavy2 } = STRAIGHT_SWORD.attacks;
    expect(getComboSuccessor(heavy, "heavy")).toBe(heavy2);
    expect(getComboSuccessor(light1, "heavy")).toBeNull();
    expect(getComboSuccessor(heavy, "light")).toBeNull();
    expect(getComboSuccessor(heavy2, "heavy")).toBeNull();
  });

  it("sets backstab and riposte to exactly twice the opening light damage", () => {
    const { light1, backstab, riposte } = STRAIGHT_SWORD.attacks;
    expect(CRITICAL_DAMAGE_MULTIPLIER).toBe(2);
    expect(CRITICAL_ATTACK_DAMAGE).toBe(light1.damage * CRITICAL_DAMAGE_MULTIPLIER);
    expect(backstab.damage).toBe(light1.damage * 2);
    expect(riposte.damage).toBe(light1.damage * 2);
  });

  it("maps both heavy attacks to Hit_Head's dedicated reaction state", () => {
    const { light1, heavy, heavy2 } = STRAIGHT_SWORD.attacks;
    expect(hitReactionForAttack(light1)).toEqual({ action: "hit", animation: "HIT" });
    expect(hitReactionForAttack(heavy)).toEqual({ action: "hitHeavy", animation: "HIT_HEAVY" });
    expect(hitReactionForAttack(heavy2)).toEqual({ action: "hitHeavy", animation: "HIT_HEAVY" });
  });

  it("recognises a close rear approach and rejects front or distant attacks", () => {
    const facingNorth = { x: 0, z: 1 };
    expect(isBackstabPosition(facingNorth, { x: 0.1, z: -1 }, 1.2)).toBe(true);
    expect(isBackstabPosition(facingNorth, { x: 0, z: 1 }, 1.2)).toBe(false);
    expect(isBackstabPosition(facingNorth, { x: 0, z: -1 }, 2.2)).toBe(false);
  });
});
