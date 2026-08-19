# Character actor

`src/components/SkyrimFighter.tsx` renders a Skyrim-derived character from a
single pipeline-built GLB. It replaced the old Rigify mannequin actor and carries
**none** of its coupling (no `DEF-*` bone lookups, procedural posing, foot-contact
solve, weapon IK or runtime root-motion stripping).

## What it does

- Loads `public/character-dunmer-combat.glb` (gitignored; see
  [../assets/rebuilding-the-character.md](../assets/rebuilding-the-character.md)).
- Its GLB actions are already named with **semantic** game states, so playback is
  `actions[state]` with no name mapping.
- Plays clips from an `AnimationCommand` with cross-fades; combat states are
  driven by the gameplay action clock (`animationTimeRef`) so the visual never
  runs ahead of the combat state machine. Locomotion is mixer-driven.
- Reads per-clip `looping` / `playbackRate` from the animation manifest.

## Scale + placement

The GLB carries the rig's internal 0.1 scale; the actor scales the whole clone by
`CHARACTER_SCALE` (≈0.15, from the manifest) to reach ~1.85 m, and offsets it by
`CHARACTER_MODEL_OFFSET` so the feet sit at the controller's float point.

## Weapon

The stand-in sword mounts on the rig's **native `WeaponSword` socket** (see
`RIG_SOCKETS`), counter-scaled for the rig scale. Swapping in an extracted Skyrim
sword mesh later is a drop-in: build the mesh, parent it to the same socket, keep
the hitbox (`weaponRef`) semantics. The combat hitbox reads the sword's world
transform, so it is independent of the visual mesh.
