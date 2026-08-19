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
  WEAPON_GLB,
  clipConfig,
} from "../game/anim/animationManifest";
import { CHARACTER_MODEL_OFFSET } from "../game/physics/characterPhysics";
import type { AnimationState } from "../game/core/types";

const GLB_URL = `${import.meta.env.BASE_URL}${CHARACTER_GLB}`;
const WEAPON_URL = `${import.meta.env.BASE_URL}${WEAPON_GLB}`;

// The extracted Skyrim steel sword is authored relative to the rig's native
// `Weapon` hand socket, so it attaches at identity (grip at the origin, blade
// along +Z). Swapping to a different weapon is a pipeline rebuild + new GLB.

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
  const weaponGltf = useGLTF(WEAPON_URL);
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

  // Mount the sword on the native Weapon (hand) socket, counter-scaling for the
  // rig's baked scale so the weapon frame is real-world metres. weaponRef points
  // at the mount: its local +Z is the blade, grip at the origin (hitbox space).
  useLayoutEffect(() => {
    const socket =
      model.getObjectByName(RIG_SOCKETS.weapon) ??
      model.getObjectByName(RIG_SOCKETS.weaponFallback);
    if (!socket) return;
    model.updateWorldMatrix(true, true);
    const worldScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
    weaponMount.scale.setScalar(1 / worldScale);
    weaponMount.position.set(0, 0, 0);
    weaponMount.quaternion.identity();
    sword.position.set(0, 0, 0);
    sword.quaternion.identity();
    weaponMount.add(sword);
    socket.add(weaponMount);
    if (weaponRef) weaponRef.current = weaponMount;
    return () => {
      if (weaponRef?.current === weaponMount) weaponRef.current = null;
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
useGLTF.preload(WEAPON_URL);
