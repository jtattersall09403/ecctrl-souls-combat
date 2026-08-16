import { describe, expect, it } from "vitest";
import {
  COMBAT_TUNING,
  CRITICAL_ATTACK_DAMAGE,
  CRITICAL_DAMAGE_MULTIPLIER,
  LIGHT_COMBO_CLIP,
  LIGHT_COMBO_PLAYBACK,
  STRAIGHT_SWORD,
  comboEntryTime,
  comboQueueOpen,
  comboSuccessorStartTime,
  comboTransitionTime,
  getComboSuccessor,
  hitReactionForAttack,
  isBackstabPosition,
  isParryActive,
  isRollInvulnerable,
  isWeaponHitboxActive,
  phaseAt,
  sampleLightClipTime,
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

  it("queues during a swing, then starts each complete successor after that swing", () => {
    const { light1, light2, light3 } = STRAIGHT_SWORD.attacks;
    expect(getComboSuccessor(light1, "light")).toBe(light2);
    expect(getComboSuccessor(light2, "light")).toBe(light3);
    expect(getComboSuccessor(light3, "light")).toBeNull();

    const phaseSequence = [
      phaseAt(0, light1),
      phaseAt(light1.windup + 0.01, light1),
      phaseAt(comboEntryTime(light2), light2),
      phaseAt(light2.windup + 0.01, light2),
      phaseAt(comboEntryTime(light3), light3),
      phaseAt(light3.windup + 0.01, light3),
      phaseAt(comboTransitionTime(light3) + 0.01, light3),
    ];
    expect(phaseSequence).toEqual(["windup", "active", "windup", "active", "windup", "active", "recovery"]);
    expect(phaseAt(comboTransitionTime(light1) - 0.001, light1)).toBe("active");
    expect(comboEntryTime(light2)).toBe(0);
    expect(phaseAt(comboEntryTime(light2), light2)).toBe("windup");
  });

  it("keeps the full authored light swing active until recovery begins", () => {
    for (const attack of [
      STRAIGHT_SWORD.attacks.light1,
      STRAIGHT_SWORD.attacks.light2,
      STRAIGHT_SWORD.attacks.light3,
    ]) {
      expect(isWeaponHitboxActive(attack.windup, attack)).toBe(true);
      expect(isWeaponHitboxActive(comboTransitionTime(attack) - 0.001, attack)).toBe(true);
      expect(isWeaponHitboxActive(comboTransitionTime(attack), attack)).toBe(false);
    }
  });

  it("maps each light phase to a complete authored source segment", () => {
    const attacks = STRAIGHT_SWORD.attacks;
    for (const [animation, attack] of [
      ["LIGHT_1", attacks.light1],
      ["LIGHT_2", attacks.light2],
      ["LIGHT_3", attacks.light3],
    ] as const) {
      const source = LIGHT_COMBO_PLAYBACK[animation];
      expect(sampleLightClipTime(animation, 0)).toBeCloseTo(source.sourceOffset);
      expect(sampleLightClipTime(animation, attack.windup)).toBeCloseTo(source.windupEnd);
      expect(sampleLightClipTime(animation, attack.windup + attack.active)).toBeCloseTo(source.activeEnd);
      expect(sampleLightClipTime(animation, attack.windup + attack.active + attack.recovery)).toBeCloseTo(source.recoveryEnd);
      expect(sampleLightClipTime(animation, -1)).toBeCloseTo(source.sourceOffset);
      expect(sampleLightClipTime(animation, 10)).toBeCloseTo(source.recoveryEnd);
    }
  });

  it("joins the first cut to the complete reverse cut at the same source pose", () => {
    expect(LIGHT_COMBO_CLIP).toBe("Sword_Attack");
    expect(LIGHT_COMBO_PLAYBACK.LIGHT_1.activeEnd).toBe(LIGHT_COMBO_PLAYBACK.LIGHT_2.sourceOffset);
  });

  it("accepts queue input only during the current swing and carries frame overshoot", () => {
    const attack = STRAIGHT_SWORD.attacks.light1;
    const transition = comboTransitionTime(attack);
    expect(comboQueueOpen(attack.windup - 0.001, attack.windup - 0.01, attack)).toBe(false);
    expect(comboQueueOpen(attack.windup, attack.windup - 0.01, attack)).toBe(true);
    expect(comboQueueOpen(transition - 0.001, transition - 0.01, attack)).toBe(true);
    expect(comboQueueOpen(transition + 0.002, transition - 0.001, attack)).toBe(true);
    expect(comboQueueOpen(transition + 0.004, transition + 0.002, attack)).toBe(false);
    // A hit-stop-sized combat step grants only the frame that crossed the boundary.
    expect(comboQueueOpen(transition + 0.0008, transition - 0.0008, attack)).toBe(true);
    expect(comboQueueOpen(transition + 0.0016, transition + 0.0008, attack)).toBe(false);
    expect(comboSuccessorStartTime(transition + 0.012, attack)).toBeCloseTo(0.012);
  });

  it("supports the heavy successor and rejects unrelated combo inputs", () => {
    const { light1, heavy, heavy2 } = STRAIGHT_SWORD.attacks;
    expect(getComboSuccessor(heavy, "heavy")).toBe(heavy2);
    expect(comboEntryTime(heavy2)).toBe(0);
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
