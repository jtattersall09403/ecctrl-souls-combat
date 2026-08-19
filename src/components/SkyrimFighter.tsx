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
import { CHARACTER_MODEL_OFFSET } from "../game/physics/characterPhysics";
import type { AnimationState } from "../game/core/types";

const GLB_URL = `${import.meta.env.BASE_URL}${CHARACTER_GLB}`;

// The procedural stand-in sword. It attaches to the rig's native `WeaponSword`
// socket, so swapping in an extracted Skyrim sword mesh later is a drop-in:
// build the mesh, parent it to the same socket, keep the same hitbox semantics.
const SWORD_MOUNT_ROTATION = new THREE.Euler(Math.PI / 2, 0, 0); // blade down the hand
const SWORD_MOUNT_POSITION = new THREE.Vector3(0, 0, 0);

function makeSword(): THREE.Group {
  const sword = new THREE.Group();
  sword.name = "WeatheredStraightSword";
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.32, metalness: 0.82, emissive: 0x272a2c, emissiveIntensity: 0.3 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x241711, roughness: 0.86 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.83, 0.018), steel);
  blade.position.y = 0.53;
  blade.castShadow = true;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.16, 4), steel);
  tip.position.y = 1.02;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.05), steel);
  guard.position.y = 0.08;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.28, 8), leather);
  grip.position.y = -0.08;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), steel);
  pommel.position.y = -0.24;
  sword.add(blade, tip, guard, grip, pommel);
  return sword;
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
  animationTimeRef,
  modelOffsetY = CHARACTER_MODEL_OFFSET,
}: {
  animationCommandRef: MutableRefObject<AnimationCommand>;
  equipped: boolean;
  equippedRef?: MutableRefObject<boolean>;
  enemy?: boolean;
  weaponRef?: MutableRefObject<THREE.Object3D | null>;
  animationTimeRef?: MutableRefObject<number>;
  modelOffsetY?: number;
}) {
  const gltf = useGLTF(GLB_URL);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const root = useRef<THREE.Group>(null);
  const sword = useMemo(makeSword, []);
  const weaponMount = useMemo(() => new THREE.Group(), []);

  const previousAction = useRef<THREE.AnimationAction | null>(null);
  const currentState = useRef<AnimationState>(animationCommandRef.current.state);
  const consumedSerial = useRef(-1);
  const elapsed = useRef(0);

  const { actions, mixer } = useAnimations(gltf.animations, root);

  // Enemy tint: recolour the skin/underwear so friend and foe read apart. The
  // materials stay the real Skyrim materials; only the base tint is nudged.
  useLayoutEffect(() => {
    if (!enemy) return;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of mats) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.color) continue;
        standard.color.lerp(new THREE.Color(0x7a241d), 0.45);
      }
    });
  }, [enemy, model]);

  // Mount the sword on the native WeaponSword socket, counter-scaling for the
  // rig's baked scale so the blade renders at real-world size.
  useLayoutEffect(() => {
    const socket =
      model.getObjectByName(RIG_SOCKETS.weapon) ??
      model.getObjectByName(RIG_SOCKETS.weaponFallback) ??
      model.getObjectByName(RIG_SOCKETS.rightHand);
    if (!socket) return;
    model.updateWorldMatrix(true, true);
    const worldScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
    weaponMount.scale.setScalar(1 / worldScale);
    weaponMount.position.copy(SWORD_MOUNT_POSITION);
    weaponMount.quaternion.setFromEuler(SWORD_MOUNT_ROTATION);
    sword.position.set(0, 0, 0);
    weaponMount.add(sword);
    socket.add(weaponMount);
    if (weaponRef) weaponRef.current = sword;
    return () => {
      if (weaponRef?.current === sword) weaponRef.current = null;
      socket.remove(weaponMount);
      weaponMount.remove(sword);
    };
  }, [model, sword, weaponMount, weaponRef]);

  useFrame((_, delta) => {
    const command = animationCommandRef.current;

    // Consume a new command: cross-fade into the semantic action.
    if (consumedSerial.current !== command.serial) {
      const state = command.state;
      const config = clipConfig(state);
      const action = actions[state];
      currentState.current = state;
      elapsed.current = command.startAt;
      if (action) {
        const externallyTimed = Boolean(animationTimeRef) && !LOCOMOTION_STATES.has(state);
        action.reset();
        action.enabled = true;
        action.timeScale = config.playbackRate;
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
      elapsed.current = animationTimeRef!.current;
      const clip = action.getClip();
      action.time = Math.min(clip.duration, elapsed.current * config.playbackRate);
      mixer.update(0);
    } else {
      elapsed.current += Math.min(delta, 1 / 30);
    }

    sword.visible = equippedRef?.current ?? equipped;
  });

  return (
    <group ref={root} position={[0, modelOffsetY, 0]} scale={CHARACTER_SCALE} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(GLB_URL);
