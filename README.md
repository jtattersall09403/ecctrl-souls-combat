# Ashen Ring — ecctrl Souls combat prototype

A compact browser combat sandbox built on [ecctrl](https://github.com/pmndrs/ecctrl), React Three Fiber, Three.js, and Rapier. It is designed to run on desktop browsers, touch devices, and standard Gamepad API controllers including the GameSir X2s Type-C.

## Included combat systems

- lock-on camera and unlocked orbit camera
- stamina-gated attacks, sprinting, blocking, parrying, and dodging
- roll invulnerability frames, attack windup/active/recovery phases, hit-stop, and camera shake
- one-handed straight-sword light chain, heavy attack, and parry riposte
- guard stability, chip damage, guard break, hit reactions, healing, death, and reset
- one enemy with spacing, approach, telegraph, active attack, recovery, stagger, parried, and death states
- equip/unequip state with a data-defined weapon moveset
- ecctrl mannequin locomotion and combat animation graph
- keyboard/mouse, responsive touch UI, and GameSir/Nintendo-layout controls

## Controls

| Action | Keyboard / mouse | Nintendo-layout controller |
| --- | --- | --- |
| Move / camera | WASD / drag right side | Left stick / right stick |
| Light / heavy attack | Mouse 1 / R | R / ZR |
| Guard / parry | Mouse 2 / F or Mouse 3 | L / ZL |
| Dodge / sprint | Tap / hold Space | Tap / hold B |
| Lock on | Q | R stick click |
| Estus | H | X |
| Equip / unequip | E | D-pad right |

Gamepad mappings use standard Gamepad API **physical button positions**. The GameSir X2s Type-C uses Nintendo-style ABXY caps; the bottom face button is displayed as B.

## Development

Requires Node 22+.

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run typecheck
npm run build
```

## Extending weapons and movesets

Combat data lives in `src/game/weapon.ts`. `WeaponDefinition` separates timing, stamina, damage, reach, arc, lunge, hit-stop, and animation identifiers from the combat controller. Add a weapon definition and matching animation graph entries in `AnimatedFighter.tsx`; no enemy-AI or input rewrite is required.

The arena, HUD, input adapter, animation model, and combat rules are separate components so the controller and combat package can be moved into another Three.js setting.

## GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` tests and builds `main`, then publishes `dist`. In repository **Settings → Pages**, select **GitHub Actions** as the source.

## Asset attribution

The build fetches `AnimationLibrary.glb` from a pinned revision of the MIT-licensed ecctrl repository by Erdong Chen. See `THIRD_PARTY_NOTICES.md`.
