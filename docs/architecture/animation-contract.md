# Animation contract

The game speaks in **semantic** animation states (`src/game/core/types.ts`
`AnimationState`): `IDLE`, `WALK`, `WALK_BACK`, `STRAFE_LEFT/RIGHT`, `RUN`,
`SPRINT`, jump trio, `LIGHT_1/2/3`, `HEAVY`, `HEAVY_2`, `ROLL`, `BACKSTEP`,
`GUARD`, `PARRY`, `RIPOSTE`, `BACKSTAB`, `BACKSTABBED`, reactions, `HEAL`,
`EQUIP`/`UNEQUIP`, `GET_UP`, `DEATH`.

## Manifest-driven

`src/game/anim/animationManifest.ts` loads
`character-dunmer-combat.animations.json` (emitted by the asset pipeline). Per
state it exposes `looping`, `playbackRate`, `rootMotion` policy, `sourceDuration`
and `rootMotionDelta`, plus the rig sockets and recommended scale.

The mapping from a semantic state to any Bethesda source clip lives **only** in
the pipeline. To reskin an animation (e.g. a nicer `ROLL`), change the pipeline
manifest and rebuild the GLB — no game-code change.

## Combos

`LIGHT_1/2/3` are three distinct clips forming the light chain (and `HEAVY`,
`HEAVY_2`). The combo/queue timing is combat logic in
`src/game/combat/weapon.ts`; the actor just plays whichever state it is told,
timed by the gameplay action clock.

## Timing rule

When a clip's natural length differs from the gameplay action window, adjust
**animation playback** (rate / clip-time normalisation) — do not retune combat
damage, stamina, i-frames or hit windows to match art.
