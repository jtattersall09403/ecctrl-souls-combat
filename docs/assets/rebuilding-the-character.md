# Rebuilding the character

The character GLB is **built locally** from owned Skyrim source by the sibling
repo `elder-scrolls-asset-pipeline` and is **never committed** (it is
Bethesda-derived; this repo is public).

## Build + install

```bash
cd ../elder-scrolls-asset-pipeline
python3 -m pipeline.build    --character dunmer-combat
python3 -m pipeline.validate --character dunmer-combat

cp output/character-dunmer-combat.glb            ../ecctrl-souls-combat/public/
cp output/character-dunmer-combat.animations.json ../ecctrl-souls-combat/src/game/anim/
```

- The `.glb` lands in `public/` (gitignored).
- The `.animations.json` manifest is committed (metadata only — no Bethesda
  bytes) and is the game's runtime animation contract.

## Adding a race / swapping a clip

Both are pipeline changes, not game changes:

- **New humanoid race** (Nord, Redguard, …): add a `races/<id>.json` + curated
  texture tree in the pipeline; reuse the same body / rig / animation manifest.
- **Swap an animation** (e.g. a modded roll): change the source in the pipeline's
  `config/animations/*.json` and rebuild. The game keeps using `ROLL`.

See the pipeline's own `README.md` for the full data-driven config layout.
