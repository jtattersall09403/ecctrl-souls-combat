# Ashen Ring — ecctrl Souls combat prototype

A compact browser combat sandbox built on [ecctrl](https://github.com/pmndrs/ecctrl), React Three Fiber, Three.js, and Rapier. It is designed to run on desktop browsers, touch devices, and standard Gamepad API controllers including the GameSir X2s Type-C.

## Play

**[Play Ashen Ring in your browser](https://jtattersall09403.github.io/ecctrl-souls-combat/)**

The Pages build is published from `main`. Desktop and mobile browsers load the same URL.

## Included combat systems

- lock-on camera and unlocked orbit camera
- stamina-gated attacks, sprinting, blocking, parrying, and dodging
- roll invulnerability frames, attack windup/active/recovery phases, hit-stop, and camera shake
- one-handed straight-sword three-hit light chain, two-hit heavy chain, parry riposte, and positional backstab
- guard stability, chip damage, guard break, hit reactions, healing, death, and reset
- one enemy with spacing, approach, telegraph, active attack, recovery, stagger, parried, and death states
- equip/unequip state with a data-defined weapon moveset
- ecctrl mannequin locomotion and combat animation graph
- keyboard/mouse, responsive touch UI, and GameSir/Nintendo-layout controls

## Controls

| Action | Desktop | Mobile touchscreen | Mobile + GameSir X2s |
| --- | --- | --- | --- |
| Move | WASD or arrow keys | Left virtual stick | Left stick |
| Camera | Drag the right side | Drag the right side | Right stick |
| Light attack | Mouse 1 | R button | R |
| Heavy attack | R key | ZR button | ZR |
| Guard | Mouse 2 | L button | L |
| Parry | F or Mouse 3 | ZL button | ZL |
| Dodge | Tap Space | Tap B | Tap B |
| Sprint | Hold Space while moving | Hold B while moving | Hold B while moving |
| Jump | J | A button | Left-stick click (L3) |
| Lock on/off | Q | R3 button | Right-stick click (R3) |
| Use Estus | H | X button | X |
| Equip/unequip sword | E | → button | D-pad right |
| Backstab | Light attack close behind enemy | R close behind enemy | R close behind enemy |
| Riposte | Light attack after a successful parry | R after a successful parry | R after a successful parry |

Gamepad mappings use standard Gamepad API **physical button positions**. The GameSir X2s Type-C uses Nintendo-style ABXY caps; the bottom face button is displayed as B.

Press light attack again during a light attack's recovery to continue the three-hit chain. Press heavy attack again during heavy recovery to continue the two-hit chain. Each combo step has its own animation, timing, stamina cost, and damage.

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
