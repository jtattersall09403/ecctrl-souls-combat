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
| [architecture/character-actor.md](architecture/character-actor.md) | The Skyrim character actor + GLB |
| [architecture/movement-boundary.md](architecture/movement-boundary.md) | Controller-independent movement boundary |
| [architecture/animation-contract.md](architecture/animation-contract.md) | Manifest-driven semantic animations |
| [assets/rebuilding-the-character.md](assets/rebuilding-the-character.md) | Rebuild the character GLB from Skyrim source |

## Non-negotiables

- **Repo is public.** Never commit Bethesda-derived assets (GLB/NIF/HKX/DDS).
  They are gitignored and built locally.
- The game references **semantic** animation names only (`IDLE`, `ROLL`,
  `LIGHT_1`, …) — never Bethesda filenames.
- Combat/animation/input/lock-on code depends on `PlayerMovementController`,
  not on ecctrl directly.
