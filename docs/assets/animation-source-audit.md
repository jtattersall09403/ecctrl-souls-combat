# Skyrim animation source audit

Audited 2026-08-20 against the owned local Skyrim Animation BSA and the current
pipeline output. Generated HKX/GLB/mod archives remain local and gitignored.

## Selected mappings

| Semantic action | Current source | Result |
| --- | --- | --- |
| `SPRINT` | `meshes/actors/character/animations/mt_sprintforwardsword.hkx` | Selected. Dedicated 0.60 s sword sprint; replaces the sped-up run. |
| `GUARD_ENTER` / `GUARD` / `GUARD_HIT_A/B` | vanilla `1hm_blockanticipate`, `1hm_blockidle`, `1hm_blockhita/b` | Selected and driven as a weapon-profile sequence. |
| `PARRY` / `PARRY_FOLLOW_THROUGH` | vanilla `1hm_blockbashintro`, `1hm_blockbash` | Selected as one two-stage action. |
| `HIT_HEAVY` | vanilla `1hm_staggerbacklarge` | Selected; visually stronger than `HIT` and below the largest stagger. |
| `ROLL` | Dynamic Dodge 1.5, DMCO base `6000/MCO_DodgeForward2.hkx` | Selected after four-way animated audition. Grounded full-body tuck; Forward1 was only a dash. |
| `BACKSTEP` | Dynamic Dodge 1.5, DMCO base `6000/MCO_DodgeBackward1.hkx` | Selected. Short grounded retreat; Backward2 was a full backward roll. |
| `RIPOSTE` / `RIPOSTED` | Rim Parry Stand Alone v1.1, `(2130000018)1hmzl/1.hkx` + `(6112012)1hm back/modernstaggerlock/1.HKX` | Selected one-hand/no-shield attacker and `ExeStaggerOther` victim. Contact 1.9333 s; release 3.3667 s. |
| `BACKSTAB` / `BACKSTABBED` | Backstab v1, `paired_1hmsneakkillbacka.hkx` | Selected. One paired HKX is split into ordinary attacker and `2_` victim 99-track actions. Authored separation 0.839 m; contact 1.50 s; release 2.20 s. |
| `GUARD_BREAK` | NPC Parry Style Stagger v1.0, `(2399)1hm sword/1hm_staggerbacklargest.hkx` | Selected. Drops into a long vulnerable kneel and is visually distinct from ordinary `HIT_HEAVY`. |
| `DEATH` | vanilla `deathanimationa` | Selected. This is the only humanoid `deathanimation*` member in the local BSA. |
| moving/sprint landing | accelerated vanilla `mt_jumpland` | Selected runtime fallback: 0.20/0.16 s compression with controller velocity retained. |
| `JUMP_LAND_LEFT/RIGHT` | vanilla `mt_jumplandleft/right` | Audition-only. Both contain quarter-turns and are not runtime-selected. |
| sword attachment | `Weapon` held / `WeaponSword` sheathed | Selected. Socket-local XYZW quaternions live in `STRAIGHT_SWORD.visual`; verified through eight animated actions. |

## External archive record

Nexus file listings were queried before download. Originals and extracted
assets are preserved under the pipeline's ignored
`skyrim-source/mod-sources/`; no archive, extracted HKX, or mod-containing GLB
is tracked by the public repositories.

| Mod | Author / version | Nexus file | Exact downloaded archive |
| --- | --- | --- | --- |
| [Dynamic Dodge Animation #79598](https://www.nexusmods.com/skyrimspecialedition/mods/79598) | lSmoothl, 1.5 | `429066` | `Dynamic Dodge-79598-1-5-1695708046.zip` |
| [Rim Parry and Execution #114366](https://www.nexusmods.com/skyrimspecialedition/mods/114366) | SHADOWPQ, v1.1 | `499427` | `00 Rim Parry Stand Alone - v1.1 Update-114366-v1-1-1715262891.zip` |
| [Backstab animation for sneak killmove SE #74453](https://www.nexusmods.com/skyrimspecialedition/mods/74453) | Ichaflash (original), rhonjhonson (uploader), 1 | `312246` | `Backstab animation for sneak killmove SE-74453-1-1662026614.zip` |
| [NPC Parry Style Stagger animations #94840](https://www.nexusmods.com/skyrimspecialedition/mods/94840) | SHADOWPQ, v1.0 | `406235` | `Largest Stagger for NPC separate stagger version-94840-v1-0-1689101918.zip` |

The pipeline's ignored `SOURCES.json` records archive SHA-256 values and full
selected paths. Its public `docs/mod-animation-ingestion.md` records the safe
Nexus workflow and FOMOD/OAR/paired-HKX interpretation.

Dynamic Dodge's UTF-16 FOMOD was followed through `Roll to cancel attack` →
DMCO 0.9.6. The base priority `6000` branch has no attack-cancel condition;
higher priorities add weapon or `IsAttacking` specialization. Rim's OAR config
identifies the selected attacker as one-handed sword/no off-hand weapon or
shield and the victim through `ExeStaggerOther`. Guard break's `(2399)` config
is the right-hand type-1/no-shield separate-largest-stagger branch.

The backstab archive does not provide a separate B file. Native HKX inspection
found a `PairedRoot` skeleton with 201 tracks: two complete 99-track actors plus
their group roots. The pipeline now imports the same HKX twice, stripping the
`2_` prefix for the victim side. The second group offset is 56.062 Skyrim units,
which becomes 0.839 m after import and runtime character scale.

## Generated visual evidence

The reusable headless renderers are
`elder-scrolls-asset-pipeline/pipeline/blender/render_action_preview.py` and
`render_paired_preview.py`. Local mod candidate and paired GIF/contact-sheet
evidence is under pipeline `output/animated-mod-audition/`,
`output/paired-backstab-authored*`, and `output/paired-riposte*`; these contain
derived mod/Bethesda imagery and must not be committed.
