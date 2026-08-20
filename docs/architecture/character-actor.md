# Character actor

`src/components/SkyrimFighter.tsx` renders a Skyrim-derived character from a
single pipeline-built GLB. It replaced the old Rigify mannequin actor and carries
**none** of its coupling (no `DEF-*` bone lookups, procedural posing, or runtime
root-motion stripping — that is resolved in the asset pipeline).

## What it does

- Loads `public/character-dunmer-combat.glb` (gitignored; see
  [../assets/rebuilding-the-character.md](../assets/rebuilding-the-character.md)).
- Its GLB actions are already named with **semantic** game states, so playback is
  `actions[state]` with no name mapping.
- Plays clips from an `AnimationCommand` with cross-fades; combat states are
  driven by the gameplay action clock (`animationTimeRef`) so the visual never
  runs ahead of the combat state machine. Locomotion is mixer-driven and
  self-timed (see `LOCOMOTION_STATES` in `animationManifest.ts`).
- Reads per-clip `looping` / `playbackRate` from the animation manifest, plus an
  optional `speedMultiplierRef` the caller can nudge every frame on top of that
  (used for lock-on strafe/walk speed matching).

## Scale + ground contact

The GLB carries the rig's internal 0.1 scale; the actor scales the whole clone by
`CHARACTER_SCALE` (≈0.15, from the manifest) to reach ~1.85 m.

`CHARACTER_MODEL_OFFSET` (from the capsule's physical dimensions) is only a
**base** offset. It assumes the model's own local origin sits at foot height,
which does not hold exactly for this rig, and no single fixed offset holds across
every clip anyway (a landing crouch or a stagger dips lower than a resting idle).
Instead, every frame the actor samples the world Y of the rig's foot/toe bones
(`SOLE_BONE_NAMES` — GLTFLoader's *sanitized* form of names like
`NPC Foot [ft ].L`, i.e. `NPC_Foot_ft_L`; three.js strips spaces/brackets/dots
from `Object3D.name` on load) and nudges the whole model up/down so the lowest
one always sits exactly on the physics ground plane, smoothed over ~50 ms so
nothing pops on a cross-fade. This replaced a dead, Rigify-era foot-contact
calibration (`src/game/anim/footContact.ts`'s `CALIBRATED_SOLE_MARKERS` /
`JUMP_SOLE_CALIBRATION`) that referenced bones this rig doesn't have and was
never actually wired into the renderer after the migration; that module is now
unused and should be removed as part of any follow-up port to the new sole
tracking.

## Weapon

The extracted Skyrim steel sword is a separate static GLB mounted on a rig
socket and counter-scaled for the rig's baked scale. Its asset path and both
socket-local transforms live once in `WeaponDefinition.visual`, not in the
actor or individual actions. Its own local +Z is the blade axis with the grip
at the origin — but **the socket does not attach at identity**. The rig's socket bones
(`Weapon` on the hand, `WeaponSword` on the hip) are Havok-derived leaf bones
whose Blender bone-roll convention does not match the standalone mesh's axes
(confirmed headlessly: across five different animated poses the required
correction was consistently close to the documented PyNifly 90° convention,
with additional roll from this pipeline's Blender-friendly transform. Each
socket therefore carries its own fixed corrective quaternion, measured against pose-independent anatomy
references (finger-root spread for the hand, gravity for the hip) rather than
assumed. If a future weapon or socket needs the same treatment, re-derive its
correction the same way — don't assume identity.

Animated Blender validation covered `SWORD_IDLE`, `WALK`, `SPRINT`, `GUARD`,
`PARRY`, `LIGHT_1`, `HEAVY`, and `ROLL`; the hilt remains seated in the closed
fist throughout. The sword also switches which socket it rides:

- Equipped combat states → the hand socket, blade forward.
- Unequipped idle → the hip sheath socket, stowed instead of hidden.
- `EQUIP`/`UNEQUIP` switch socket **partway through the clip** (`EQUIP_GRAB_PROGRESS`
  / `UNEQUIP_STOW_PROGRESS`), roughly matching when the animated hand reaches the
  hip, instead of snapping the sword to its final socket at the state boundary.

The combat hitbox reads the sword's world transform (`weaponRef`), so it is
independent of the visual mesh and unaffected by which socket the sword is
currently riding (only equipped combat states ever arm the hitbox).
