export const CHARACTER_CAPSULE_HALF_HEIGHT = 0.42;
export const CHARACTER_CAPSULE_RADIUS = 0.3;
export const CHARACTER_FLOAT_HEIGHT = 0.18;
export const CHARACTER_BODY_CENTER_HEIGHT = CHARACTER_CAPSULE_HALF_HEIGHT + CHARACTER_CAPSULE_RADIUS + CHARACTER_FLOAT_HEIGHT;
export const CHARACTER_MODEL_OFFSET = -CHARACTER_BODY_CENTER_HEIGHT;

export const BASE_JUMP_VELOCITY = 5.2;
export const JUMP_GRAVITY_SCALE = 2;
export const JUMP_VELOCITY = BASE_JUMP_VELOCITY * Math.sqrt(JUMP_GRAVITY_SCALE);
export const FALLING_GRAVITY_SCALE = 3;

export function jumpApexHeight(velocity: number, gravityScale: number, gravity = 9.81) {
  return velocity * velocity / (2 * gravity * gravityScale);
}

export function jumpApexTime(velocity: number, gravityScale: number, gravity = 9.81) {
  return velocity / (gravity * gravityScale);
}
