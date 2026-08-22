import { useMemo } from "react";
import { useInventoryStore } from "../../game/inventory/store";
import { EQUIP_SLOTS } from "../../game/inventory/types";
import { buildInventoryView, type InventoryCell, type InventoryView } from "../../game/inventory/view";
import { PaperDoll } from "./PaperDoll";
import "./inventory.css";

/**
 * The inventory screen.
 *
 * This file is *layout only*. Everything it draws comes from the view model in
 * `game/inventory/view.ts`, and everything it looks like comes from the
 * stylesheet named by `theme`. Neither the rules nor the skin live here, so
 * re-theming the game is a different stylesheet and porting the inventory to
 * another engine is a different file of the same shape.
 */

export type InventoryTheme = "morrowind";

const CATEGORY_HINT: Record<string, string> = {
  all: "Everything you are carrying.",
  weapon: "Blades, hafts and hammers.",
  apparel: "Worn and carried protection.",
  magic: "Potions, scrolls and enchanted things.",
  misc: "Everything else.",
};

function Cell({
  cell,
  onActivate,
  onFocus,
}: {
  cell: InventoryCell;
  onActivate: (itemId: string) => void;
  onFocus: (itemId: string | null) => void;
}) {
  return (
    <button
      type="button"
      className="inv-cell"
      data-equipped={cell.equipped || undefined}
      data-provisional={cell.provisional ? true : undefined}
      data-blocked={cell.equipBlocked ? true : undefined}
      title={cell.name}
      onClick={() => onActivate(cell.itemId)}
      onMouseEnter={() => onFocus(cell.itemId)}
      onFocus={() => onFocus(cell.itemId)}
      onMouseLeave={() => onFocus(null)}
      onBlur={() => onFocus(null)}
    >
      {cell.icon
        ? <img className="inv-cell-art" src={`${import.meta.env.BASE_URL}${cell.icon}`} alt="" draggable={false} />
        : <span className="inv-cell-initials">{cell.initials}</span>}
      {cell.count > 1 && <span className="inv-cell-count">{cell.count}</span>}
    </button>
  );
}

function DetailLine({ view, focusedId }: { view: InventoryView; focusedId: string | null }) {
  const focused = view.cells.find((cell) => cell.itemId === focusedId);
  if (!focused) {
    return <p className="inv-detail inv-detail-hint">{CATEGORY_HINT[String(view.tabs.find((t) => t.active)?.id)] ?? ""}</p>;
  }
  return (
    <p className="inv-detail">
      <strong>{focused.name}</strong>
      <span className="inv-detail-stats">
        {focused.weightKg.toFixed(1)} kg · {focused.value} gold
        {focused.slot
          ? ` · ${focused.equipped ? "equipped" : focused.equipBlocked ?? "click to equip"}`
          : ""}
      </span>
      <span className="inv-detail-flavour">{focused.description}</span>
      {focused.provisional && <span className="inv-detail-warning">{focused.provisional}</span>}
    </p>
  );
}

export function InventoryScreen({ theme = "morrowind" }: { theme?: InventoryTheme }) {
  const open = useInventoryStore((state) => state.open);
  const inventory = useInventoryStore((state) => state.inventory);
  const category = useInventoryStore((state) => state.category);
  const search = useInventoryStore((state) => state.search);
  const sort = useInventoryStore((state) => state.sort);
  const focused = useInventoryStore((state) => state.focused);
  const setOpen = useInventoryStore((state) => state.setOpen);
  const setCategory = useInventoryStore((state) => state.setCategory);
  const setSearch = useInventoryStore((state) => state.setSearch);
  const setFocused = useInventoryStore((state) => state.setFocused);
  const toggle = useInventoryStore((state) => state.toggle);

  const view = useMemo(
    () => buildInventoryView(inventory, { category, search, sort, title: "Ashen Ring" }),
    [inventory, category, search, sort],
  );

  if (!open) return null;

  const { encumbrance } = view;
  return (
    <div className="inv-root" data-inventory-theme={theme} role="dialog" aria-label="Inventory">
      <div className="inv-window">
        <header className="inv-titlebar">
          <span className="inv-title">{view.title}</span>
          <button type="button" className="inv-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </header>

        <div className="inv-body">
          <aside className="inv-doll-column">
            <div className="inv-encumbrance" data-over={encumbrance.over || undefined}>
              <div className="inv-encumbrance-fill" style={{ width: `${encumbrance.ratio * 100}%` }} />
              <span className="inv-encumbrance-label">
                {Math.round(encumbrance.currentKg)}/{Math.round(encumbrance.capacityKg)}
              </span>
            </div>
            <div className="inv-doll">
              <PaperDoll loadoutKey={EQUIP_SLOTS.map((slot) => inventory.equipped[slot] ?? "").join("|")} />
              <ul className="inv-slots">
                {view.slots.map((slot) => (
                  <li key={slot.slot} data-filled={slot.cell ? true : undefined}>
                    <span className="inv-slot-label">{slot.label}</span>
                    <span className="inv-slot-value">{slot.cell?.name ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="inv-armor">Armor: {view.armourRating}</p>
          </aside>

          <section className="inv-items">
            <div className="inv-toolbar">
              {view.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="inv-tab"
                  data-active={tab.active || undefined}
                  onClick={() => setCategory(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
              <input
                className="inv-search"
                value={search}
                placeholder=""
                aria-label="Search items"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="inv-grid">
              {view.cells.map((cell) => (
                <Cell key={cell.itemId} cell={cell} onActivate={toggle} onFocus={setFocused} />
              ))}
              {view.cells.length === 0 && <p className="inv-empty">Nothing here.</p>}
            </div>

            <div className="inv-footer">
              <DetailLine view={view} focusedId={focused} />
              <span className="inv-gold">{view.gold} gold</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
