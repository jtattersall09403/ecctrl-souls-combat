import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AnimationCommand } from "../game/anim/animationCommand";
import {
  CHARACTER_GLB,
  CHARACTER_SCALE,
  LOCOMOTION_STATES,
  RIG_SOCKETS,
  clipConfig,
} from "../game/anim/animationManifest";
import { CHARACTER_BODY_CENTER_HEIGHT, CHARACTER_MODEL_OFFSET } from "../game/physics/characterPhysics";
import type { AnimationState, WeaponSocketTransform, WeaponVisualProfile } from "../game/core/types";

const GLB_URL = `${import.meta.env.BASE_URL}${CHARACTER_GLB}`;

// Progress (0-1) through EQUIP/UNEQUIP at which the sword switches sockets,
// matching roughly when the drawing/sheathing hand reaches the hip in the
// source clips.
const EQUIP_GRAB_PROGRESS = 0.45;
const UNEQUIP_STOW_PROGRESS = 0.5;

// Sole markers used to keep the character's feet on the ground regardless of
// which clip is posing them (see docs/architecture/character-actor.md). Names
// are GLTFLoader's sanitized form of the rig's "NPC Foot [ft ].L" etc. bone
// names (three.js strips spaces/brackets/dots from Object3D names on load).
const SOLE_BONE_NAMES = ["NPC_Foot_ft_L", "NPC_Foot_ft_R", "NPC_Toe0_ToeL", "NPC_Toe0_ToeR"] as const;

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
  animationTimeRef,
  speedMultiplierRef,
  weaponProfile,
  modelOffsetY = CHARACTER_MODEL_OFFSET,
}: {
  animationCommandRef: MutableRefObject<AnimationCommand>;
  equipped: boolean;
  equippedRef?: MutableRefObject<boolean>;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
  animationTimeRef?: MutableRefObject<number>;
  /** Extra multiplier on top of the manifest playbackRate for self-timed (locomotion) clips. */
  speedMultiplierRef?: MutableRefObject<number>;
  weaponProfile: WeaponVisualProfile;
  modelOffsetY?: number;
}) {
  const gltf = useGLTF(GLB_URL);
  const weaponUrl = `${import.meta.env.BASE_URL}${weaponProfile.asset}`;
  const weaponGltf = useGLTF(weaponUrl);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
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

  const previousAction = useRef<THREE.AnimationAction | null>(null);
  const currentState = useRef<AnimationState>(animationCommandRef.current.state);
  const consumedSerial = useRef(-1);
  const elapsed = useRef(0);
  const externalClockOrigin = useRef(0);
  const groundCorrection = useRef(0);
  const soleTmp = useRef(new THREE.Vector3());
  const bodyTmp = useRef(new THREE.Vector3());

  const { actions, mixer } = useAnimations(gltf.animations, root);

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

  // Enemy tint: recolour the skin/underwear so friend and foe read apart. The
  // materials stay the real Skyrim materials; only the base tint is nudged.
  useLayoutEffect(() => {
    if (!enemy) return;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of mats) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.color) continue;
        standard.color.lerp(new THREE.Color(0x7a241d), 0.45);
      }
    });
  }, [enemy, model]);

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
    () => SOLE_BONE_NAMES.map((name) => model.getObjectByName(name)).filter((bone): bone is THREE.Object3D => Boolean(bone)),
    [model],
  );

  const mountOnSocket = (socket: THREE.Object3D, transform: WeaponSocketTransform) => {
    if (currentSocket.current === socket) return;
    currentSocket.current?.remove(weaponMount);
    model.updateWorldMatrix(true, true);
    const worldScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
    weaponMount.scale.setScalar(transform.localScale / worldScale);
    weaponMount.position.fromArray(transform.localPosition);
    weaponMount.quaternion.fromArray(transform.localRotation).normalize();
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

  useFrame((_, delta) => {
    const command = animationCommandRef.current;

    // Consume a new command: cross-fade into the semantic action.
    if (consumedSerial.current !== command.serial) {
      const state = command.state;
      const config = clipConfig(state);
      const action = actions[state];
      currentState.current = state;
      elapsed.current = command.startAt;
      externalClockOrigin.current = animationTimeRef?.current ?? 0;
      if (action) {
        const externallyTimed = Boolean(animationTimeRef) && !LOCOMOTION_STATES.has(state);
        action.reset();
        action.enabled = true;
        action.timeScale = config.playbackRate * (externallyTimed ? 1 : speedMultiplierRef?.current ?? 1);
        action.clampWhenFinished = !config.looping;
        action.setLoop(config.looping ? THREE.LoopRepeat : THREE.LoopOnce, config.looping ? Infinity : 1);
        action.time = Math.min(action.getClip().duration, command.startAt * config.playbackRate);
        action.paused = externallyTimed;
        if (previousAction.current && previousAction.current !== action) {
          action.crossFadeFrom(previousAction.current, 0.12, true);
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

    if (externallyTimed && action) {
      // Combat owns timing: drive clip time from the gameplay action clock so
      // the visual never runs ahead of the combat state machine.
      elapsed.current = Math.max(0, animationTimeRef!.current - externalClockOrigin.current) + command.startAt;
      const clip = action.getClip();
      action.time = Math.min(clip.duration, elapsed.current * config.playbackRate);
      mixer.update(0);
    } else {
      elapsed.current += Math.min(delta, 1 / 30);
      // Locomotion clips are self-timed by the mixer; the speed multiplier can
      // change every frame (e.g. lock-on strafing), unlike at consume-time.
      if (action) action.timeScale = config.playbackRate * (speedMultiplierRef?.current ?? 1);
    }

    // The sword rides the hand socket while drawn and the hip sheath while
    // stowed. During EQUIP/UNEQUIP it switches partway through the clip, when
    // the animated hand reaches the hip, instead of snapping at the state
    // boundary.
    if (handSocket && sheathSocket) {
      const progress = config.sourceDuration ? Math.min(1, elapsed.current / config.sourceDuration) : 1;
      const wantHand = state === "EQUIP"
        ? progress >= EQUIP_GRAB_PROGRESS
        : state === "UNEQUIP"
          ? progress < UNEQUIP_STOW_PROGRESS
          : (equippedRef?.current ?? equipped);
      mountOnSocket(wantHand ? handSocket : sheathSocket, wantHand ? weaponProfile.held : weaponProfile.sheathed);
    }

    // Keep the lowest sole marker on the ground regardless of which clip is
    // posing the legs, instead of trusting a single fixed vertical offset
    // calibrated for one rest pose (see docs/architecture/character-actor.md).
    const parent = root.current?.parent;
    if (parent && soleBones.length > 0) {
      let soleY = Infinity;
      for (const bone of soleBones) {
        bone.getWorldPosition(soleTmp.current);
        if (soleTmp.current.y < soleY) soleY = soleTmp.current.y;
      }
      parent.getWorldPosition(bodyTmp.current);
      const groundY = bodyTmp.current.y - CHARACTER_BODY_CENTER_HEIGHT;
      const targetCorrection = groundCorrection.current + (groundY - soleY);
      groundCorrection.current += (targetCorrection - groundCorrection.current) * (1 - Math.exp(-delta * 20));
      if (root.current) root.current.position.y = modelOffsetY + groundCorrection.current;
    }
  });

  return (
    <group ref={root} position={[0, modelOffsetY, 0]} scale={CHARACTER_SCALE} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(GLB_URL);
