export const CHARACTER_CAPSULE_HALF_HEIGHT = 0.42;
export const CHARACTER_CAPSULE_RADIUS = 0.3;
export const CHARACTER_FLOAT_HEIGHT = 0.18;
export const CHARACTER_BODY_CENTER_HEIGHT = CHARACTER_CAPSULE_HALF_HEIGHT + CHARACTER_CAPSULE_RADIUS + CHARACTER_FLOAT_HEIGHT;
export const CHARACTER_MODEL_OFFSET = -CHARACTER_BODY_CENTER_HEIGHT;
export const CHARACTER_RAY_RADIUS = CHARACTER_CAPSULE_RADIUS / 2;

// Ecctrl's grounded threshold is its suspension target plus this forgiveness.
// Keep it small so the controller can prepare its spring without reporting a
// landing while the visible soles are still noticeably above the support.
export const CHARACTER_RAY_HIT_FORGIVENESS = 0.015;
export const CHARACTER_SPRING_K = 92;
// A density-1 Rapier capsule at these dimensions weighs about 0.3506 kg, so
// 2 * sqrt(km) is about 11.36. Slightly rounding up prevents the suspension
// from bouncing the rendered feet through the floor after a fast descent.
export const CHARACTER_DAMPING_C = 11.5;

export const JUMP_IMPULSE_DURATION = 1 / 60;

export const BASE_JUMP_VELOCITY = 5.2;
// Increasing velocity by sqrt(gravityScale) preserves the apex height while
// shortening the ascent. A stronger fall scale gives the arc a decisive drop.
export const JUMP_GRAVITY_SCALE = 3;
export const JUMP_VELOCITY = BASE_JUMP_VELOCITY * Math.sqrt(JUMP_GRAVITY_SCALE);
export const FALLING_GRAVITY_SCALE = 4;
export const JUMP_START_SOURCE_DURATION = 1.3333333730697632;
// Finish the authored takeoff exactly at the ballistic apex, where its final
// pose matches the first frame of Jump_Loop.
export const JUMP_START_DURATION = JUMP_VELOCITY / (9.81 * JUMP_GRAVITY_SCALE);
export const JUMP_START_PLAYBACK_RATE = JUMP_START_SOURCE_DURATION / JUMP_START_DURATION;
export const JUMP_LAND_SOURCE_DURATION = 1.2666666507720947;
export const JUMP_LAND_DURATION = 0.42;
export const JUMP_LAND_PLAYBACK_RATE = JUMP_LAND_SOURCE_DURATION / JUMP_LAND_DURATION;

export function jumpApexHeight(velocity: number, gravityScale: number, gravity = 9.81) {
  return velocity * velocity / (2 * gravity * gravityScale);
}

export function jumpApexTime(velocity: number, gravityScale: number, gravity = 9.81) {
  return velocity / (gravity * gravityScale);
}
