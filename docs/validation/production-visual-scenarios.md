# Production animation validation

This is the standing regression gate for animation-affecting work. It drives
the shipped `InputController` → intent → combat FSM → physics/hitboxes →
animation commands/clocks → `SkyrimFighter` → production camera/HUD path. The
scenario layer supplies only deterministic setup and inputs; it does not copy
combat or animation behavior into a second viewer.

Run the full gate whenever an animation asset, manifest, state/timing rule,
movement/physics rule, weapon attachment, actor renderer, or camera change can
affect what a player sees:

```bash
npm run visual:test
# Project owner completes the generated holistic-review.md, then:
npm run visual:review:check
npm run visual:review:attest
# Commit visual-review-attestation.json with the reviewed change.
```

`visual:test` builds at the GitHub Pages base and captures every registered
scene. A capture always resets the qualitative review to `PENDING`; old review
text does not approve new pixels. `visual:review:check` accepts only an
unequivocal `PASS` at the run and every-scenario levels. `PASS WITH
PRESENTATION CAVEATS`, unchecked items, probe-only approval, and a no-video run
all fail.

For quick, non-approving diagnostics:

```bash
npm run visual:smoke
npm run visual:test -- backstab riposte roll
VISUAL_RUN_ID=before npm run visual:test -- roll
```

The stable gate aliases remain at `artifacts/visual-validation/latest/` and
`artifacts/visual-validation/smoke-latest/`. A named diagnostic such as
`before` is isolated under `artifacts/visual-validation/runs/before/`. When a
named run contains the complete suite, check or attest it explicitly with
`npm run visual:review:check -- before` or
`npm run visual:review:attest -- before`; partial diagnostics remain
non-approving.

Direct runner flags are `--headed`, `--hitboxes`, `--tiny`, `--no-video`, and
`--new-headless`. `VISUAL_TIMEOUT_MS` overrides the per-scene timeout. `--tiny`
and `--no-video` add `?fast=1`, which removes expensive presentation effects;
the normal recorded gate retains the production appearance.

## Evidence and assertions

Each scenario directory contains:

```text
<scenario>/
├── recording.webm          # complete scene, production simulation speed
├── normal-speed-review.gif # same pixels in a compact human-review format
├── action-closeup.webm     # action intervals only, centre-cropped/enlarged
├── motion-strips/          # every ordered rendered run, split into ≤1 s strips
├── transition-boundaries/  # every occurrence-aware adjacent handoff
├── contact-sheet.png       # full-scene overview, not the detailed evidence
├── recording-frame-map.json # each 30 Hz frame's real recorder-pixel provenance
├── capture-alignment.json  # decoded marker and rendered-boundary proof
├── final.png
├── telemetry.json
├── motion-analysis.json
└── evidence.json
```

`recording.webm` is rebuilt from slow software-render wall time on the game's
own 30 Hz scenario clock. Alignment authority lives in the captured pixels,
not an inferred recorder start time. During validation, the browser adds a
12 px recorder-only gutter above the unchanged 800×450 game viewport. A tiny
two-row binary code in that gutter is updated after combat, final actor
deformation, and the render-pose probes, but before R3F renders the frame. The
runner decodes every raw frame and requires an exact, unambiguous, monotonic
sequence from simulation frame 0 through the scenario end. Missing codes,
one-frame-old render probes at a semantic state boundary, a constant
pixel/telemetry offset, or nonchronological selections abort capture.

Each output instant selects the real raw pixel frame bearing that exact code;
there are no inferred wall-clock anchors, synthetic poses, or repeated-frame
guesses. `recording-frame-map.json` v2 records every decoded selection and
`capture-alignment.json` records the initial frame plus each semantic boundary.
The gutter is then cropped—not painted over—from the normal-speed WebM, final
screenshot, GIF, close-up, contact sheet, and all strips. Reviewed images are
therefore exactly the production 800×450 game region and cannot contain or be
occluded by the test marker. This removes non-uniform SwiftShader stalls and
bursts without inventing motion or duplicating game logic. The final WebM,
GIF, close-up, and strips show the complete scene at the speed a player
experiences and all remain derivatives of the same production pixels.
`normal-speed-review.gif` is a compact 15 fps derivative for convenient human
review; it is not a substitute renderer.

This is evidence format v6 (`recording-frame-map.json` v2). It replaced v5's
inferred `videoWallEnd - WebM duration` origin after a focused roll capture put
mid-`ROLL` pixels at output frame 0 while production telemetry did not enter
`ROLL` until simulation frame 16 (0.533 s). Review validators deliberately
reject all v5 bundles. A focused acceptance capture must show output/decoded
marker `0 → 0`, every semantic boundary `N → N`, and zero missing codes before
qualitative review begins.

Playwright page video samples at 25 Hz, while the validation/game clock is
30 Hz. Recorded runs therefore hold each fixed-step pose on screen for longer
than two 40 ms recorder periods so the recorder cannot skip a code; the
marker-driven rebuild removes that recorder-only delay. The hold starts at
presentation (a rAF after R3F's manual `advance`), not at the start of the
draw, so variable SwiftShader render time is outside the budget. An earlier
45 ms hold left only 5 ms of margin over one recorder period and lost roughly
one code per six recorded scenarios to screencast delivery jitter, aborting the
whole capture. `--no-video` smoke runs and ordinary gameplay do not use this
pacing.
Run strips retain every 30 Hz output frame in their window, each traceable to a
real recorder frame, so the strip generator cannot drop a selected pixel in a
second low-rate sampling pass. The
runner rebases the final recording's container timestamps to its decoded clock,
partitions long runs into balanced windows of at most one second, and tiles the
resolved source-frame ordinals directly. It fails instead of padding a declared
window when evidence is absent. Separate
transition strips retain both sides of every sampled command handoff, including
a same-semantic restart with a new command serial. This
prevents an action strip ending on its final crouched frame from hiding a pop
into idle on the next frame. Together they make short contacts, foot
penetration, pose pops, and one-frame jitter inspectable without duplicating
game code. Capture aborts if FFmpeg does not emit any declared strip, so an
evidence path can never stand in for a missing image.

The automated layer checks semantic actions and outcomes, then samples the
final deformed production skeleton and meshes. Current hard probes cover:

- actual mesh-to-support-plane gap (`supportY = 0`), including penetration;
- yaw-invariant actor world-up tilt for both actors (1° maximum), which rejects
  controller pitch/roll even when local animation curves and root height look
  correct;
- manifest-resolved support policy on the actual deformed mesh: upward-only
  penetration prevention for ordinary grounded clips, no pinning for airborne
  phases, and bidirectional visible-surface contact only for declared floor
  phases; correction range outside floor-contact, per-frame step, and speed
  remain hard gates, while declared floor-contact is judged by the rendered
  mesh-to-plane gap rather than the magnitude of its authored offset;
- bone quaternion step and angular jerk using `abs(dot(q1, q2))`, so equivalent
  quaternion signs cannot create false jitter;
- focused locomotion root-yaw step and signed angular-jerk checks, so an enemy
  controller that alternates or snaps its rigid-body facing while WALK/RUN is
  playing fails even when the limb clip itself is continuous;
- pelvis-relative per-bone position/vertical discontinuities with worst bone
  and timestamp, so physical actor launch/travel is not misclassified as limb
  jitter (world-space mesh/root support checks remain separate);
- one-shot source-time out-points, so a rejected animation tail cannot leak
  into a low-frame-rate transition;
- occurrence-specific rendered seam metrics declared by each scenario's
  `transitionMotionChecks`: pelvis-relative limb step, local bone rotation, and
  world-space weapon-tip step across the real post-handoff blend window;
- identical `JUMP_START` clip-time progression after idle versus run;
- real player/enemy sword-to-torso trajectories around backstab damage, which
  catches swapped GLB roles even when semantic names remain plausible;
- riposte phase order: stable `GUARD_BREAK` before contact, damage and a fresh
  `RIPOSTED_HIT1` source clock within one sampled frame, continuous playback
  through withdrawal, and no intervening idle/guard recovery;
- nonlethal and lethal riposte weapon geometry at that same damage/reaction
  frame: the explicitly declared attacker blade must reach the victim torso,
  the victim blade cannot take the attacker role, and an earlier close pass is
  rejected as an unacknowledged contact beat;
- a central-clip head/knee posture gate so `GUARD_BREAK` remains a standing
  stagger instead of a prolonged kneel;
- per-render-frame horizontal rigid-body separation in focused contact scenes,
  rejecting the old capsule-touching (~0.6 m) staging even if the expected
  block, parry, hit, or guard-break semantic event still fires;
- continuous nonlethal critical fall → declared floor-contact phase → authored
  get-up → standing recovery, plus lethal critical and ordinary-death checks
  that reach and hold the declared prone out-point without entering idle.

The ordinary support curve is not estimated from a foot-bone origin. The asset
build samples the final skinned body meshes at 30 Hz and writes each clip's
visible-surface envelope into the runtime manifest. For each foot/toe marker it
also bakes the nearby lowest visible point in that bone's local 3D frame. During
a material ground-bound crossfade, runtime transforms the incoming and outgoing
point candidates separately through the actual blended marker bone and uses the
lower result. This preserves heel/toe horizontal offset during rotation and
does not invent a midpoint between two different lowest vertices. The solve is
upward-only for ordinary penetration prevention, exact in a declared
`floor-contact` blend, and disabled for intentional `airborne` motion. Runtime
work remains constant per actor; full deformed-mesh bounds are sampled only by
this validation suite. `supportMode` in every visual frame is the policy
actually resolved by the game for that source time, so a mislabeled airborne or
floor phase cannot hide behind provenance text.

Probe results can fail the suite. They can never grant a qualitative `PASS`:
plausibility, weight, semantics, and holistic presentation still require the
project owner's direct visual judgment.

Motion limits must target the visible defect rather than a convenient number.
For example, a planted backstep foot legitimately moves relative to a pelvis
that performs the authored launch/landing crouches, so pelvis-relative foot
vertical speed is not a valid grounding gate. Its focused contract instead
keeps world-space mesh support and root-correction gates, then bounds selected
bone position step (0.40 m), angular step (30°), and angular jerk (20,000
deg/s²). Those limits reject the saved 1.79481× bad render while accepting only
the slower 1.2× full-source continuity; the normal-speed review still decides
whether its two crouches read as intentional takeoff and landing.

## Required project-owner review

Coding agents run the capture and automated checks, then hand the project owner
the exact absolute paths to `review.html` and `holistic-review.md`. They also
name the affected scenarios/actions and the concrete questions the owner should
check. Agents do not watch the evidence or fill qualitative fields unless the
owner explicitly requests that exception. They may faithfully transcribe
observations and verdicts the owner has already supplied.

The project owner opens `artifacts/visual-validation/latest/review.html` and
records results in the adjacent `holistic-review.md`. Each scenario section in
that form lists its normal-speed video/GIF, action close-up, strip directories,
individual artifact paths, and evidence windows. For every scenario:

1. Watch `recording.webm` once at normal speed—or the complete
   `normal-speed-review.gif`—before pausing, scrubbing, opening metrics, or
   viewing frame strips. A
   text-only inspection of filenames or telemetry is not review. Write a
   timestamped immediate observation.
2. Then watch `action-closeup.webm` and inspect every image in
   `motion-strips/` and `transition-boundaries/`, in checklist order. The latter
   spans every entry/exit boundary, including paired-action and same-semantic
   ownership handoffs. For **every** generated `Evidence item` id, write a
   timestamped observation, a first-principles rationale, and an unequivocal
   artifact verdict. Missing, stale, duplicate, or reordered item ids and
   copy-pasted, generic, or telemetry/probe-only artifact judgments fail; each
   entry must describe concrete visible body, weapon, ground, contact, or
   camera evidence.
3. Give separate timestamped scenario-level frame observation and rationale;
   neither may merely restate an expected clip name.
4. Check every generated rubric item: semantic read and roles; timing/weight;
   transitions; grounding/travel; pose continuity/jitter; weapon/body contact;
   camera/UI readability; and holistic game readiness.
5. Fill `Reviewer` with the project owner's name, leave `Reviewer type` as
   `HUMAN PROJECT OWNER`, fill `Reviewed at` with an ISO completion timestamp,
   set `Viewing order` to `NORMAL SPEED THEN FRAME LEVEL`, and use `PASS` only
   when every check is genuinely clean. The attestation command records the
   resulting overall `PASS` in `run.json`; the owner does not edit JSON.

Timestamped observations must say what is visible and why it is or is not
credible. Telemetry, filenames, provenance, and automated probes may guide a
diagnosis after viewing; none substitutes for looking at the actual motion.

## Review attestation

`visual:review:attest` reruns the same strict bundle checker and refuses to
attest unless the capture's source fingerprint still matches the current tree.
It then writes the small, tracked `visual-review-attestation.json`: fingerprint,
human reviewer and reviewer type, review time/run, scenario count, per-artifact
checklist count, and the exact completed review Markdown hash. It does not turn
a pending, failed, or probe-only review into a pass.

The fingerprint covers shipped `src/` code (excluding unit tests), `public/`
runtime assets, visual capture/check/library scripts, and build inputs including
`package*.json`, Vite, TypeScript, and `index.html`. Review artifacts, docs,
unit tests, and the attestation itself are excluded. The runner records the
fingerprint and aborts if inputs change during capture.

Both visual CI and Pages deployment run:

```bash
npm run visual:review:attestation:check
```

Any covered-input change makes that command fail until an agent captures and
checks the current evidence, the project owner completes the visual review, and
an agent runs the check/attestation commands and commits the new attestation.
The ignored recordings remain local/CI artifacts; the review hash preserves
traceability without committing them.

## Coverage and maintenance

Scenario definitions and expectations live in `src/game/validation/`. Add a
new reusable registry entry rather than a one-off React test scene. Unit tests
require every runtime semantic animation to be covered or explicitly excluded.
For every actor with a nonempty action contract, `requiredActionRuns` declares
the complete compressed production FSM path from `telemetry.events`, including
framing states such as `idle` and `watching`. This exact comparison rejects a
missing action, detour, re-entry, or wrong order; the older unordered action
arrays remain minimum-coverage summaries, not approval by themselves. For
example, releasing guard must still produce `idle -> guard -> idle` even though
several rendered guard animations occur inside the one `guard` action run.

Each actor under animation review also declares `requiredAnimationRuns`, the
complete ordered rendered path (strings, or `{ "state": "...", "minSamples":
... }` when a run needs an explicit minimum). Runtime comparison is
occurrence-aware: missing runs, unexpected detours, state re-entry, wrong
order, sparse sampling, and same-semantic command restarts all affect the
result. Looping clip-time wraps do not create a run; only a changed
render-probe `commandSerial` does.
Every observed required run and every adjacent edge produces a stable checklist
id in `evidence.json`, and the strict review gate requires one completed visual
judgment for each corresponding artifact.

`visualTransitionObligations.json` is the small curated branch registry. Each
entry names a scenario, actor, semantic pair, and both occurrence numbers for a
meaningful production FSM edge (for example the second roll's heavy follow-up
or the same-semantic riposte victim ownership transfer). The runner refuses to
capture if any obligation is missing, ambiguous, or no longer adjacent in its
declared path; unit tests enforce one resolved edge per registry entry. Add an
obligation when a new branch is behaviorally important rather than enumerating
every incidental idle handoff.

Use `transitionMotionChecks` only for a seam with evidence-derived hard limits.
It names the actor, exact from/to semantic occurrences, post-handoff window,
audited bones, and translation/rotation/weapon-tip ceilings. This probe remains
additive: its corresponding occurrence-aware transition strip still requires a
project-owner artifact judgment.

The current suite covers free/lock-on locomotion, equip, light/heavy chains,
player and enemy guard/parry outcomes, healing, both actors' attacks and hit
reactions, ordinary and paired deaths, nonlethal paired recovery, guard break,
roll/backstep follow-ups, enemy movement/dodge actions, and stationary/moving
launch and landing. Audition-only landing variants remain documented in
`visualAnimationExclusions.json`.

Enemy behavior is intentionally split into short review units rather than one
showcase timeline: `enemy-approach` covers real approach intent, turning, and
WALK→RUN threshold crossing; `enemy-evasion` covers both strafes, dodge, and
backstep; `enemy-utility` covers heal/guard/parry presentation;
`enemy-light-combo` and `enemy-heavy-attack` cover contact attacks; and
`enemy-block` / `enemy-parry` separately cover the two real defensive contacts.
Keep future scenarios similarly focused and dispatch through production input
or enemy intent/FSM paths—never by commanding an animation directly.

Stable gate artifacts live under `artifacts/visual-validation/latest/` and
`smoke-latest/`; named diagnostics live under
`artifacts/visual-validation/runs/<run-id>/`. All remain local and gitignored.
The CI capture job can publish them for review, but a successful capture job is
not qualitative approval. Pages deployment also runs the full automated capture
and cannot publish when telemetry/probe assertions are red; the project-owner
visual pass remains a pre-merge requirement because agents and Actions do not
make the qualitative judgment.

## Capture performance

The runner reuses one browser context so scripts, GLBs, and HTTP cache stay
warm. Navigation waits for `DOMContentLoaded`, then the app's stronger
scenario-ready signal; waiting for Playwright's fixed network-idle quiet period
would add latency without proving game readiness. During a scenario the runner
polls only `done` and `elapsed`, then transfers the large plain-data
`visualFrames` probe as one JSON string at completion. This avoids repeatedly
serializing a growing frame history and avoids Playwright's slower recursive
structured-value transfer.

Full recordings retain production shadows and antialiasing. Normal-speed
assembly decodes the in-pixel marker, extracts each selected production frame
once to a fast marker-free PNG, hard-links those exact pixels into the 30 Hz
sequence, and keeps that lossless sequence until the WebM, GIF, close-up,
contact sheet, motion strips, and transition strips are complete. Derivatives
therefore do not repeatedly seek and decode the lossy WebM. Temporary frames
are then deleted. Smoke runs use the explicit fast query and smaller viewport.
On hosts without `/dev/dri`, Chromium still uses CPU SwiftShader, so recorded
runs can take longer than their final simulation-speed videos.
