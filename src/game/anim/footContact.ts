import {
  JUMP_LAND_SOURCE_DURATION,
  JUMP_START_DURATION,
  JUMP_START_PLAYBACK_RATE,
  JUMP_START_SOURCE_DURATION,
} from "../physics/characterPhysics";

export { JUMP_LAND_SOURCE_DURATION, JUMP_START_SOURCE_DURATION } from "../physics/characterPhysics";

export type Point3Like = Readonly<{ x: number; y: number; z: number }>;

export type SoleContactSample = {
  valid: boolean;
  supportGap: number;
};

export function createSoleContactSample(): SoleContactSample {
  return { valid: false, supportGap: Number.POSITIVE_INFINITY };
}

export type SoleMarkerDefinition = Readonly<{
  id: string;
  boneName: "DEF-footL" | "DEF-toeL" | "DEF-footR" | "DEF-toeR";
  localPosition: Point3Like;
}>;

/**
 * Sole samples from AnimationLibrary.glb's Mannequin_1 mesh, expressed in the
 * owning bone's local space. The centre-toe and toe-tip samples are vertices
 * with 100% weight on their named bone. The heel samples use the dominant foot
 * bone and complete the contact patch when the ankle pitches back.
 *
 * Taking the minimum support-plane projection of all six markers reproduces
 * Jump_Loop's skinned-mesh minimum exactly, Jump_Land within 0.8 mm, and the
 * grounded idle clips exactly. It avoids a full skinned-vertex scan per frame.
 */
export const CALIBRATED_SOLE_MARKERS = [
  {
    id: "left-heel",
    boneName: "DEF-footL",
    localPosition: { x: 0.00010239797, y: 0.030572139884, z: 0.098860460616 },
  },
  {
    id: "left-toe",
    boneName: "DEF-toeL",
    localPosition: { x: -0.006167676488, y: 0.036947797157, z: -0.014738588992 },
  },
  {
    id: "left-toe-tip",
    boneName: "DEF-toeL",
    localPosition: { x: 0.015651008405, y: 0.092244341673, z: -0.008379351277 },
  },
  {
    id: "right-heel",
    boneName: "DEF-footR",
    localPosition: { x: 0.000102401071, y: 0.030572133851, z: 0.098860461926 },
  },
  {
    id: "right-toe",
    boneName: "DEF-toeR",
    localPosition: { x: 0.00616767645, y: 0.036947797157, z: -0.014738588654 },
  },
  {
    id: "right-toe-tip",
    boneName: "DEF-toeR",
    localPosition: { x: -0.015651008962, y: 0.092244341673, z: -0.008379352725 },
  },
] as const satisfies readonly SoleMarkerDefinition[];

export const SOLE_CONTACT_TOLERANCE = 0.002;

/** Signed marker distance from a support plane along its up axis. */
export function pointSupportPlaneGap(
  point: Point3Like,
  supportPoint: Point3Like,
  upAxis: Point3Like,
) {
  const length = Math.hypot(upAxis.x, upAxis.y, upAxis.z);
  if (length <= Number.EPSILON) return Number.POSITIVE_INFINITY;
  return (
    (point.x - supportPoint.x) * upAxis.x
    + (point.y - supportPoint.y) * upAxis.y
    + (point.z - supportPoint.z) * upAxis.z
  ) / length;
}

/**
 * Signed distance between the lowest visible sole marker and a support plane.
 * Call this with marker world positions sampled after animation and pose
 * modifiers have updated the foot/toe bone world matrices.
 */
export function minimumSoleSupportGap(
  markerWorldPositions: readonly Point3Like[],
  supportPoint: Point3Like,
  upAxis: Point3Like,
) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const marker of markerWorldPositions) {
    minimum = Math.min(minimum, pointSupportPlaneGap(marker, supportPoint, upAxis));
  }
  return minimum;
}

export function hasSoleSupportContact(
  supportGap: number,
  tolerance = SOLE_CONTACT_TOLERANCE,
) {
  return Number.isFinite(supportGap)
    && supportGap <= Math.max(0, tolerance) + Number.EPSILON * 8;
}

/** Up-axis visual correction required to put a penetrated sole on support. */
export function soleGroundCorrection(supportGap: number) {
  return Number.isFinite(supportGap) ? Math.max(0, -supportGap) : 0;
}

export type CalibratedJumpClip = "Jump_Start" | "Jump_Loop" | "Jump_Land";

export const JUMP_LOOP_SOURCE_DURATION = 2.5;
/** Wall-clock time needed to reach Jump_Start's pose-matched final frame. */
export const JUMP_START_FULL_PLAYBACK_DURATION = JUMP_START_DURATION;

type SoleCalibration = Readonly<{
  duration: number;
  loop: boolean;
  /** Uniform samples over normalized clip time, including both endpoints. */
  soleY: readonly number[];
}>;

/**
 * Minimum deformed Mannequin_1 vertex Y after removing authored root tracks.
 * Values were sampled from the checked-in AnimationLibrary.glb at 5% source
 * time intervals. Runtime bone markers are preferred; this curve is useful for
 * deterministic state timing, fallback contact estimates, and regression tests.
 */
export const JUMP_SOLE_CALIBRATION: Readonly<Record<CalibratedJumpClip, SoleCalibration>> = {
  Jump_Start: {
    duration: JUMP_START_SOURCE_DURATION,
    loop: false,
    soleY: [
      -0.000148347, -0.015894321, -0.143332884, -0.063978602, 0.255067032,
      0.350168018, 0.348909484, 0.318352892, 0.274446054, 0.222169271,
      0.160932332, 0.097834175, 0.037276094, -0.016035141, -0.057795205,
      -0.088027516, -0.108983677, -0.122516681, -0.13029337, -0.133857885,
      -0.134716678,
    ],
  },
  Jump_Loop: {
    duration: JUMP_LOOP_SOURCE_DURATION,
    loop: true,
    soleY: [
      -0.134716678, -0.138948958, -0.141162887, -0.140774841, -0.137367295,
      -0.131592562, -0.124250919, -0.116094315, -0.10788714, -0.100395971,
      -0.094388996, -0.09060932, -0.089776106, -0.09170707, -0.09570236,
      -0.101270733, -0.107877597, -0.115056429, -0.122260211, -0.128990995,
      -0.134716678,
    ],
  },
  Jump_Land: {
    duration: JUMP_LAND_SOURCE_DURATION,
    loop: false,
    soleY: [
      -0.000821023, -0.002957335, -0.00011135, 0.0005468, 0.0005798,
      0.000478087, 0.000355112, 0.000260206, 0.00025006, 0.000301271,
      0.000441489, 0.000326941, 0.000284677, 0.000406463, 0.000444499,
      0.000438167, 0.000347497, 0.000165399, 0.000024775, -0.000065948,
      -0.000099291,
    ],
  },
};

/** Linearly interpolates the measured visible-sole Y at source clip time. */
export function calibratedSoleModelY(clip: CalibratedJumpClip, sourceTime: number) {
  const calibration = JUMP_SOLE_CALIBRATION[clip];
  const duration = calibration.duration;
  const finiteTime = Number.isFinite(sourceTime) ? sourceTime : 0;
  const normalized = calibration.loop
    ? ((finiteTime % duration) + duration) % duration / duration
    : Math.min(1, Math.max(0, finiteTime / duration));
  const samplePosition = normalized * (calibration.soleY.length - 1);
  const lowerIndex = Math.floor(samplePosition);
  const upperIndex = Math.min(calibration.soleY.length - 1, lowerIndex + 1);
  const alpha = samplePosition - lowerIndex;
  const lower = calibration.soleY[lowerIndex];
  const upper = calibration.soleY[upperIndex];
  return lower + (upper - lower) * alpha;
}

/** Source time reached by Jump_Start after the supplied wall-clock duration. */
export function jumpStartSourceTime(
  elapsed: number,
  playbackRate = JUMP_START_PLAYBACK_RATE,
) {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return 0;
  return Math.min(JUMP_START_SOURCE_DURATION, elapsed * playbackRate);
}

/** True only once the full takeoff clip has reached its loop-matched pose. */
export function isJumpStartLoopHandoffReady(
  elapsed: number,
  playbackRate = JUMP_START_PLAYBACK_RATE,
) {
  return jumpStartSourceTime(elapsed, playbackRate)
    >= JUMP_START_SOURCE_DURATION - Number.EPSILON * 16;
}

/** Absolute sole-height mismatch between the authored handoff poses. */
export function jumpStartLoopSoleDiscontinuity() {
  return Math.abs(
    calibratedSoleModelY("Jump_Start", JUMP_START_SOURCE_DURATION)
    - calibratedSoleModelY("Jump_Loop", 0),
  );
}
