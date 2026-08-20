# Animation contract

The game speaks in **semantic** animation states (`src/game/core/types.ts`
`AnimationState`): `IDLE`, `WALK`, `WALK_BACK`, `STRAFE_LEFT/RIGHT`, `RUN`,
`SPRINT`, jump trio, `LIGHT_1/2/3`, `HEAVY`, `HEAVY_2`, `ROLL`, `BACKSTEP`,
`GUARD`, `PARRY`, `RIPOSTE`, `RIPOSTED`, `BACKSTAB`, `BACKSTABBED`, reactions, `HEAL`,
`EQUIP`/`UNEQUIP`, `GET_UP`, `DEATH`.

## Manifest-driven

`src/game/anim/animationManifest.ts` loads
`character-dunmer-combat.animations.json` (emitted by the asset pipeline). Per
state it exposes `looping`, `playbackRate`, `rootMotion` policy, `sourceDuration`
and `rootMotionDelta`, plus the rig sockets and recommended scale.

The mapping from a semantic state to any Bethesda source clip lives **only** in
the pipeline. To reskin an animation (e.g. a nicer `ROLL`), change the pipeline
manifest and rebuild the GLB — no game-code change.

`rootMotion: "strip"` vs `"consume"` in the manifest is currently **informational
only** — `rootMotionDelta` is recorded but never read at runtime; every clip's
root bone curve is unconditionally removed at build time regardless of this
label. Two pipeline flags (on the animation config entry, not the manifest) are
the ones that actually change build behaviour:

- `preserveRootMotion` skips stripping entirely, for stationary loops (`IDLE`,
  `SWORD_IDLE`, `GUARD`) whose authored root sway keeps the feet planted —
  stripping a net-zero-but-oscillating curve anyway freezes the torso while the
  untouched leg curves still slide the feet.
- `preserveVerticalRootMotion` strips only the horizontal (X/Z) root curves and
  keeps vertical (local Y, this rig's world-up axis — see
  `VERTICAL_LOCAL_AXIS` in `build_character.py`), for clips whose *authored
  height change* is the point and shouldn't be flattened even though the
  controller still owns horizontal travel: `ROLL`/`BACKSTEP` (the dive/hop
  tuck), `DEATH`/`HIT_HEAVY`/`BACKSTABBED` (the collapse), `GET_UP` (the rise).
  Stripping the vertical component here was the root cause of the character
  sinking into the ground mid-roll and reactions looking frozen partway to the
  floor — the pelvis stayed at standing height while the (unchanged) limb
  curves animated a body that should have been dipping or lying down.

`LOCOMOTION_STATES` (mixer-driven, self-timed) includes the jump family
(`JUMP_START`/`JUMP_IDLE`/`JUMP_LAND*`) even though takeoff and landings are
one-shot, not looping. Jumping isn't a `CombatAction`, so the shared
`playerActionTime`/`actionTime` clock keeps free-running while airborne instead
of resetting at takeoff; driving a clip from that stale clock clamps it to its
last frame from the very first rendered frame. Self-timing sidesteps that
entirely — don't move a state out of `LOCOMOTION_STATES` unless its combat
action clock is actually reset at entry.

## Weapon-type scalability

Every weapon-specific animation is data on `WeaponDefinition.animations`
(`src/game/combat/weapon.ts`): combat idle/sprint override, guard enter/loop/hit
variants, two-stage parry, light/heavy actions, guard break, equip, and paired
critical actions. A critical profile also owns victim action, alignment,
separation, facing, damage point, release point, and root-motion policy. Combat
logic reads that profile rather than equating `GUARD` or `BACKSTAB` with one-
handed swords forever. Actually selecting a different definition per fighter
(today all actors use `STRAIGHT_SWORD`) remains a future inventory step.

Paired critical actions start attacker and victim animation commands together.
The sword profile stores the audited physical separation, relative facing,
victim anchor, contact progress, release progress, and horizontal-root-motion
policy. The #74453 paired HKX supplies both `BACKSTAB` and `BACKSTABBED`; Rim
supplies distinct `RIPOSTE` and `RIPOSTED` clips. Combat damage is gated at the
rendered blade-contact timestamp, and the physical actors remain controller-
anchored until the rendered withdrawal timestamp.

The external action clock is rebased whenever a command changes mid-action.
This permits sequences such as `PARRY` → `PARRY_FOLLOW_THROUGH` and
`GUARD_ENTER` → looping `GUARD` without resetting the gameplay parry/guard
clock or clamping the second clip to its last frame.

## Moving landings

Touchdown records controller planar velocity and peak downward velocity.
`selectLandingAnimation` classifies stationary/moving/sprint/hard landings and
chooses a duration. The neutral vanilla compression is accelerated to 0.20 s
while moving and 0.16 s at sprint speed, then crossfades directly to locomotion;
the controller keeps full horizontal authority throughout. Vanilla
`mt_jumplandleft/right` are present in the GLB for comparison but are not
runtime-selected: animated audition showed authored quarter-turns that fight
controller facing.

## Combos

`LIGHT_1/2/3` are three distinct clips forming the light chain (and `HEAVY`,
`HEAVY_2`). The combo/queue timing is combat logic in
`src/game/combat/weapon.ts`; the actor just plays whichever state it is told,
timed by the gameplay action clock.

## Timing rule

When a clip's natural length differs from the gameplay action window, adjust
**animation playback** (rate / clip-time normalisation) — do not retune combat
damage, stamina, i-frames or hit windows to match art.

The reverse mistake also happens: a *fixed* gameplay duration (`ACTION_DURATIONS`
in `src/game/combat/tuning.ts`) shorter than the clip's actual `sourceDuration`
cuts the animation off mid-motion (this happened to `EQUIP`/`UNEQUIP`, both
fixed at ~0.6s against 2-2.9s clips). Prefer deriving the duration from
`clipConfig(...).sourceDuration` over a hand-picked constant for any action
whose whole point is to play a specific animation to completion.
