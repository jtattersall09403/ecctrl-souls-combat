import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { animationMixerDelta, type AnimationCommand } from "../game/anim/animationCommand";
import {
  crossFadeSoleClearance,
  nextSupportCorrection,
  nextUpwardGroundCorrection,
  requiredSupportCorrection,
  resolveSupportCorrection,
  sampleSoleMarkerClearance,
  sampleSoleMarkerClearanceById,
  sampleSoleMarkerPointById,
  sampleSupportEnvelope,
  supportModeAt,
  supportModeDuringCrossFade,
  usesCrossFadeSoleProxy,
} from "../game/anim/grounding";
import {
  RIG_GLB,
  HURTBOX_SEGMENTS,
  sanitizeBoneName,
  CHARACTER_SCALE,
  AIRBORNE_IMPACT_PROXIMITY_METERS,
  CROSS_FADE_SOLE_SAFETY_MARGIN_METERS,
  LOCOMOTION_STATES,
  RIG_SOCKETS,
  RIG_SOCKET_ROTATION,
  clipConfig,
  transitionCrossFadeDuration,
} from "../game/anim/animationManifest";
import { CHARACTER_BODY_CENTER_HEIGHT, CHARACTER_MODEL_OFFSET } from "../game/physics/characterPhysics";
import type { AnimationState, WeaponSocketTransform, WeaponVisualProfile } from "../game/core/types";
import { VISUAL_PROBE_BONES, type ActorVisualProbe } from "../game/validation/actorVisualMetrics";
import { VISUAL_FRAME_PHASE_PRIORITY } from "../game/validation/visualFrameMarker";
import { DEFAULT_RACE, RIG_REVISION, raceById, type RaceDefinition, type RaceId } from "../game/actors/races";
import type { ArmourDefinition } from "../game/equipment/armour";
import type { MountedArmour } from "../game/actors/armourMounting";
import { ArmourAttachments } from "./ArmourAttachments";
import type { HurtboxBone, HurtboxRigRef } from "./SkeletalHurtbox";

/**
 * The rig carries the skeleton and every semantic clip; a race GLB carries only
 * that race's skin. They are separate downloads because the animations are
 * identical for every race and would otherwise be duplicated per body.
 *
 * Nothing has to be re-bound to join them: both are built from the same
 * skeleton, so the clips' bone names resolve against whichever race model is
 * mounted, and `useAnimations` binds by name.
 */
const RIG_URL = `${import.meta.env.BASE_URL}${RIG_GLB}?v=${RIG_REVISION}`;

const NO_ARMOUR: readonly ArmourDefinition[] = [];

function raceUrl(race: RaceDefinition) {
  return `${import.meta.env.BASE_URL}${race.asset}?v=${race.revision}`;
}

// Progress (0-1) through EQUIP/UNEQUIP at which the sword switches sockets,
// matching roughly when the drawing/sheathing hand reaches the hip in the
// source clips.
const EQUIP_GRAB_PROGRESS = 0.45;
const UNEQUIP_STOW_PROGRESS = 0.5;

// Sole markers used only for an upward residual penetration guard. They are
// bone origins, not a promise that every authored action keeps a foot planted.
// Names are GLTFLoader's sanitized form of the rig's "NPC Foot [ft ].L" etc.
// bone names (three.js strips spaces/brackets/dots from Object3D names on load).
const SOLE_MARKERS = [
  { id: "footL", boneName: "NPC_Foot_ft_L" },
  { id: "footR", boneName: "NPC_Foot_ft_R" },
  { id: "toeL", boneName: "NPC_Toe0_ToeL" },
  { id: "toeR", boneName: "NPC_Toe0_ToeR" },
] as const;
const TARGET_ANCHOR_BONE_NAME = "NPC_Spine2_Spn2";

/**
 * Small code-native Estus stand-in mounted to the animated weapon hand.
 *
 * The Skyrim potion animation assumes a held object, but the source character
 * GLB deliberately contains no consumable prop. Rendering the bare animation
 * makes the character appear to scratch his head. Keep the prop independent
 * from the character asset so another game can replace its geometry/material
 * without changing the animation or combat controller.
 */
function createHealingFlask() {
  const flask = new THREE.Group();
  flask.name = "HealingFlask";
  flask.visible = false;

  const glass = new THREE.MeshStandardMaterial({
    color: 0xb86a24,
    emissive: 0x6a2408,
    emissiveIntensity: 0.8,
    roughness: 0.34,
    metalness: 0.08,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc8a663,
    roughness: 0.42,
    metalness: 0.65,
  });
  const cork = new THREE.MeshStandardMaterial({
    color: 0x5b351f,
    roughness: 0.95,
  });

  // Geometry is authored in real metres. The mount below counter-scales the
  // imported Skyrim rig so this remains a palm-sized 18 cm flask.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), glass);
  body.scale.set(0.82, 0.82, 1.08);
  body.position.z = 0.082;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.048, 0.05, 12), glass);
  shoulder.rotation.x = Math.PI / 2;
  shoulder.position.z = 0.145;
  const stopper = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.034, 10), cork);
  stopper.rotation.x = Math.PI / 2;
  stopper.position.z = 0.182;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 8, 16), metal);
  collar.position.z = 0.16;

  for (const part of [body, shoulder, stopper, collar]) {
    part.castShadow = true;
    part.receiveShadow = true;
    flask.add(part);
  }
  return flask;
}

/**
 * Skyrim-derived character actor. Loads the pipeline-built GLB whose actions are
 * already named with SEMANTIC game states (IDLE, ROLL, LIGHT_1, ...), plays them
 * from an {@link AnimationCommand}, and mounts the sword on the native rig
 * socket. It carries none of the old mannequin coupling — no DEF-* bone lookups,
 * procedural posing, foot markers, weapon IK or runtime root-motion stripping
 * (root motion is already resolved in the asset pipeline).
 */
export function SkyrimFighter({
  animationCommandRef,
  equipped,
  equippedRef,
  enemy = false,
  weaponRef,
  targetAnchorRef,
  hurtboxRef,
  animationTimeRef,
  speedMultiplierRef,
  weaponProfile,
  armour = NO_ARMOUR,
  raceId = DEFAULT_RACE,
  modelOffsetY = CHARACTER_MODEL_OFFSET,
  validationTint,
  visualProbe,
  visualSupportY = 0,
}: {
  animationCommandRef: MutableRefObject<AnimationCommand>;
  equipped: boolean;
  equippedRef?: MutableRefObject<boolean>;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
  /** Animated upper-body anchor for lock-on UI or other actor-following effects. */
  targetAnchorRef?: MutableRefObject<THREE.Object3D | null>;
  /** Receives this actor's live skeleton-fitted combat capsules. */
  hurtboxRef?: HurtboxRigRef;
  animationTimeRef?: MutableRefObject<number>;
  /** Extra multiplier on top of the manifest playbackRate for self-timed (locomotion) clips. */
  speedMultiplierRef?: MutableRefObject<number>;
  weaponProfile: WeaponVisualProfile;
  /** Worn armour. Each piece is skinned to the shared rig and hides what it covers. */
  armour?: readonly ArmourDefinition[];
  /** Which body to mount on the shared rig. */
  raceId?: RaceId;
  modelOffsetY?: number;
  /** High-contrast actor identity used only by production-path visual scenarios. */
  validationTint?: THREE.ColorRepresentation;
  /** Optional read-only render-pose probe used by production visual validation. */
  visualProbe?: ActorVisualProbe;
  /** Known world-space support plane used by the upward-only penetration guard and validation. */
  visualSupportY?: number;
}) {
  const race = raceById(raceId);
  const rig = useGLTF(RIG_URL);
  const gltf = useGLTF(raceUrl(race));
  const weaponUrl = `${import.meta.env.BASE_URL}${weaponProfile.asset}`;
  const weaponGltf = useGLTF(weaponUrl);
  const model = useMemo(() => {
    const instance = clone(gltf.scene);
    // SkeletonUtils intentionally shares materials. Give each fighter its own
    // instances so the enemy/validation tint cannot leak onto the player.
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    });
    return instance;
  }, [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const sword = useMemo(() => {
    const weapon = clone(weaponGltf.scene);
    weapon.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return weapon;
  }, [weaponGltf.scene]);
  const weaponMount = useMemo(() => new THREE.Group(), []);
  const healingFlask = useMemo(() => createHealingFlask(), []);

  const previousAction = useRef<THREE.AnimationAction | null>(null);
  const fadingFromAction = useRef<THREE.AnimationAction | null>(null);
  const currentState = useRef<AnimationState>(animationCommandRef.current.state);
  const consumedSerial = useRef(-1);
  const elapsed = useRef(0);
  const externalClockOrigin = useRef(0);
  const groundCorrection = useRef(0);
  const soleTmp = useRef(new THREE.Vector3());
  const bodyTmp = useRef(new THREE.Vector3());
  const rootQuaternionTmp = useRef(new THREE.Quaternion());
  const boneWorldQuaternionTmp = useRef(new THREE.Quaternion());
  const boundsTmp = useRef(new THREE.Box3());
  const meshBoundsTmp = useRef(new THREE.Box3());
  const weaponGripTmp = useRef(new THREE.Vector3());
  const socketConvention = useRef(new THREE.Quaternion());
  const itemOffset = useRef(new THREE.Quaternion());
  const weaponTipTmp = useRef(new THREE.Vector3());

  // Clips come from the rig, the skeleton they drive comes from the race body.
  const { actions, mixer } = useAnimations(rig.animations, root);

  // drei's useAnimations normally advances its mixer from raw render-wall
  // delta. Combat and the deterministic visual scenarios deliberately cap
  // their simulation step, so a slow SwiftShader frame could otherwise skip
  // several authored poses while gameplay advanced only 1/30s. Keep drei's
  // automatic callback inert and advance the mixer once, below, from the same
  // capped clock used by this actor.
  useLayoutEffect(() => {
    mixer.timeScale = 0;
    return () => {
      mixer.timeScale = 1;
    };
  }, [mixer]);

  // Every mesh casts/receives shadows regardless of side. This must not be
  // folded into the enemy-tint effect below (that one is enemy-only), or the
  // player silently never gets shadow flags set.
  useLayoutEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [model]);

  // Enemy tint: recolour the skin/underwear so friend and foe read apart. A
  // stronger per-actor tint makes recorded validation roles unambiguous even
  // during dense paired-action or collision overlap.
  useLayoutEffect(() => {
    if (!enemy && validationTint === undefined) return;
    const tint = new THREE.Color(validationTint ?? 0x7a241d);
    const strength = validationTint === undefined ? 0.45 : 0.72;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of mats) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.color) continue;
        standard.color.lerp(tint, strength);
      }
    });
  }, [enemy, model, validationTint]);

  // The two sockets the sword can rigidly mount on: the hand (drawn) and the
  // hip sheath (stowed). Each keeps its own counter-scale + corrective
  // rotation; only one holds the weaponMount at a time (see useFrame below).
  const handSocket = useMemo(
    () => model.getObjectByName(weaponProfile.held.socket) ?? model.getObjectByName(RIG_SOCKETS.weaponFallback) ?? null,
    [model, weaponProfile.held.socket],
  );
  const sheathSocket = useMemo(
    () => model.getObjectByName(weaponProfile.sheathed.socket) ?? null,
    [model, weaponProfile.sheathed.socket],
  );
  const currentSocket = useRef<THREE.Object3D | null>(null);
  const soleBones = useMemo(
    () => SOLE_MARKERS.flatMap(({ id, boneName }) => {
      const bone = model.getObjectByName(boneName);
      return bone ? [{ id, bone }] : [];
    }),
    [model],
  );
  const targetAnchor = useMemo(() => model.getObjectByName(TARGET_ANCHOR_BONE_NAME) ?? null, [model]);
  // Resolve the pipeline-fitted combat capsules onto this instance's bones.
  // Endpoints stay in unscaled bone space; the actor's scale arrives through
  // the bone's own world matrix, exactly as the baked sole markers do.
  const hurtboxBones = useMemo<HurtboxBone[]>(
    () => HURTBOX_SEGMENTS.flatMap((segment) => {
      const bone = model.getObjectByName(sanitizeBoneName(segment.bone));
      return bone
        ? [{
          bone,
          from: new THREE.Vector3().fromArray(segment.from),
          to: new THREE.Vector3().fromArray(segment.to),
          radius: segment.radius,
          halfLength: segment.halfLength,
        }]
        : [];
    }),
    [model],
  );
  const probeBones = useMemo(
    () => Object.entries(VISUAL_PROBE_BONES).map(([id, name]) => [id, model.getObjectByName(name) ?? null] as const),
    [model],
  );
  // Armour arrives after the body (its GLBs suspend separately), so re-collect
  // when it does: this list is what drives the per-frame skeleton refresh and
  // the actor's mesh bounds, and a cuirass left out of it would not deform.
  const [armourRevision, setArmourRevision] = useState(0);
  // Worn footwear stands the actor on its soles instead of its bare feet. The
  // grounding solve aims at sole markers measured on a bare foot, so this is a
  // constant lift on top of it rather than anything the solve has to know about.
  // Worn meshes are excluded from the actor's measured surface. Every support
  // envelope, sole marker and penetration allowance in this file was fitted to
  // the *body*; armour has no envelope of its own and legitimately reaches a
  // few millimetres past bare skin, so folding it into the same measurement
  // would compare a bare-body calibration against a shod silhouette.
  const armourMeshes = useRef<ReadonlySet<THREE.SkinnedMesh>>(new Set());
  const onArmourChange = useCallback((mounted: MountedArmour | null) => {
    armourMeshes.current = new Set(mounted?.meshes ?? []);
    setArmourRevision((n) => n + 1);
  }, []);
  const skinnedMeshes = useMemo(() => {
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    return meshes;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- armourRevision marks a mutation of `model`.
  }, [model, armourRevision]);

  useLayoutEffect(() => {
    if (!visualProbe) return;
    visualProbe.missingBones = probeBones.filter(([, bone]) => !bone).map(([id]) => id);
    return () => {
      visualProbe.current = null;
      visualProbe.missingBones = [];
    };
  }, [probeBones, visualProbe]);

  useLayoutEffect(() => {
    if (!hurtboxRef) return;
    hurtboxRef.current = hurtboxBones;
    return () => {
      if (hurtboxRef.current === hurtboxBones) hurtboxRef.current = null;
    };
  }, [hurtboxBones, hurtboxRef]);

  useLayoutEffect(() => {
    if (targetAnchorRef) targetAnchorRef.current = targetAnchor;
    return () => {
      if (targetAnchorRef?.current === targetAnchor) targetAnchorRef.current = null;
    };
  }, [targetAnchor, targetAnchorRef]);

  const mountOnSocket = (socket: THREE.Object3D, transform: WeaponSocketTransform) => {
    if (currentSocket.current === socket) return;
    currentSocket.current?.remove(weaponMount);
    model.updateWorldMatrix(true, true);
    const worldScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
    weaponMount.scale.setScalar(transform.localScale / worldScale);
    weaponMount.position.fromArray(transform.localPosition);
    socketConvention.current.fromArray(RIG_SOCKET_ROTATION as unknown as number[]).normalize();
    // Rig convention first, then whatever offset the item itself declares. The
    // convention is a property of the skeleton (weapon assets keep their native
    // attach-node axes, the armature stores bones in Blender's), so it is
    // applied once here for every socket and every weapon instead of being
    // baked by hand into each weapon definition.
    weaponMount.quaternion
      .copy(socketConvention.current)
      .multiply(itemOffset.current.fromArray(transform.localRotation).normalize())
      .normalize();
    socket.add(weaponMount);
    currentSocket.current = socket;
  };

  useLayoutEffect(() => {
    sword.position.set(0, 0, 0);
    sword.quaternion.identity();
    weaponMount.add(sword);
    if (weaponRef) weaponRef.current = weaponMount;
    if (handSocket) mountOnSocket(handSocket, weaponProfile.held);
    return () => {
      if (weaponRef?.current === weaponMount) weaponRef.current = null;
      currentSocket.current?.remove(weaponMount);
      currentSocket.current = null;
      weaponMount.remove(sword);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handSocket, sheathSocket, sword, weaponMount, weaponProfile, weaponRef]);

  useLayoutEffect(() => {
    if (!handSocket) return;
    model.updateWorldMatrix(true, true);
    const worldScale = handSocket.getWorldScale(new THREE.Vector3()).x || 1;
    healingFlask.scale.setScalar(1 / worldScale);
    healingFlask.position.fromArray(weaponProfile.held.localPosition);
    healingFlask.quaternion
      .fromArray(RIG_SOCKET_ROTATION as unknown as number[])
      .normalize()
      .multiply(new THREE.Quaternion().fromArray(weaponProfile.held.localRotation).normalize())
      .normalize();
    handSocket.add(healingFlask);
    return () => {
      handSocket.remove(healingFlask);
    };
  }, [handSocket, healingFlask, model, weaponProfile.held.localPosition, weaponProfile.held.localRotation]);

  useFrame((_, delta) => {
    const command = animationCommandRef.current;

    // Consume a new command: cross-fade into the semantic action.
    if (consumedSerial.current !== command.serial) {
      const state = command.state;
      const outgoingState = currentState.current;
      const config = clipConfig(state);
      const action = actions[state];
      currentState.current = state;
      elapsed.current = command.startAt;
      externalClockOrigin.current = animationTimeRef?.current ?? 0;
      if (action) {
        const externallyTimed = Boolean(animationTimeRef) && !LOCOMOTION_STATES.has(state);
        const playbackStartTime = config.playbackStartTime ?? 0;
        action.reset();
        action.enabled = true;
        action.paused = externallyTimed;
        action.timeScale = config.playbackRate * (externallyTimed ? 1 : speedMultiplierRef?.current ?? 1);
        action.clampWhenFinished = !config.looping;
        action.setLoop(config.looping ? THREE.LoopRepeat : THREE.LoopOnce, config.looping ? Infinity : 1);
        action.time = Math.min(
          action.getClip().duration,
          playbackStartTime + command.startAt * config.playbackRate,
        );
        action.paused = externallyTimed;
        if (previousAction.current && previousAction.current !== action) {
          fadingFromAction.current = previousAction.current;
          const outgoingEnd = clipConfig(outgoingState).playbackEndTime;
          if (outgoingEnd != null) {
            // An authored out-point is a real pose boundary, not only a speed
            // hint. Freeze that pose while its weight fades so the rejected
            // tail cannot leak back into the transition.
            previousAction.current.time = Math.min(previousAction.current.time, outgoingEnd);
            previousAction.current.paused = true;
          }
          // Duration warping makes the same incoming pose play at a different
          // speed depending on the outgoing clip (for example RUN made the
          // already-compressed jump launch start ~2.65x faster than SWORD_IDLE).
          // These are pose blends, not synchronized cycle blends, so preserve
          // each action's configured time scale.
          action.crossFadeFrom(
            previousAction.current,
            transitionCrossFadeDuration(state, outgoingState, command.crossFadeDuration),
            false,
          );
        }
        action.play();
        previousAction.current = action;
      }
      consumedSerial.current = command.serial;
    }

    const state = currentState.current;
    const config = clipConfig(state);
    const externallyTimed = Boolean(animationTimeRef) && !LOCOMOTION_STATES.has(state);
    const action = previousAction.current;
    const elapsedBeforeUpdate = elapsed.current;
    const renderMixerDelta = animationMixerDelta(delta);

    if (externallyTimed && action) {
      // Combat owns timing: drive clip time from the gameplay action clock so
      // the visual never runs ahead of the combat state machine.
      elapsed.current = Math.max(0, animationTimeRef!.current - externalClockOrigin.current) + command.startAt;
      const clip = action.getClip();
      action.time = Math.min(
        clip.duration,
        (config.playbackStartTime ?? 0) + elapsed.current * config.playbackRate,
      );
    } else {
      elapsed.current += renderMixerDelta;
      // Locomotion clips are self-timed by the mixer; the speed multiplier can
      // change every frame (e.g. lock-on strafing), unlike at consume-time.
      if (action) action.timeScale = config.playbackRate * (speedMultiplierRef?.current ?? 1);
    }

    const mixerDelta = animationMixerDelta(
      delta,
      externallyTimed ? elapsedBeforeUpdate : null,
      externallyTimed ? elapsed.current : null,
    );

    // Advance blend weights and self-timed clips from their authoritative
    // clock. Externally timed actions are paused, so this updates their fades
    // without moving them away from the combat action clock above.
    mixer.timeScale = 1;
    mixer.update(mixerDelta);
    mixer.timeScale = 0;
    if ((fadingFromAction.current?.getEffectiveWeight() ?? 0) <= 1e-5) fadingFromAction.current = null;
    if (action && config.playbackEndTime != null && action.time > config.playbackEndTime) {
      // Clamp the currently playing action as soon as it reaches its authored
      // out-point. Waiting until the next state consumes a command allowed the
      // rejected tail of JUMP_START to render during low-FPS frames.
      action.time = config.playbackEndTime;
      action.paused = true;
      mixer.timeScale = 1;
      mixer.update(0);
      mixer.timeScale = 0;
    }

    // The sword rides the hand socket while drawn and the hip sheath while
    // stowed. During EQUIP/UNEQUIP it switches partway through the clip, when
    // the animated hand reaches the hip, instead of snapping at the state
    // boundary. Skyrim's potion clip uses the sword hand to drink, so HEAL
    // temporarily sheathes the blade rather than visibly driving it through
    // the actor's head.
    if (handSocket && sheathSocket) {
      const progress = config.sourceDuration ? Math.min(1, elapsed.current / config.sourceDuration) : 1;
      const wantHand = state === "EQUIP"
        ? progress >= EQUIP_GRAB_PROGRESS
        : state === "UNEQUIP"
          ? progress < UNEQUIP_STOW_PROGRESS
          : state !== "HEAL" && (equippedRef?.current ?? equipped);
      mountOnSocket(wantHand ? handSocket : sheathSocket, wantHand ? weaponProfile.held : weaponProfile.sheathed);
    }
    healingFlask.visible = state === "HEAL";

    // Correct actual sole penetration, but never pull the actor down merely
    // because an authored action lifts both feet. The old bidirectional solve
    // treated foot-bone origins as mandatory contacts; during a tuck roll it
    // dragged the entire mesh more than a metre through the arena.
    const parent = root.current?.parent;
    const sourceClipTime = action?.time ?? 0;
    const resolvedSupportMode = supportModeAt(
      config.supportMode ?? "penetration",
      config.supportPhases,
      sourceClipTime,
    );
    let surfaceMinY = config.supportEnvelope
      ? sampleSupportEnvelope(config.supportEnvelope, sourceClipTime)
      : null;
    let soleMarkerClearance = config.supportEnvelope
      ? sampleSoleMarkerClearance(config.supportEnvelope, sourceClipTime)
      : null;
    const soleMarkerClearanceById = Object.fromEntries(
      SOLE_MARKERS.map(({ id }) => [
        id,
        config.supportEnvelope
          ? sampleSoleMarkerClearanceById(config.supportEnvelope, id, sourceClipTime)
          : null,
      ]),
    ) as Record<(typeof SOLE_MARKERS)[number]["id"], number | null>;
    const soleMarkerPointById = Object.fromEntries(
      SOLE_MARKERS.map(({ id }) => [
        id,
        config.supportEnvelope
          ? sampleSoleMarkerPointById(config.supportEnvelope, id, sourceClipTime)
          : null,
      ]),
    ) as Record<(typeof SOLE_MARKERS)[number]["id"], [number, number, number] | null>;
    const outgoingSoleMarkerPointById = Object.fromEntries(
      SOLE_MARKERS.map(({ id }) => [id, null]),
    ) as Record<(typeof SOLE_MARKERS)[number]["id"], [number, number, number] | null>;
    // A cross-faded skeleton is a new pose: sampling only the incoming clip's
    // support curve misses the outgoing root/leg contribution. Blend both
    // baked endpoint estimates, then use the actual blended sole markers below
    // to catch nonlinear foot arcs introduced by quaternion-chain blending.
    const outgoingAction = fadingFromAction.current;
    const incomingWeight = Math.max(0, action?.getEffectiveWeight() ?? 0);
    const outgoingWeight = Math.max(0, outgoingAction?.getEffectiveWeight() ?? 0);
    let outgoingSupportMode: ReturnType<typeof supportModeAt> | null = null;
    if (outgoingAction) {
      const outgoingConfig = clipConfig(outgoingAction.getClip().name as AnimationState);
      outgoingSupportMode = supportModeAt(
        outgoingConfig.supportMode ?? "penetration",
        outgoingConfig.supportPhases,
        outgoingAction.time,
      );
    }
    const activeSupportMode = supportModeDuringCrossFade(
      resolvedSupportMode,
      outgoingSupportMode,
      incomingWeight,
      outgoingWeight,
    );
    let probedSupportMode = activeSupportMode;
    let probedUncorrectedSurfaceY: number | null = null;
    let probedRequiredGroundCorrectionY: number | null = null;
    if (activeSupportMode !== "airborne" && action && outgoingAction) {
      const outgoingConfig = clipConfig(outgoingAction.getClip().name as AnimationState);
      const outgoingEnvelope = outgoingConfig.supportEnvelope;
      const outgoingSurface = outgoingEnvelope
        ? sampleSupportEnvelope(outgoingEnvelope, outgoingAction.time)
        : null;
      const outgoingClearance = outgoingEnvelope
        ? sampleSoleMarkerClearance(outgoingEnvelope, outgoingAction.time)
        : null;
      const totalWeight = incomingWeight + outgoingWeight;
      if (surfaceMinY != null && outgoingSurface != null && totalWeight > 1e-6) {
        surfaceMinY = (
          surfaceMinY * incomingWeight + outgoingSurface * outgoingWeight
        ) / totalWeight;
      }
      if (soleMarkerClearance != null && outgoingClearance != null && totalWeight > 1e-6) {
        soleMarkerClearance = (
          soleMarkerClearance * incomingWeight + outgoingClearance * outgoingWeight
        ) / totalWeight;
      }
      for (const { id } of SOLE_MARKERS) {
        const incomingMarkerClearance = soleMarkerClearanceById[id];
        const outgoingMarkerClearance = outgoingEnvelope
          ? sampleSoleMarkerClearanceById(outgoingEnvelope, id, outgoingAction.time)
          : null;
        if (incomingMarkerClearance != null && outgoingMarkerClearance != null && totalWeight > 1e-6) {
          soleMarkerClearanceById[id] = (
            incomingMarkerClearance * incomingWeight
            + outgoingMarkerClearance * outgoingWeight
          ) / totalWeight;
        }
        const outgoingPoint = outgoingEnvelope
          ? sampleSoleMarkerPointById(outgoingEnvelope, id, outgoingAction.time)
          : null;
        outgoingSoleMarkerPointById[id] = outgoingPoint;
      }
    }
    const hasIdentityPreservingMarkers = Object.values(soleMarkerClearanceById)
      .every((clearance) => clearance != null);
    const useSoleProxy = usesCrossFadeSoleProxy(
      resolvedSupportMode,
      outgoingSupportMode,
      incomingWeight,
      outgoingWeight,
    );
    // Older manifests only have min(marker), which loses marker identity in a
    // blend. Retain their conservative calibrated fallback. Production assets
    // use the four identity-preserving curves, so no blind 25mm lift is added.
    if (useSoleProxy && !hasIdentityPreservingMarkers) {
      soleMarkerClearance = crossFadeSoleClearance(
        soleMarkerClearance,
        CROSS_FADE_SOLE_SAFETY_MARGIN_METERS,
        resolvedSupportMode,
        outgoingSupportMode,
        incomingWeight,
        outgoingWeight,
      );
    }
    if (root.current && surfaceMinY != null) {
      root.current.getWorldPosition(bodyTmp.current);
      const baseRootWorldY = bodyTmp.current.y - groundCorrection.current;
      const actorBaseY = parent
        ? parent.getWorldPosition(soleTmp.current).y - CHARACTER_BODY_CENTER_HEIGHT
        : Number.POSITIVE_INFINITY;
      probedUncorrectedSurfaceY = baseRootWorldY + surfaceMinY;
      const supportTarget = resolveSupportCorrection(
        activeSupportMode,
        visualSupportY,
        actorBaseY,
        baseRootWorldY + surfaceMinY,
        AIRBORNE_IMPACT_PROXIMITY_METERS,
      );
      let required = supportTarget.correction;
      const supportSolveMode = supportTarget.mode;
      probedSupportMode = supportSolveMode;
      if (useSoleProxy && soleBones.length > 0) {
        for (const { id, bone } of soleBones) {
          const markerPoint = soleMarkerPointById[id];
          let uncorrectedMarkerSurfaceY: number;
          if (markerPoint) {
            soleTmp.current.fromArray(markerPoint);
            bone.localToWorld(soleTmp.current);
            uncorrectedMarkerSurfaceY = soleTmp.current.y - groundCorrection.current;
            const outgoingMarkerPoint = outgoingSoleMarkerPointById[id];
            if (outgoingMarkerPoint) {
              // The lowest vertex can change between clips. Interpolating two
              // unrelated heel points invents a third point inside the shoe;
              // instead transform both endpoint candidates through the actual
              // blended bone and retain whichever visible point is lower.
              soleTmp.current.fromArray(outgoingMarkerPoint);
              bone.localToWorld(soleTmp.current);
              uncorrectedMarkerSurfaceY = Math.min(
                uncorrectedMarkerSurfaceY,
                soleTmp.current.y - groundCorrection.current,
              );
            }
          } else {
            bone.getWorldPosition(soleTmp.current);
            const markerClearance = soleMarkerClearanceById[id] ?? soleMarkerClearance ?? 0;
            uncorrectedMarkerSurfaceY = soleTmp.current.y
              - groundCorrection.current
              - markerClearance;
          }
          required = Math.max(required, requiredSupportCorrection(
            activeSupportMode,
            visualSupportY,
            uncorrectedMarkerSurfaceY,
          ));
        }
      }
      probedRequiredGroundCorrectionY = required;
      groundCorrection.current = nextSupportCorrection(
        groundCorrection.current,
        required,
        supportSolveMode,
        mixerDelta,
      );
      root.current.position.y = modelOffsetY + groundCorrection.current;
    } else if (parent && soleBones.length > 0) {
      let soleY = Infinity;
      for (const { bone } of soleBones) {
        bone.getWorldPosition(soleTmp.current);
        if (soleTmp.current.y < soleY) soleY = soleTmp.current.y;
      }
      groundCorrection.current = nextUpwardGroundCorrection(
        groundCorrection.current,
        visualSupportY,
        soleY,
        mixerDelta,
      );
      if (root.current) root.current.position.y = modelOffsetY + groundCorrection.current;
    }

    // Validation samples the final deformed production actor, rather than a
    // duplicate viewer or the intended animation state. The full skinned-mesh
    // bound is intentionally validation-only: it is exact enough to catch a
    // tucked roll or foot actually passing through the arena, but too costly
    // to make part of ordinary gameplay.
    if (visualProbe && root.current) {
      root.current.updateWorldMatrix(true, true);
      root.current.getWorldPosition(bodyTmp.current);
      const rootWorldY = bodyTmp.current.y;
      root.current.getWorldQuaternion(rootQuaternionTmp.current);
      const actorBaseY = parent
        ? (parent.getWorldPosition(bodyTmp.current).y - CHARACTER_BODY_CENTER_HEIGHT)
        : 0;
      const groundY = visualSupportY;
      let soleY = Infinity;
      for (const { bone } of soleBones) {
        bone.getWorldPosition(soleTmp.current);
        soleY = Math.min(soleY, soleTmp.current.y);
      }
      boundsTmp.current.makeEmpty();
      const meshBounds: NonNullable<ActorVisualProbe["current"]>["meshBounds"] = {};
      for (const mesh of skinnedMeshes) {
        // computeBoundingBox() skins vertices from skeleton.boneMatrices.
        // Attached skinned meshes also refresh bindMatrixInverse only through
        // their updateMatrixWorld() override. Calling only updateWorldMatrix()
        // above left that inverse one render behind a moving Ecctrl parent,
        // producing phantom surface penetration in validation even though the
        // renderer used the current transform later in the same frame.
        mesh.updateMatrixWorld(true);
        mesh.skeleton.update();
        mesh.computeBoundingBox();
        if (!mesh.boundingBox) continue;
        meshBoundsTmp.current.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
        if (!armourMeshes.current.has(mesh)) boundsTmp.current.union(meshBoundsTmp.current);
        meshBounds[mesh.name || mesh.uuid] = {
          min: meshBoundsTmp.current.min.toArray(),
          max: meshBoundsTmp.current.max.toArray(),
        };
      }
      const bones: NonNullable<ActorVisualProbe["current"]>["bones"] = {};
      for (const [id, bone] of probeBones) {
        if (!bone) continue;
        bone.getWorldPosition(soleTmp.current);
        const worldQuaternion = id === "pelvis"
          ? bone.getWorldQuaternion(boneWorldQuaternionTmp.current).toArray()
          : undefined;
        bones[id] = {
          position: soleTmp.current.toArray(),
          quaternion: bone.quaternion.toArray(),
          ...(worldQuaternion ? { worldQuaternion } : {}),
        };
      }
      weaponMount.getWorldPosition(weaponGripTmp.current);
      weaponTipTmp.current.set(0, 0, 0.92).applyMatrix4(weaponMount.matrixWorld);
      visualProbe.current = {
        animation: state,
        commandSerial: command.serial,
        clip: action?.getClip().name ?? null,
        clipTime: action?.time ?? 0,
        actionWeight: action?.getEffectiveWeight() ?? 0,
        outgoingClip: fadingFromAction.current?.getClip().name ?? null,
        outgoingActionWeight: fadingFromAction.current?.getEffectiveWeight() ?? 0,
        rootOffsetY: root.current.position.y,
        rootWorldY,
        rootWorldQuaternion: rootQuaternionTmp.current.toArray(),
        groundCorrectionY: groundCorrection.current,
        uncorrectedSurfaceY: probedUncorrectedSurfaceY,
        requiredGroundCorrectionY: probedRequiredGroundCorrectionY,
        supportMode: probedSupportMode,
        blendedSupportProxy: useSoleProxy && soleBones.length > 0,
        actorBaseY,
        groundY,
        soleGap: Number.isFinite(soleY) ? soleY - groundY : null,
        meshGap: boundsTmp.current.isEmpty() ? null : boundsTmp.current.min.y - groundY,
        meshTop: boundsTmp.current.isEmpty() ? null : boundsTmp.current.max.y - groundY,
        meshBounds,
        bones,
        weaponGrip: handSocket ? weaponGripTmp.current.toArray() : null,
        weaponTip: handSocket ? weaponTipTmp.current.toArray() : null,
      };
    }
  }, visualProbe ? VISUAL_FRAME_PHASE_PRIORITY.actorPoseAndProbe : 0);

  return (
    <group ref={root} position={[0, modelOffsetY, 0]} scale={CHARACTER_SCALE} dispose={null}>
      <primitive object={model} />
      {armour.length > 0 && (
        <Suspense fallback={null}>
          <ArmourAttachments
            model={model}
            armour={armour}
            bodyMeshSlots={race.meshBipedSlots}
            onMountedChange={onArmourChange}
          />
        </Suspense>
      )}
    </group>
  );
}

useGLTF.preload(RIG_URL);
