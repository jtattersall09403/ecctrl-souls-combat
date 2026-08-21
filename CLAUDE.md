# CLAUDE.md

Guidance for AI agents working in this repo. Keep it lean — this file is loaded
into every agent's context. Detail lives in [docs/](docs/README.md); link, don't
duplicate.

## What this is

A **combat + character sandbox**, private/personal. It exists to prove that
Souls-like melee combat and the character/animation systems can be made **fun**
and **good-looking** before the proven core is lifted into a full game in a new
repo.

The eventual game: a new Elder Scrolls title set in Argonia/Black Marsh —
TES3 Morrowind as primary inspiration, **Dark Souls combat**, **Skyrim visuals**
(and Skyrim/Morrowind hybrid magic), plus climbing/traversal. None of that world
is built here; this is only the combat/character proving ground.

## Golden rules

- **Plan for portability.** Remember our goals above: we are using this repo as a sandbox to develop systems that will then be lifted into the 'real' game. This repo is not the real game. So whatever you are doing, separate out in your mind things that are intended to be taken forward into the real game and things that will be discarded. Architect your work accordingly. This can include restructuring aspects of the repo/folder structure: don't **assume** that an existing structure or way of working is correct just because it's there, you may be inheriting a previous agent's poor architecture decisions. If something should be changed to improve portability, do it.
- **Plan for scaling**. The final game will eventually be very big, with many systems, objects, playable races, animations, quests, factions, stats, UI screens, etc etc etc - on the scale of Skyrim or Morrowind. So whatever you are doing, do it in a way that will scale *effectively*, *efficiently* and with *minimal context bloat* for future agents. As above, you may inherit poor previous decisions on this - you can fix them as you go. e.g. if you're working on weapons and you find that the current way of architecting weapons data will scale poorly to Morrowind/Skyrim level, don't just continue with it because it's there - rearchitect it and improve it as you go.
- **Plan for agentic coding.** Assume that this repo and the broader game we are aiming to build will be almost entirely coded by coding agents, most of whom will be starting from fresh context. It is essential that we make our repo(s) modular, easy and *efficient* to navigate for coding agents. We need to ensure we don't have lots of clashing documents or instructions, and that agents neither need to read huge amounts of context to work effectively nor miss important context they genuinely need for their task. I don't know what else to think of so you should do the thinking - "how do I do my work in such a way as to maximise the chances that future work will be able to continue smoothly and efficiently for other agents picking up bits of this project?"
- **Fix root causes.** If you're fixing bugs, find the root cause and fix it, don't do sticking plasters.
- **Prevent context bloat.** Read only what you need; docs are modular so filenames are the map. Whatever you are doing, consider how to do it in a way that prevents context bloat and keeps future agents able to run in a token-efficient way, processing what they need and only what they need.
- **Game played from github pages.** The game will be built from github actions and played in the browser at github pages. So the code must work for that context. e.g. make sure animation files that are needed in the game are included.
- **Semantic animations only.** Game code references states (`IDLE`, `ROLL`,
  `LIGHT_1`, …), never Bethesda filenames. Reskinning a clip is a pipeline rebuild.
- **Read the animation playbook first.** Before adding, replacing, retiming, or
  debugging animation output, follow
  [docs/animation-quality-playbook.md](docs/animation-quality-playbook.md). It
  records the fast pipeline-first workflow and the source/timing/ownership/
  grounding/transition failure modes already solved here.
- **Controller-independent.** Combat/input/lock-on/animation depend on
  `PlayerMovementController`, not ecctrl directly (ecctrl is behind `EcctrlAdapter`). This is so we can easily change the controller later if we need to
- **Don't casually retune gameplay** (damage, stamina, i-frames, hit/parry windows,
  speeds) unless asked to. Fix visual/animation timing on the animation side instead.
- **Visual changes require owner review.** For work that changes appearance or motion, generate the production-path videos/GIFs and frame evidence, but do **not** spend agent tokens visually ingesting them unless the project owner explicitly asks. Automated probes may reject a result but cannot grant qualitative approval. Hand the project owner the exact absolute paths to the generated `review.html` dashboard and `holistic-review.md` form, name the scenarios/actions to inspect, and describe the concrete defects or acceptance questions to look for. The owner is the visual authority.
- **Keep animation validation green.** After anything that could affect animation selection, timing, attachment, physics, or rendering, run `npm run visual:test` and fix all automated/probe failures. Then stop for project-owner visual review. The owner watches every normal-speed recording/GIF, action close-up, dense run strip, and transition strip and records timestamped observations, rationales, checklist marks, and verdicts in the generated `holistic-review.md`. Agents must not fill or invent those judgments; they may only transcribe results the owner explicitly supplies. Once the owner has completed an unequivocal `PASS`, run `npm run visual:review:check` and `npm run visual:review:attest`, then commit `visual-review-attestation.json`. CI and deploy reject inputs that differ from that human-reviewed fingerprint. Details: [docs/validation/production-visual-scenarios.md](docs/validation/production-visual-scenarios.md).
- **Research known solutions.** We aren't working on something particularly unique or unusual. For any task, decide if it would be worth researching online to find if there are already known-good or proven solutions, or whether the thing you're doing is simple enough that you can just get straight to it. If it would be worth researching, first check the filenames in docs/ and it's sub-folders to see if any other agent has done the research already. If yes, read it, then think about whether further research is necessary or if you now have what you need. If you do need to do further online research, do it, and record key findings in docs/ . Use and create sub-directories as appropriate, and remember that future agents will go off filenames when deciding whether to read a doc you've written.

## Assets

Game assets are built from owned Skyrim data by the
sibling repo `../elder-scrolls-asset-pipeline` and copied into `public/`
(the runtime character and weapon GLBs are intentionally versioned so a clean
GitHub Pages checkout works). Source archives, extracted assets, pipeline
outputs, and validation recordings stay gitignored. To rebuild/replace, see
[docs/assets/rebuilding-the-character.md](docs/assets/rebuilding-the-character.md).

## Commands

```bash
npm run dev         # playtest
npm run typecheck   # tsc -b
npm test            # vitest
npm run build       # tsc -b && vite build
npm run visual:test # all production animation scenes + review bundle
npm run visual:review:check # validate the owner's completed review form
npm run visual:review:attest # bind that reviewed run to current source inputs
npm run visual:review:attestation:check # reject stale/missing attestation
```

## Map

Start at [docs/README.md](docs/README.md). When you work, always think about whether something you have changed means the docs should be changed or updated. If you're editing a doc, don't think you have to just append - this will lead to context bloat. You can edit, delete and overwrite as well.
