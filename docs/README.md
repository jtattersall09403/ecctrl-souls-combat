# Docs index

Modular notes for agents working on this combat sandbox. **Read this file first**,
then open only the specific file you need — filenames are the map. Keep docs
short; treat them like code (DRY, one concern per file).

## What this project is

A **portable combat + character sandbox**. The goal is to prove fun, good-looking
Souls-like melee combat with Skyrim-derived visuals/animations, then lift the
*portable core* into a full game. Some things here are deliberately throwaway
(the stage/arena, intro screen, debug panel). The **core to keep** is the combat,
character, animation and movement architecture.

## Portability boundaries (what to keep vs throw away)

| Keep (portable core) | Throwaway (sandbox scaffolding) |
| --- | --- |
| `src/game/combat/*`, `src/game/anim/*`, `src/game/physics/*` | `Arena.tsx`, intro screen, debug HUD/panel |
| `SkyrimFighter` actor + animation manifest | enemy spawn layout, arena lighting |
| `PlayerMovementController` boundary | |

## Map

| File | Topic |
| --- | --- |
| [animation-quality-playbook.md](animation-quality-playbook.md) | Start here before implementing or debugging animation quality |
| [architecture/character-actor.md](architecture/character-actor.md) | The Skyrim character actor + GLB |
| [architecture/movement-boundary.md](architecture/movement-boundary.md) | Controller-independent movement boundary |
| [architecture/animation-contract.md](architecture/animation-contract.md) | Manifest-driven semantic animations |
| [architecture/movement-speed-tuning.md](architecture/movement-speed-tuning.md) | Where to edit travel speed vs animation playback speed for locomotion/dodges |
| [assets/rebuilding-the-character.md](assets/rebuilding-the-character.md) | Rebuild the character GLB from Skyrim source |
| [assets/animation-source-audit.md](assets/animation-source-audit.md) | Selected Skyrim clips, external-source provenance, and audition results |
| [validation/production-visual-scenarios.md](validation/production-visual-scenarios.md) | Repeatable browser scenes that exercise production input/combat/rendering |

## Non-negotiables

- The project owner has authorized the built runtime character and weapon GLBs
  in `public/` for this personal GitHub Pages deployment. Original archives,
  NIF/HKX/DDS extraction trees, pipeline outputs, and validation evidence remain
  local and gitignored. This is not blanket permission to add other source assets.
- The game references **semantic** animation names only (`IDLE`, `ROLL`,
  `LIGHT_1`, …) — never Bethesda filenames.
- Animation work starts with
  [animation-quality-playbook.md](animation-quality-playbook.md); do not repeat
  the source-selection/timing/grounding/paired-action trial-and-error it records.
- Combat/animation/input/lock-on code depends on `PlayerMovementController`,
  not on ecctrl directly.
