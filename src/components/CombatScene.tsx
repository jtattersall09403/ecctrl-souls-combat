import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { Ecctrl, type EcctrlHandle } from "ecctrl";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { combatAudio } from "../game/audio";
import { createHitShake, sampleHitShake, type HitShakeImpulse, type HitShakeKind } from "../game/cameraShake";
import { analogueMoveSpeed, cameraRelativeDirection, input } from "../game/input";
import { useGameStore } from "../game/store";
import type { AnimationState, AttackDefinition, CombatAction } from "../game/types";
import { COMBAT_TUNING, STRAIGHT_SWORD, isBackstabPosition, isParryActive, isRollInvulnerable, phaseAt } from "../game/weapon";
import { AnimatedFighter } from "./AnimatedFighter";
import { Arena } from "./Arena";

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_START = new THREE.Vector3(0, 1, 5.5);
const ENEMY_START = new THREE.Vector3(0, 0.95, -4.5);

type EnemyMode = "watching" | "approach" | "windup" | "attack" | "recover" | "stagger" | "parried" | "backstabbed" | "dead";

const ENEMY_ATTACK_SEQUENCE = [
  STRAIGHT_SWORD.attacks.light1,
  STRAIGHT_SWORD.attacks.light2,
  STRAIGHT_SWORD.attacks.light3,
  STRAIGHT_SWORD.attacks.heavy,
  STRAIGHT_SWORD.attacks.heavy2,
] as const;

function AnalogueSpeedLimiter({
  controller,
  magnitude,
  sprinting,
  enabled,
}: {
  controller: RefObject<EcctrlHandle | null>;
  magnitude: RefObject<number>;
  sprinting: RefObject<boolean>;
  enabled: RefObject<boolean>;
}) {
  // Ecctrl deliberately normalises joystick input. This extension runs after
  // the controller frame and restores analogue magnitude to planar speed.
  useFrame(() => {
    const handle = controller.current;
    if (!handle || !enabled.current || magnitude.current <= 0.01) return;
    const velocity = handle.body.linvel();
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const maximum = analogueMoveSpeed(magnitude.current, sprinting.current);
    if (planarSpeed <= maximum || planarSpeed <= 0.001) return;
    const scale = maximum / planarSpeed;
    handle.body.setLinvel({ x: velocity.x * scale, y: velocity.y, z: velocity.z * scale }, true);
  });
  return null;
}

function WeaponHitbox({
  weapon,
  overlapsTarget,
  targetName,
  active,
}: {
  weapon: RefObject<THREE.Object3D | null>;
  overlapsTarget: MutableRefObject<boolean>;
  targetName: string;
  active: RefObject<boolean>;
}) {
  const body = useRef<RapierRigidBody>(null);
  const { rapier } = useRapier();
  const center = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!body.current || !weapon.current || !active.current) {
      overlapsTarget.current = false;
      body.current?.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });
      return;
    }
    weapon.current.updateWorldMatrix(true, false);
    center.set(0, 0.58, 0).applyMatrix4(weapon.current.matrixWorld);
    weapon.current.getWorldQuaternion(rotation);
    body.current.setNextKinematicTranslation(center);
    body.current.setNextKinematicRotation(rotation);
  });

  const updateOverlap = (active: boolean, name?: string) => {
    if (name === targetName) overlapsTarget.current = active;
  };

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -100, 0]} name={`${targetName}-weapon-sensor`}>
      <CapsuleCollider
        args={[0.49, 0.085]}
        sensor
        activeCollisionTypes={rapier.ActiveCollisionTypes.ALL}
        onIntersectionEnter={({ other }) => updateOverlap(true, other.rigidBodyObject?.name)}
        onIntersectionExit={({ other }) => updateOverlap(false, other.rigidBodyObject?.name)}
      />
    </RigidBody>
  );
}

function Battle() {
  const player = useRef<EcctrlHandle>(null);
  const enemyBody = useRef<RapierRigidBody>(null);
  const playerWeapon = useRef<THREE.Object3D>(null);
  const enemyWeapon = useRef<THREE.Object3D>(null);
  const playerWeaponOverlap = useRef(false);
  const enemyWeaponOverlap = useRef(false);
  const playerHitboxActive = useRef(false);
  const enemyHitboxActive = useRef(false);
  const enemyPosition = useRef(ENEMY_START.clone());
  const [playerAnimation, setPlayerAnimation] = useState<AnimationState>("SWORD_IDLE");
  const [enemyAnimation, setEnemyAnimation] = useState<AnimationState>("SWORD_IDLE");
  const playerAnimationRef = useRef<AnimationState>("SWORD_IDLE");
  const enemyAnimationRef = useRef<AnimationState>("SWORD_IDLE");
  const playerAction = useRef<CombatAction>("idle");
  const playerActionTime = useRef(0);
  const playerAttack = useRef<AttackDefinition | null>(null);
  const playerAttackHit = useRef(false);
  const comboQueued = useRef<"light" | "heavy" | null>(null);
  const healedThisAction = useRef(false);
  const playerHealth = useRef<number>(COMBAT_TUNING.maxHealth);
  const playerStamina = useRef<number>(COMBAT_TUNING.maxStamina);
  const staminaCooldown = useRef(0);
  const estus = useRef(3);
  const equipped = useRef(true);
  const lockedOn = useRef(false);
  const dodgeHold = useRef(0);
  const dodgeDirection = useRef(new THREE.Vector3(0, 0, -1));
  const moveMagnitudeRef = useRef(0);
  const sprintingRef = useRef(false);
  const movementAllowedRef = useRef(true);
  const wasGrounded = useRef(true);
  const landingTimer = useRef(0);

  const enemyMode = useRef<EnemyMode>("watching");
  const enemyModeTime = useRef(0);
  const enemyHealth = useRef(150);
  const enemyAttackHit = useRef(false);
  const enemyAttack = useRef<AttackDefinition>(STRAIGHT_SWORD.attacks.light1);
  const enemyAttackIndex = useRef(0);
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
    cameraRight: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });
  const { camera } = useThree();
  const started = useGameStore((state) => state.started);
  const enemyEnabled = useGameStore((state) => state.enemyEnabled);
  const enemyAiEnabled = useGameStore((state) => state.enemyAiEnabled);
  const resetToken = useGameStore((state) => state.resetToken);
  const patch = useGameStore((state) => state.patch);
  const hudTimer = useRef(0);
  const messageTimer = useRef(0);
  const message = useRef("");
  const hitStop = useRef(0);
  const shake = useRef<HitShakeImpulse | null>(null);
  const shakeSeed = useRef(0);
  const damagePulse = useRef(0);

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

  const triggerShake = useCallback((kind: HitShakeKind, worldDirection?: { x: number; z: number }) => {
    let side = 0;
    if (worldDirection) {
      const length = Math.hypot(worldDirection.x, worldDirection.z);
      if (length > 0.001) {
        const right = tmp.current.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
        side = right.x * (worldDirection.x / length) + right.z * (worldDirection.z / length);
      }
    }
    shakeSeed.current += 1;
    shake.current = createHitShake(kind, shakeSeed.current, side);
  }, [camera]);

  const triggerDamageVignette = useCallback(() => {
    damagePulse.current += 1;
    patch({ damagePulse: damagePulse.current });
  }, [patch]);

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
    playerAttack.current = action === "light1" || action === "light2" || action === "light3" || action === "heavy" || action === "heavy2" || action === "riposte" || action === "backstab"
      ? STRAIGHT_SWORD.attacks[action]
      : null;
    playerAttackHit.current = false;
    comboQueued.current = null;
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
    const handle = player.current;
    triggerShake(execution ? "execution" : "enemyHit", handle ? {
      x: enemyPosition.current.x - handle.currPos.x,
      z: enemyPosition.current.z - handle.currPos.z,
    } : undefined);
    combatAudio.play(enemyHealth.current <= 0 ? "death" : "hit");
    if (enemyHealth.current <= 0) {
      lockedOn.current = false;
      setEnemyMode("dead", "DEATH");
      announce("ENEMY FELLED", 4);
    } else if (execution === "backstab") {
      setEnemyMode("backstabbed", "BACKSTABBED");
    } else {
      setEnemyMode("stagger", "HIT");
    }
  }, [announce, setEnemyMode, triggerShake]);

  const attemptEnemyHit = useCallback(() => {
    if (enemyAttackHit.current || playerHealth.current <= 0) return;
    const handle = player.current;
    if (!handle) return;
    enemyAttackHit.current = true;

    if (playerAction.current === "parry" && isParryActive(playerActionTime.current)) {
      setEnemyMode("parried", "GUARD_BREAK");
      combatAudio.play("parry");
      announce("PARRY — LIGHT ATTACK TO RIPOSTE", 1.5);
      triggerShake("parry", {
        x: handle.currPos.x - enemyPosition.current.x,
        z: handle.currPos.z - enemyPosition.current.z,
      });
      return;
    }
    if ((playerAction.current === "roll" || playerAction.current === "backstep") && isRollInvulnerable(playerActionTime.current)) return;

    if (playerAction.current === "guard" && equipped.current) {
      const incomingDamage = enemyAttack.current.damage;
      const staminaDamage = incomingDamage * 1.25 * (1 - COMBAT_TUNING.guardStability);
      const chip = Math.ceil(incomingDamage * (1 - COMBAT_TUNING.guardDamageReduction));
      if (playerStamina.current >= staminaDamage) {
        playerStamina.current -= staminaDamage;
        playerHealth.current = Math.max(0, playerHealth.current - chip);
        staminaCooldown.current = 1;
        combatAudio.play("guard");
        triggerDamageVignette();
        triggerShake("block", {
          x: handle.currPos.x - enemyPosition.current.x,
          z: handle.currPos.z - enemyPosition.current.z,
        });
        announce("BLOCKED");
        return;
      }
      playerStamina.current = 0;
      playerHealth.current = Math.max(0, playerHealth.current - 18);
      startPlayerAction("guardBreak", "GUARD_BREAK");
      combatAudio.play("hit");
      triggerDamageVignette();
      triggerShake("playerHit", {
        x: handle.currPos.x - enemyPosition.current.x,
        z: handle.currPos.z - enemyPosition.current.z,
      });
      announce("GUARD BROKEN");
      return;
    }

    playerHealth.current = Math.max(0, playerHealth.current - enemyAttack.current.damage);
    triggerDamageVignette();
    triggerShake("playerHit", {
      x: handle.currPos.x - enemyPosition.current.x,
      z: handle.currPos.z - enemyPosition.current.z,
    });
    combatAudio.play(playerHealth.current <= 0 ? "death" : "hit");
    if (playerHealth.current <= 0) {
      startPlayerAction("dead", "DEATH");
      announce("YOU DIED", 8);
    } else {
      startPlayerAction("hit", "HIT");
    }
  }, [announce, setEnemyMode, startPlayerAction, triggerDamageVignette, triggerShake]);

  useEffect(() => input.attach(), []);
  useEffect(() => {
    const blockMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", blockMenu);
    return () => window.removeEventListener("contextmenu", blockMenu);
  }, []);
  useEffect(() => {
    if (!started) return;
    const handle = player.current;
    if (handle) {
      handle.body.setTranslation(PLAYER_START, true);
      handle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      handle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      handle.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
    }
    enemyPosition.current.copy(ENEMY_START);
    enemyBody.current?.setNextKinematicTranslation(ENEMY_START);
    playerHealth.current = COMBAT_TUNING.maxHealth;
    playerStamina.current = COMBAT_TUNING.maxStamina;
    estus.current = 3;
    equipped.current = true;
    lockedOn.current = false;
    playerAction.current = "idle";
    playerActionTime.current = 0;
    playerAttack.current = null;
    playerAttackHit.current = false;
    playerWeaponOverlap.current = false;
    enemyWeaponOverlap.current = false;
    playerHitboxActive.current = false;
    enemyHitboxActive.current = false;
    comboQueued.current = null;
    enemyHealth.current = 150;
    enemyMode.current = "watching";
    enemyModeTime.current = 0;
    enemyAttack.current = STRAIGHT_SWORD.attacks.light1;
    enemyAttackIndex.current = 0;
    enemyDecision.current = 0.7;
    enemyYaw.current = 0;
    damagePulse.current = 0;
    hitStop.current = 0;
    shake.current = null;
    cameraYaw.current = 0;
    cameraPitch.current = 0.34;
    cameraPosition.current.set(0, 3.4, 10);
    message.current = resetToken > 0 ? "FIGHT RESTARTED" : "THE HOLLOW WARDEN";
    messageTimer.current = 1.2;
    setAnim("player", "SWORD_IDLE");
    setAnim("enemy", "SWORD_IDLE");
  }, [resetToken, setAnim, started]);

  useEffect(() => {
    if (enemyEnabled) return;
    lockedOn.current = false;
    playerWeaponOverlap.current = false;
    enemyWeaponOverlap.current = false;
    playerHitboxActive.current = false;
    enemyHitboxActive.current = false;
  }, [enemyEnabled]);

  useFrame((_, rawDelta) => {
    if (!started) return;
    input.update();
    const frameDelta = Math.min(rawDelta, 1 / 30);
    let delta = frameDelta;
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
    landingTimer.current = Math.max(0, landingTimer.current - delta);
    if (messageTimer.current <= 0) message.current = "";

    const moveMagnitude = Math.min(1, Math.hypot(input.movement.x, input.movement.y));
    moveMagnitudeRef.current = moveMagnitude;
    if (!wasGrounded.current && handle.isOnGround) landingTimer.current = 0.28;
    wasGrounded.current = handle.isOnGround;
    if (input.pressed("dodge")) dodgeHold.current = 0;
    if (input.held("dodge")) dodgeHold.current += delta;
    const sprinting = input.held("dodge") && dodgeHold.current > 0.22 && moveMagnitude > 0.15 && playerAction.current === "idle";
    sprintingRef.current = sprinting;
    const jumpStarted = input.pressed("jump") && handle.isOnGround && playerAction.current === "idle";

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
      announce("SWORD PARRY", 0.55);
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
      announce("GUARDING", 0.55);
    } else if (playerAction.current === "guard" && !input.held("guard")) {
      finishPlayerAction();
    }

    if (input.released("dodge") && dodgeHold.current <= 0.28 && canStartAction && spendStamina(moveMagnitude > 0.15 ? COMBAT_TUNING.rollCost : COMBAT_TUNING.backstepCost)) {
      const action = moveMagnitude > 0.15 ? "roll" : "backstep";
      startPlayerAction(action, action === "roll" ? "ROLL" : "BACKSTEP");
      combatAudio.play("roll");
      if (moveMagnitude > 0.15) {
        const direction = cameraRelativeDirection(input.movement, cameraYaw.current);
        dodgeDirection.current.set(direction.x, direction.y, direction.z).normalize();
      } else {
        dodgeDirection.current.copy(handle.bodyZAxis).multiplyScalar(-1).setY(0).normalize();
      }
      body.setLinvel({ x: dodgeDirection.current.x * 7.2, y: body.linvel().y, z: dodgeDirection.current.z * 7.2 }, true);
    }

    const attack = playerAttack.current;
    if (attack) {
      const phase = phaseAt(playerActionTime.current, attack);
      playerHitboxActive.current = phase === "active" && equipped.current && enemyEnabled && enemyHealth.current > 0;
      const comboInputOpen = phase !== "none" && playerActionTime.current >= attack.windup * 0.65;
      if (comboInputOpen) {
        if (input.pressed("light") && (attack.id === "light1" || attack.id === "light2")) comboQueued.current = "light";
        if (input.pressed("heavy") && attack.id === "heavy") comboQueued.current = "heavy";
      }
      if (phase === "active" && !playerAttackHit.current && playerWeaponOverlap.current && enemyEnabled && enemyHealth.current > 0) {
        playerAttackHit.current = true;
        const execution = attack.id === "riposte" ? "riposte" : attack.id === "backstab" ? "backstab" : null;
        damageEnemy(attack.damage, execution);
      }
      if (phase === "none") {
        const nextAttack = comboQueued.current === "light" && attack.id === "light1"
          ? STRAIGHT_SWORD.attacks.light2
          : comboQueued.current === "light" && attack.id === "light2"
            ? STRAIGHT_SWORD.attacks.light3
            : comboQueued.current === "heavy" && attack.id === "heavy"
              ? STRAIGHT_SWORD.attacks.heavy2
              : null;
        if (nextAttack && spendStamina(nextAttack.stamina)) {
          startPlayerAction(nextAttack.id, nextAttack.animation);
          combatAudio.play("swing");
        } else finishPlayerAction();
      }
    } else {
      playerHitboxActive.current = false;
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
    movementAllowedRef.current = movementAllowed;
    const movementScale = playerAction.current === "guard" ? 0.42 : 1;
    handle.setMovement({
      joystick: { x: input.movement.x * movementScale, y: input.movement.y * movementScale },
      run: sprinting,
      jump: input.held("jump") && playerAction.current === "idle",
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
      const locomotion = !handle.isOnGround
        ? "JUMP_IDLE"
        : jumpStarted
          ? "JUMP_START"
          : landingTimer.current > 0
            ? "JUMP_LAND"
            : sprinting
              ? "SPRINT"
              : moveMagnitude > 0.72
                ? "RUN"
                : moveMagnitude > 0.08
                  ? "WALK"
                  : equipped.current
                    ? "SWORD_IDLE"
                    : "IDLE";
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

    enemyHitboxActive.current = false;
    if (!enemyEnabled) {
      // The debug toggle removes the enemy body below and suspends its state.
    } else if (!enemyAiEnabled && enemyHealth.current > 0 && enemyMode.current !== "backstabbed" && enemyMode.current !== "stagger" && enemyMode.current !== "parried") {
      enemyMode.current = "watching";
      enemyModeTime.current = 0;
      setAnim("enemy", "SWORD_IDLE");
    } else if (enemyMode.current === "watching" || enemyMode.current === "approach") {
      if (distance > 2.45) {
        enemyMode.current = "approach";
        setAnim("enemy", "WALK");
        enemyPosition.current.addScaledVector(direction, delta * (distance > 6 ? 2.45 : 1.65));
      } else {
        enemyMode.current = "watching";
        setAnim("enemy", "SWORD_IDLE");
        if (enemyAiEnabled && enemyDecision.current <= 0) {
          enemyDecision.current = 1.05 + Math.random() * 0.55;
          enemyAttack.current = ENEMY_ATTACK_SEQUENCE[enemyAttackIndex.current % ENEMY_ATTACK_SEQUENCE.length];
          enemyAttackIndex.current += 1;
          setEnemyMode("attack", enemyAttack.current.animation);
        }
      }
    } else if (enemyMode.current === "attack") {
      const phase = phaseAt(enemyModeTime.current, enemyAttack.current);
      enemyHitboxActive.current = phase === "active" && enemyHealth.current > 0;
      if (phase === "windup" && enemyModeTime.current <= delta * 1.5) combatAudio.play("swing");
      if (phase === "windup" && distance > 1.05) enemyPosition.current.addScaledVector(direction, delta * enemyAttack.current.lunge);
      if (phase === "active" && enemyWeaponOverlap.current) attemptEnemyHit();
      if (phase === "none") setEnemyMode("recover", "SWORD_IDLE");
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
    camera.position.copy(cameraPosition.current);
    camera.lookAt(cameraLook.current);
    if (shake.current) {
      shake.current.elapsed += frameDelta;
      const sample = sampleHitShake(shake.current);
      camera.translateX(sample.x);
      camera.translateY(sample.y);
      camera.translateZ(sample.z);
      camera.rotateX(sample.pitch);
      camera.rotateY(sample.yaw);
      camera.rotateZ(sample.roll);
      if (shake.current.elapsed >= shake.current.profile.duration) shake.current = null;
    }

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
        maxWalkVel={3.6}
        maxRunVel={5.5}
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
        jumpVel={5.2}
        colliders={false}
        name="player"
      >
        <CapsuleCollider args={[0.42, 0.3]} name="player-collider" />
        <AnimatedFighter animation={playerAnimation} equipped={equipped.current} weaponRef={playerWeapon} />
      </Ecctrl>
      <WeaponHitbox weapon={playerWeapon} overlapsTarget={playerWeaponOverlap} targetName="arena-knight" active={playerHitboxActive} />
      <AnalogueSpeedLimiter
        controller={player}
        magnitude={moveMagnitudeRef}
        sprinting={sprintingRef}
        enabled={movementAllowedRef}
      />
      {enemyEnabled && (
        <>
          <RigidBody ref={enemyBody} type="kinematicPosition" colliders={false} position={ENEMY_START} name="arena-knight">
            <CapsuleCollider args={[0.42, 0.32]} />
            <AnimatedFighter animation={enemyAnimation} equipped enemy weaponRef={enemyWeapon} />
          </RigidBody>
          <WeaponHitbox weapon={enemyWeapon} overlapsTarget={enemyWeaponOverlap} targetName="player" active={enemyHitboxActive} />
        </>
      )}
    </>
  );
}

export function CombatScene() {
  const showHitboxes = useGameStore((state) => state.showHitboxes);
  return (
    <>
      <color attach="background" args={["#dceff4"]} />
      <fog attach="fog" args={["#dceff4", 20, 46]} />
      <ambientLight intensity={0.9} color="#ffffff" />
      <hemisphereLight intensity={1.25} color="#f8fdff" groundColor="#b8c5c2" />
      <directionalLight
        castShadow
        position={[7, 12, 6]}
        intensity={2.8}
        color="#fff8e8"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <Physics gravity={[0, -9.81, 0]} timeStep="vary" debug={showHitboxes}>
        <Arena />
        <Battle />
      </Physics>
    </>
  );
}
