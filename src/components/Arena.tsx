import { Instances, Instance, Sparkles } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";

function RingMarkings() {
  const rings = [3.4, 6.8, 10.2];
  return (
    <group position={[0, 0.025, 0]}>
      {rings.map((radius) => (
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <ringGeometry args={[radius - 0.035, radius + 0.035, 96]} />
          <meshStandardMaterial color="#554a3d" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function Arena() {
  const pillarPositions: [number, number, number][] = [];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    pillarPositions.push([Math.sin(angle) * 12.5, 1.55, Math.cos(angle) * 12.5]);
  }
  return (
    <group>
      <RigidBody type="fixed" colliders={false} friction={1}>
        <CuboidCollider args={[15, 0.15, 15]} position={[0, -0.15, 0]} />
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[15, 96]} />
          <meshStandardMaterial color="#292723" roughness={0.94} metalness={0.03} />
        </mesh>
      </RigidBody>
      <RingMarkings />
      <Instances limit={12} castShadow receiveShadow>
        <cylinderGeometry args={[0.52, 0.66, 3.1, 10]} />
        <meshStandardMaterial color="#36332e" roughness={0.9} />
        {pillarPositions.map((position, index) => (
          <Instance key={index} position={position} rotation={[0, (index * 0.71) % Math.PI, index % 3 === 0 ? 0.04 : 0]} />
        ))}
      </Instances>
      <Instances limit={12} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.22, 1.25]} />
        <meshStandardMaterial color="#45413a" roughness={0.95} />
        {pillarPositions.map(([x, , z], index) => (
          <Instance key={index} position={[x, 3.11, z]} rotation={[0, index * 0.22, 0]} />
        ))}
      </Instances>
      <Sparkles count={38} scale={[25, 5, 25]} position={[0, 2, 0]} size={1.2} speed={0.08} opacity={0.18} color="#c7a66a" />
      <mesh position={[0, -0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[40, 64]} />
        <meshBasicMaterial color={new THREE.Color("#090a0b")} />
      </mesh>
    </group>
  );
}
