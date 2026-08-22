# Items and inventory

Three layers, with hard seams between them. The seams are the point: the rules
are what the real game keeps, and the sandbox's look is not.

```
src/game/equipment/   what an item IS      (class x material -> stats)
src/game/inventory/   what carrying MEANS  (rules + a view model)
src/ui/inventory/     what it LOOKS like   (layout + one stylesheet)
```

## Items are generated, not written

An arsenal of 41 weapons and shields is `(class × material)` resolved against
what the pipeline actually built. Hand-writing a stat block per item does not
survive a game's worth of content.

- **`weaponClasses.ts`** — how a kind of weapon *fights*: reach, speed, power,
  stamina, and how much of a blow you can put it between yourself and an
  attacker. Absolute where it must agree with an authored clip; relative
  otherwise.
- **`materials.ts`** — how *good* it is: damage, weight, guard, value,
  requirements, tier. One entry restats every item made of it.
- **`arsenal.ts`** — joins them to the generated manifest. The pipeline says
  what it built (id, class, material, sheath socket, asset, icon, measured
  size); this says what that means to the game.

Adding a weapon is one line of `pipeline/config/weapons/arsenal.json`. Adding a
tier is one entry in the material table.

`STRAIGHT_SWORD` is unchanged by construction: steel sits at the middle of every
material scale and `straightSword` at the middle of every class scale, so it
resolves to exactly the numbers the combat sandbox was tuned against.

### Guard stability

`stability` is the Souls stat: the share of a hit's stamina load a guard soaks.
`WEAPON_STABILITY_BAND` and `SHIELD_STABILITY_BAND` are a **contract, enforced**
rather than hoped for — material scaling can otherwise push a heavy weapon past
the top of the weapon band and into shield territory, which quietly removes the
reason to carry a shield.

### Movesets

A class names the moveset it fights with. Only `oneHanded` is built; a class
whose set does not exist yet borrows it, is flagged `provisional`, and shows an
amber dot in the inventory. That is a content gap made visible, not a bug.

## The rules know nothing about rendering

`inventory.ts` is pure functions over an immutable `Inventory`. That is what
makes the same model usable by React, a save file, an undo stack and eventually
a networked session, and it keeps the rules testable with no renderer near them.

Equipping resolves the conflicts equipping creates: a two-handed weapon takes
the off hand with it, a shield cannot be raised while one is held, and losing
the last of something takes it off. A refusal comes back **with a reason**, so
the UI can say why instead of a click doing nothing.

## `view.ts` is the seam

`buildInventoryView` hands the UI a finished, filtered, sorted description of
one screen — tabs with counts, cells, worn slots, encumbrance, armour rating,
why a thing cannot be equipped — and no game types at all. A different skin, a
controller-first layout or a console renderer consumes the same object, and none
of them can accidentally become the place a rule lives.

If you find yourself importing `registry.ts` or `inventory.ts` from `src/ui`,
the seam has been broken.

## Re-skinning

`src/ui/inventory/InventoryScreen.tsx` is layout only: it names semantic parts
(`inv-window`, `inv-grid`, `inv-cell`) and nothing else. The whole look is
`inventory.css`, keyed off `[data-inventory-theme]`. A second theme is a second
block in that file plus a new value for the `theme` prop.

The current skin keeps the Morrowind silhouette — tiled ornamental frame,
centred title, encumbrance bar over a paper doll, black grid with worn items
framed and first — and is modern where that costs nothing.

The paper doll renders the **production actor**, not a preview path. A doll that
renders its own way is a doll that can silently disagree with the game about
what you are holding.

## Icons

The pipeline renders each item's icon in the same pass that builds its GLB: a
small orthographic three-quarter view on a transparent background, framed to the
item's *projected* extent so a long thin sword fills its cell instead of sitting
as a sliver in an empty tile. Items with no built art draw a lettered tile
rather than a hole.
