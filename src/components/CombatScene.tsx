import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Ecctrl, type EcctrlHandle } from "ecctrl";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { combatAudio } from "../game/audio";
import { input } from "../game/input";
import { useGameStore } from "../game/store";
import type { AnimationState, AttackDefinition, CombatAction } from "../game/types";
import { COMBAT_TUNING, STRAIGHT_SWORD, isBackstabPosition, isParryActive, isRollInvulnerable, phaseAt } from "../game/weapon";
import { AnimatedFighter } from "./AnimatedFighter";
import { Arena } from "./Arena";

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_START = new THREE.Vector3(0, 1, 5.5);
const ENEMY_START = new THREE.Vector3(0, 0.95, -4.5);

type EnemyMode = "watching" | "approach" | "windup" | "attack" | "recover" | "stagger" | "parried" | "backstabbed" | "dead";

function Battle() {
  const player = useRef<EcctrlHandle>(null);
  const enemyBody = useRef<RapierRigidBody>(null);
  const enemyPosition = useRef(ENEMY_START.clone());
  const [playerAnimation, setPlayerAnimation] = useState<AnimationState>("SWORD_IDLE");
  const [enemyAnimation, setEnemyAnimation] = useState<AnimationState>("SWORD_IDLE");
  const playerAnimationRef = useRef<AnimationState>("SWORD_IDLE");
  const enemyAnimationRef = useRef<AnimationState>("SWORD_IDLE");
  const playerAction = useRef<CombatAction>("idle");
  const playerActionTime = useRef(0);
  const playerAttack = useRef<AttackDefinition | null>(null);
  const playerAttackHit = useRef(false);
  const comboQueued = useRef(false);
  const healedThisAction = useRef(false);
  const playerHealth = useRef<number>(COMBAT_TUNING.maxHealth);
  const playerStamina = useRef<number>(COMBAT_TUNING.maxStamina);
  const staminaCooldown = useRef(0);
  const estus = useRef(3);
  const equipped = useRef(true);
  const lockedOn = useRef(false);
  const dodgeHold = useRef(0);
  const dodgeDirection = useRef(new THREE.Vector3(0, 0, -1));

  const enemyMode = useRef<EnemyMode>("watching");
  const enemyModeTime = useRef(0);
  const enemyHealth = useRef(150);
  const enemyAttackHit = useRef(false);
  const enemyDecision = useRef(0.7);
  const enemyYaw = useRef(0);

  const cameraYaw = useRef(0);
  const cameraPitch = useRef(0.34);
  const cameraPosition = useRef(new THREE.Vector3(0, 3.4, 10));
  const cameraLook = useRef(new THREE.Vector3());
  const tmp = useRef({
    toEnemy: new THREE.Vector3(),
    flat: new THREE.Vector3(),
    movement: new THREE.Vector3(),
    desiredCamera: new THREE.Vector3(),
    desiredLook: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });
  const { camera } = useThree();
  const started = useGameStore((state) => state.started);
  const patch = useGameStore((state) => state.patch);
  const hudTimer = useRef(0);
  const messageTimer = useRef(0);
  const message = useRef("");
  const hitStop = useRef(0);
  const shake = useRef(0);

  const setAnim = useCallback((target: "player" | "enemy", animation: AnimationState) => {
    const ref = target === "player" ? playerAnimationRef : enemyAnimationRef;
    if (ref.current === animation) return;
    ref.current = animation;
    if (target === "player") setPlayerAnimation(animation);
    else setEnemyAnimation(animation);
  }, []);

  const announce = useCallback((text: string, duration = 1.2) => {
    message.current = text;
    messageTimer.current = duration;
  }, []);

  const setEnemyMode = useCallback((mode: EnemyMode, animation: AnimationState) => {
    enemyMode.current = mode;
    enemyModeTime.current = 0;
    enemyAttackHit.current = false;
    setAnim("enemy", animation);
  }, [setAnim]);

  const spendStamina = useCallback((amount: number) => {
    if (playerStamina.current < amount) return false;
    playerStamina.current -= amount;
    staminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
    return true;
  }, []);

  const startPlayerAction = useCallback((action: CombatAction, animation: AnimationState) => {
    playerAction.current = action;
    playerActionTime.current = 0;
    playerAttack.current = action === "light1" || action === "light2" || action === "heavy" || action === "riposte" || action === "backstab"
      ? STRAIGHT_SWORD.attacks[action]
      : null;
    playerAttackHit.current = false;
    comboQueued.current = false;
    healedThisAction.current = false;
    setAnim("player", animation);
  }, [setAnim]);

  const finishPlayerAction = useCallback(() => {
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    setAnim("player", equipped.current ? "SWORD_IDLE" : "IDLE");
  }, [setAnim]);

  const damageEnemy = useCallback((damage: number, execution: "riposte" | "backstab" | null = null) => {
    enemyHealth.current = Math.max(0, enemyHealth.current - damage);
    hitStop.current = execution ? playerAttack.current?.hitStop ?? 0.13 : playerAttack.current?.hitStop ?? 0.055;
    shake.current = execution ? 0.42 : 0.22;
    combatAudio.play(enemyHealth.current <= 0 ? "death" : "hit");
    if (enemyHealth.current <= 0) {
      setEnemyMode("dead", "DEATH");
      announce("ENEMY FELLED", 4);
    } else if (execution === "backstab") {
      setEnemyMode("backstabbed", "BACKSTABBED");
    } else {
      setEnemyMode("stagger", "HIT");
    }
  }, [announce, setEnemyMode]);

  const attemptEnemyHit = useCallback(() => {
    if (enemyAttackHit.current || playerHealth.current <= 0) return;
    const handle = player.current;
    if (!handle) return;
    const distance = tmp.current.toEnemy.set(
      enemyPosition.current.x - handle.currPos.x,
      0,
      enemyPosition.current.z - handle.currPos.z,
    ).length();
    if (distance > 2.25) return;
    enemyAttackHit.current = true;

    if (playerAction.current === "parry" && isParryActive(playerActionTime.current)) {
      setEnemyMode("parried", "GUARD_BREAK");
      combatAudio.play("parry");
      announce("PARRY — LIGHT ATTACK TO RIPOSTE", 1.5);
      shake.current = 0.34;
      return;
    }
    if ((playerAction.current === "roll" || playerAction.current === "backstep") && isRollInvulnerable(playerActionTime.current)) return;

    if (playerAction.current === "guard" && equipped.current) {
      const staminaDamage = 34 * (1 - COMBAT_TUNING.guardStability);
      const chip = Math.ceil(27 * (1 - COMBAT_TUNING.guardDamageReduction));
      if (playerStamina.current >= staminaDamage) {
        playerStamina.current -= staminaDamage;
        playerHealth.current = Math.max(0, playerHealth.current - chip);
        staminaCooldown.current = 1;
        combatAudio.play("guard");
        shake.current = 0.18;
        announce("BLOCKED");
        return;
      }
      playerStamina.current = 0;
      playerHealth.current = Math.max(0, playerHealth.current - 18);
      startPlayerAction("guardBreak", "GUARD_BREAK");
      combatAudio.play("hit");
      announce("GUARD BROKEN");
      return;
    }

    playerHealth.current = Math.max(0, playerHealth.current - 27);
    shake.current = 0.46;
    combatAudio.play(playerHealth.current <= 0 ? "death" : "hit");
    if (playerHealth.current <= 0) {
      startPlayerAction("dead", "DEATH");
      announce("YOU DIED", 8);
    } else {
      startPlayerAction("hit", "HIT");
    }
  }, [announce, setEnemyMode, startPlayerAction]);

  useEffect(() => input.attach(), []);
  useEffect(() => {
    const blockMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", blockMenu);
    return () => window.removeEventListener("contextmenu", blockMenu);
  }, []);

  useFrame((_, rawDelta) => {
    if (!started) return;
    input.update();
    let delta = Math.min(rawDelta, 1 / 30);
    if (hitStop.current > 0) {
      hitStop.current -= delta;
      delta *= 0.08;
    }
    const handle = player.current;
    if (!handle) return;
    const body = handle.body;
    const playerPos = handle.currPos;
    playerActionTime.current += delta;
    enemyModeTime.current += delta;
    enemyDecision.current -= delta;
    staminaCooldown.current -= delta;
    messageTimer.current -= delta;
    if (messageTimer.current <= 0) message.current = "";

    const moveMagnitude = Math.min(1, Math.hypot(input.movement.x, input.movement.y));
    if (input.pressed("dodge")) dodgeHold.current = 0;
    if (input.held("dodge")) dodgeHold.current += delta;
    const sprinting = input.held("dodge") && dodgeHold.current > 0.22 && moveMagnitude > 0.15 && playerAction.current === "idle";

    if (input.pressed("lockOn") && enemyHealth.current > 0) {
      lockedOn.current = !lockedOn.current;
      announce(lockedOn.current ? "TARGET LOCKED" : "TARGET RELEASED", 0.75);
    }

    const canStartAction = playerAction.current === "idle" || playerAction.current === "guard";
    if (canStartAction && input.pressed("equip")) {
      equipped.current = !equipped.current;
      startPlayerAction(equipped.current ? "equip" : "unequip", equipped.current ? "EQUIP" : "UNEQUIP");
      announce(equipped.current ? STRAIGHT_SWORD.label.toUpperCase() : "WEAPON STOWED");
    } else if (canStartAction && input.pressed("heal") && estus.current > 0 && playerHealth.current < COMBAT_TUNING.maxHealth) {
      estus.current -= 1;
      startPlayerAction("heal", "HEAL");
      combatAudio.play("heal");
    } else if (canStartAction && input.pressed("parry") && equipped.current && spendStamina(COMBAT_TUNING.parryCost)) {
      startPlayerAction("parry", "PARRY");
    } else if (canStartAction && input.pressed("heavy") && equipped.current && spendStamina(STRAIGHT_SWORD.attacks.heavy.stamina)) {
      startPlayerAction("heavy", "HEAVY");
      combatAudio.play("swing");
    } else if (canStartAction && input.pressed("light") && equipped.current) {
      const riposteAvailable = enemyMode.current === "parried" && enemyModeTime.current < 1.6 && tmp.current.toEnemy.set(
        enemyPosition.current.x - playerPos.x,
        0,
        enemyPosition.current.z - playerPos.z,
      ).length() < 2;
      const enemyToPlayer = tmp.current.flat.set(
        playerPos.x - enemyPosition.current.x,
        0,
        playerPos.z - enemyPosition.current.z,
      );
      const backstabAvailable = !riposteAvailable
        && (enemyMode.current === "watching" || enemyMode.current === "approach" || enemyMode.current === "windup" || enemyMode.current === "recover")
        && isBackstabPosition(
          { x: Math.sin(enemyYaw.current), z: Math.cos(enemyYaw.current) },
          { x: enemyToPlayer.x, z: enemyToPlayer.z },
          enemyToPlayer.length(),
        );
      const attack = riposteAvailable
        ? STRAIGHT_SWORD.attacks.riposte
        : backstabAvailable
          ? STRAIGHT_SWORD.attacks.backstab
          : STRAIGHT_SWORD.attacks.light1;
      if (spendStamina(attack.stamina)) {
        startPlayerAction(attack.id, attack.animation);
        if (attack.id === "backstab") {
          const forward = tmp.current.forward.set(Math.sin(enemyYaw.current), 0, Math.cos(enemyYaw.current));
          body.setTranslation({
            x: enemyPosition.current.x - forward.x * 0.82,
            y: playerPos.y,
            z: enemyPosition.current.z - forward.z * 0.82,
          }, true);
          body.setLinvel({ x: 0, y: body.linvel().y, z: 0 }, true);
          tmp.current.quaternion.setFromAxisAngle(UP, enemyYaw.current);
          body.setRotation(tmp.current.quaternion, true);
          setEnemyMode("backstabbed", "BACKSTABBED");
          lockedOn.current = true;
          announce("BACKSTAB", 1.4);
        }
        combatAudio.play("swing");
      }
    } else if (playerAction.current === "idle" && input.held("guard") && equipped.current) {
      startPlayerAction("guard", "GUARD");
    } else if (playerAction.current === "guard" && !input.held("guard")) {
      finishPlayerAction();
    }

    if (input.released("dodge") && dodgeHold.current <= 0.28 && canStartAction && spendStamina(moveMagnitude > 0.15 ? COMBAT_TUNING.rollCost : COMBAT_TUNING.backstepCost)) {
      const action = moveMagnitude > 0.15 ? "roll" : "backstep";
      startPlayerAction(action, action === "roll" ? "ROLL" : "BACKSTEP");
      combatAudio.play("roll");
      const sin = Math.sin(cameraYaw.current);
      const cos = Math.cos(cameraYaw.current);
      if (moveMagnitude > 0.15) {
        dodgeDirection.current.set(
          input.movement.x * cos - input.movement.y * sin,
          0,
          input.movement.x * sin + input.movement.y * cos,
        ).normalize();
      } else {
        dodgeDirection.current.copy(handle.bodyZAxis).multiplyScalar(-1).setY(0).normalize();
      }
      body.setLinvel({ x: dodgeDirection.current.x * 7.2, y: body.linvel().y, z: dodgeDirection.current.z * 7.2 }, true);
    }

    const attack = playerAttack.current;
    if (attack) {
      const phase = phaseAt(playerActionTime.current, attack);
      if (input.pressed("light") && (attack.id === "light1" || attack.id === "light2") && phase === "recovery") comboQueued.current = true;
      if (phase === "active" && !playerAttackHit.current) {
        playerAttackHit.current = true;
        const distance = tmp.current.toEnemy.set(
          enemyPosition.current.x - playerPos.x,
          0,
          enemyPosition.current.z - playerPos.z,
        ).length();
        if (distance <= attack.range) {
          const execution = attack.id === "riposte" ? "riposte" : attack.id === "backstab" ? "backstab" : null;
          damageEnemy(attack.damage, execution);
        }
      }
      if (phase === "none") {
        if (comboQueued.current && attack.id === "light1" && spendStamina(STRAIGHT_SWORD.attacks.light2.stamina)) {
          startPlayerAction("light2", "LIGHT_2");
          combatAudio.play("swing");
        } else finishPlayerAction();
      }
    } else {
      const actionDurations: Partial<Record<CombatAction, number>> = {
        roll: COMBAT_TUNING.rollDuration,
        backstep: 0.62,
        parry: 0.66,
        heal: COMBAT_TUNING.healDuration,
        equip: 0.62,
        unequip: 0.62,
        hit: 0.62,
        guardBreak: 1.05,
      };
      const duration = actionDurations[playerAction.current];
      if (playerAction.current === "heal" && playerActionTime.current > 0.82 && !healedThisAction.current) {
        healedThisAction.current = true;
        playerHealth.current = Math.min(COMBAT_TUNING.maxHealth, playerHealth.current + COMBAT_TUNING.healAmount);
      }
      if (duration && playerActionTime.current >= duration) finishPlayerAction();
    }

    const movementAllowed = playerAction.current === "idle" || playerAction.current === "guard";
    const movementScale = playerAction.current === "guard" ? 0.42 : 1;
    handle.setMovement({
      joystick: { x: input.movement.x * movementScale, y: input.movement.y * movementScale },
      run: sprinting,
      jump: false,
    });
    if (!movementAllowed) handle.setMovement({ joystick: { x: 0, y: 0 }, run: false, jump: false });

    if (sprinting) {
      playerStamina.current = Math.max(0, playerStamina.current - COMBAT_TUNING.sprintDrainPerSecond * delta);
      staminaCooldown.current = COMBAT_TUNING.staminaRegenDelay;
    } else if (staminaCooldown.current <= 0 && playerAction.current !== "guard") {
      playerStamina.current = Math.min(COMBAT_TUNING.maxStamina, playerStamina.current + COMBAT_TUNING.staminaRegenPerSecond * delta);
    }

    if (playerAction.current === "roll" || playerAction.current === "backstep") {
      const speed = Math.max(1.8, 7.2 * (1 - playerActionTime.current / COMBAT_TUNING.rollDuration));
      body.setLinvel({ x: dodgeDirection.current.x * speed, y: body.linvel().y, z: dodgeDirection.current.z * speed }, true);
    }

    if (playerAction.current === "idle") {
      const locomotion = sprinting ? "SPRINT" : moveMagnitude > 0.72 ? "RUN" : moveMagnitude > 0.08 ? "WALK" : equipped.current ? "SWORD_IDLE" : "IDLE";
      setAnim("player", locomotion);
    }

    // Single-enemy arena AI: readable spacing, deliberate telegraph, active hit,
    // and recovery windows that support roll, block, parry, and punish play.
    const toPlayer = tmp.current.flat.set(playerPos.x - enemyPosition.current.x, 0, playerPos.z - enemyPosition.current.z);
    const distance = toPlayer.length();
    const direction = distance > 0.001 ? toPlayer.normalize() : toPlayer.set(0, 0, 1);
    if (enemyMode.current !== "dead" && enemyMode.current !== "backstabbed") {
      const targetYaw = Math.atan2(direction.x, direction.z);
      const yawDelta = Math.atan2(Math.sin(targetYaw - enemyYaw.current), Math.cos(targetYaw - enemyYaw.current));
      const turnRate = enemyMode.current === "approach"
        ? 2.15
        : enemyMode.current === "watching"
          ? 1.35
          : enemyMode.current === "windup"
            ? 0.42
            : enemyMode.current === "recover"
              ? 0.3
              : 0;
      enemyYaw.current += THREE.MathUtils.clamp(yawDelta, -turnRate * delta, turnRate * delta);
      tmp.current.quaternion.setFromAxisAngle(UP, enemyYaw.current);
      enemyBody.current?.setNextKinematicRotation(tmp.current.quaternion);
    }

    if (enemyMode.current === "watching" || enemyMode.current === "approach") {
      if (distance > 2.45) {
        enemyMode.current = "approach";
        setAnim("enemy", "WALK");
        enemyPosition.current.addScaledVector(direction, delta * (distance > 6 ? 2.45 : 1.65));
      } else {
        enemyMode.current = "watching";
        setAnim("enemy", "SWORD_IDLE");
        if (enemyDecision.current <= 0) {
          enemyDecision.current = 1.05 + Math.random() * 0.55;
          setEnemyMode("windup", "HEAVY");
        }
      }
    } else if (enemyMode.current === "windup" && enemyModeTime.current >= 0.64) {
      setEnemyMode("attack", "HEAVY");
      combatAudio.play("swing");
    } else if (enemyMode.current === "attack") {
      if (enemyModeTime.current >= 0.11 && enemyModeTime.current <= 0.28) attemptEnemyHit();
      if (enemyModeTime.current > 0.42) setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "recover" && enemyModeTime.current > 0.72) {
      setEnemyMode("watching", "SWORD_IDLE");
    } else if (enemyMode.current === "stagger" && enemyModeTime.current > 0.58) {
      setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "parried" && enemyModeTime.current > 1.75) {
      setEnemyMode("recover", "SWORD_IDLE");
    } else if (enemyMode.current === "backstabbed" && enemyModeTime.current > 1.3 && enemyHealth.current > 0) {
      setEnemyMode("recover", "SWORD_IDLE");
    }
    enemyBody.current?.setNextKinematicTranslation(enemyPosition.current);

    if (lockedOn.current && enemyHealth.current > 0) {
      const fromEnemy = tmp.current.toEnemy.set(playerPos.x - enemyPosition.current.x, 0, playerPos.z - enemyPosition.current.z).normalize();
      cameraYaw.current = Math.atan2(-fromEnemy.x, -fromEnemy.z);
      tmp.current.quaternion.setFromAxisAngle(UP, Math.atan2(-fromEnemy.x, -fromEnemy.z));
      if (playerAction.current === "idle" || playerAction.current === "guard") body.setRotation(tmp.current.quaternion, true);
    } else {
      cameraYaw.current -= input.camera.x * delta * 2.35;
      cameraPitch.current = THREE.MathUtils.clamp(cameraPitch.current + input.camera.y * delta * 1.7, 0.08, 0.78);
    }

    const camDistance = playerAction.current === "backstab" ? 4.7 : lockedOn.current ? 6.7 : 5.8;
    const horizontal = Math.cos(cameraPitch.current) * camDistance;
    tmp.current.desiredCamera.set(
      playerPos.x + Math.sin(cameraYaw.current) * horizontal,
      playerPos.y + 1.15 + Math.sin(cameraPitch.current) * camDistance,
      playerPos.z + Math.cos(cameraYaw.current) * horizontal,
    );
    tmp.current.desiredLook.set(playerPos.x, playerPos.y + 0.55, playerPos.z);
    if (lockedOn.current && enemyHealth.current > 0) tmp.current.desiredLook.lerp(enemyPosition.current, 0.34).setY(playerPos.y + 0.55);
    cameraPosition.current.lerp(tmp.current.desiredCamera, 1 - Math.exp(-delta * 9));
    cameraLook.current.lerp(tmp.current.desiredLook, 1 - Math.exp(-delta * 12));
    if (shake.current > 0) {
      shake.current = Math.max(0, shake.current - delta * 2.2);
      camera.position.copy(cameraPosition.current).addScaledVector(tmp.current.flat.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), shake.current * 0.13);
    } else camera.position.copy(cameraPosition.current);
    camera.lookAt(cameraLook.current);

    hudTimer.current -= delta;
    if (hudTimer.current <= 0) {
      hudTimer.current = 0.05;
      patch({
        playerHealth: playerHealth.current,
        playerStamina: playerStamina.current,
        enemyHealth: enemyHealth.current,
        estus: estus.current,
        equipped: equipped.current,
        lockedOn: lockedOn.current,
        playerAction: playerAction.current,
        enemyAction: enemyMode.current,
        message: message.current,
        gamepad: input.gamepadName,
      });
    }
  });

  return (
    <>
      <Ecctrl
        ref={player}
        position={PLAYER_START}
        rotation={[0, Math.PI, 0]}
        maxWalkVel={1.65}
        maxRunVel={3.85}
        accDeltaTime={0.16}
        decDeltaTime={0.13}
        rejectVelFactor={0.92}
        airDragFactor={0.06}
        enableToggleRun={false}
        capsuleHalfHeight={0.42}
        capsuleRadius={0.3}
        floatHeight={0.18}
        springK={92}
        dampingC={7}
        jumpVel={0}
        colliders={false}
        name="player"
      >
        <CapsuleCollider args={[0.42, 0.3]} name="player-collider" />
        <AnimatedFighter animation={playerAnimation} equipped={equipped.current} />
      </Ecctrl>
      <RigidBody ref={enemyBody} type="kinematicPosition" colliders={false} position={ENEMY_START} name="arena-knight">
        <CapsuleCollider args={[0.42, 0.32]} />
        <AnimatedFighter animation={enemyAnimation} equipped enemy />
      </RigidBody>
    </>
  );
}

export function CombatScene() {
  return (
    <>
      <color attach="background" args={["#090a0b"]} />
      <fog attach="fog" args={["#090a0b", 13, 34]} />
      <ambientLight intensity={0.22} color="#78849a" />
      <hemisphereLight intensity={0.4} color="#9aa6bd" groundColor="#17130f" />
      <directionalLight
        castShadow
        position={[7, 12, 6]}
        intensity={2.4}
        color="#f0d4a0"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <pointLight position={[-8, 2.5, -7]} intensity={18} distance={10} color="#8c331b" />
      <Physics gravity={[0, -9.81, 0]} timeStep="vary">
        <Arena />
        <Battle />
      </Physics>
    </>
  );
}
