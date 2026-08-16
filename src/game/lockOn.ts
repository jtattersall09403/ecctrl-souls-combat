export function lockOnYaws(
  player: { x: number; z: number },
  target: { x: number; z: number },
) {
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const length = Math.hypot(dx, dz) || 1;
  const x = dx / length;
  const z = dz / length;
  return {
    playerFacingYaw: Math.atan2(x, z),
    cameraYaw: Math.atan2(-x, -z),
  };
}
