import { describe, expect, it } from "vitest";
import {
  CALIBRATED_SOLE_MARKERS,
  JUMP_LAND_SOURCE_DURATION,
  JUMP_LOOP_SOURCE_DURATION,
  JUMP_SOLE_CALIBRATION,
  JUMP_START_FULL_PLAYBACK_DURATION,
  JUMP_START_SOURCE_DURATION,
  calibratedSoleModelY,
  createSoleContactSample,
  hasSoleSupportContact,
  isJumpStartLoopHandoffReady,
  jumpStartLoopSoleDiscontinuity,
  jumpStartSourceTime,
  minimumSoleSupportGap,
  pointSupportPlaneGap,
  soleGroundCorrection,
} from "./footContact";
import { JUMP_START_DURATION, JUMP_START_PLAYBACK_RATE } from "./characterPhysics";

describe("visible sole contact", () => {
  it("starts with an invalid contact sample until the rig publishes markers", () => {
    expect(createSoleContactSample()).toEqual({ valid: false, supportGap: Infinity });
  });

  it("defines heel, toe, and toe-tip markers for both feet", () => {
    expect(CALIBRATED_SOLE_MARKERS.map((marker) => marker.id)).toEqual([
      "left-heel",
      "left-toe",
      "left-toe-tip",
      "right-heel",
      "right-toe",
      "right-toe-tip",
    ]);
    expect(new Set(CALIBRATED_SOLE_MARKERS.map((marker) => marker.boneName))).toEqual(new Set([
      "DEF-footL",
      "DEF-toeL",
      "DEF-footR",
      "DEF-toeR",
    ]));
    for (const marker of CALIBRATED_SOLE_MARKERS) {
      expect(Number.isFinite(marker.localPosition.x)).toBe(true);
      expect(Number.isFinite(marker.localPosition.y)).toBe(true);
      expect(Number.isFinite(marker.localPosition.z)).toBe(true);
    }
  });

  it("projects points onto an arbitrary normalized support axis", () => {
    const support = { x: 1, y: 2, z: 3 };
    const up = { x: 0, y: 2, z: 0 };
    expect(pointSupportPlaneGap({ x: 8, y: 2.035, z: -4 }, support, up)).toBeCloseTo(0.035, 8);
    expect(pointSupportPlaneGap({ x: 0, y: 0, z: 0 }, support, { x: 0, y: 0, z: 0 })).toBe(Infinity);
  });

  it("uses the lowest live world marker for contact and correction", () => {
    const support = { x: 0, y: 1, z: 0 };
    const up = { x: 0, y: 1, z: 0 };
    const markers = [
      { x: -0.1, y: 1.04, z: 0.2 },
      { x: 0.1, y: 0.972, z: -0.1 },
      { x: 0.2, y: 1.08, z: 0 },
    ];
    const gap = minimumSoleSupportGap(markers, support, up);
    expect(gap).toBeCloseTo(-0.028, 8);
    expect(hasSoleSupportContact(gap)).toBe(true);
    expect(soleGroundCorrection(gap)).toBeCloseTo(0.028, 8);
    expect(minimumSoleSupportGap([], support, up)).toBe(Infinity);
    expect(hasSoleSupportContact(Infinity)).toBe(false);
    expect(soleGroundCorrection(Infinity)).toBe(0);
  });
});

describe("AnimationLibrary jump sole calibration", () => {
  it("captures Jump_Loop's changing negative sole offset and wraps cleanly", () => {
    const entry = calibratedSoleModelY("Jump_Loop", 0);
    const deepest = calibratedSoleModelY("Jump_Loop", JUMP_LOOP_SOURCE_DURATION * 0.1);
    const highest = calibratedSoleModelY("Jump_Loop", JUMP_LOOP_SOURCE_DURATION * 0.6);
    expect(entry).toBeCloseTo(-0.134716678, 8);
    expect(deepest).toBeCloseTo(-0.141162887, 8);
    expect(highest).toBeCloseTo(-0.089776106, 8);
    expect(deepest).toBeLessThan(highest - 0.04);
    expect(calibratedSoleModelY("Jump_Loop", JUMP_LOOP_SOURCE_DURATION)).toBeCloseTo(entry, 8);
    expect(calibratedSoleModelY("Jump_Loop", JUMP_LOOP_SOURCE_DURATION * 1.6)).toBeCloseTo(highest, 8);
  });

  it("keeps the complete Jump_Land sole motion within three millimetres of its model plane", () => {
    const samples = JUMP_SOLE_CALIBRATION.Jump_Land.soleY;
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-0.003);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.001);
    expect(calibratedSoleModelY("Jump_Land", -1)).toBeCloseTo(samples[0], 8);
    expect(calibratedSoleModelY("Jump_Land", JUMP_LAND_SOURCE_DURATION * 2)).toBeCloseTo(samples.at(-1)!, 8);
  });

  it("plays all of Jump_Start before handing off to its matching Jump_Loop pose", () => {
    expect(JUMP_START_FULL_PLAYBACK_DURATION).toBeCloseTo(
      JUMP_START_SOURCE_DURATION / JUMP_START_PLAYBACK_RATE,
      7,
    );
    expect(JUMP_START_FULL_PLAYBACK_DURATION).toBeCloseTo(JUMP_START_DURATION, 8);
    expect(jumpStartSourceTime(JUMP_START_FULL_PLAYBACK_DURATION - 0.001)).toBeLessThan(JUMP_START_SOURCE_DURATION);
    expect(isJumpStartLoopHandoffReady(JUMP_START_FULL_PLAYBACK_DURATION - 0.001)).toBe(false);
    expect(isJumpStartLoopHandoffReady(JUMP_START_FULL_PLAYBACK_DURATION)).toBe(true);
    expect(jumpStartSourceTime(JUMP_START_FULL_PLAYBACK_DURATION + 1)).toBe(JUMP_START_SOURCE_DURATION);
    expect(jumpStartLoopSoleDiscontinuity()).toBeLessThan(0.000001);
  });
});
