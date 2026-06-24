import type { ParsedStorage, StorageItemView } from "@rusttools/shared";

const DEFAULT_COLUMNS = 6;
const DEFAULT_CAPACITY = 24;

function slotCount(parsed: ParsedStorage): number {
  if (parsed.capacity && parsed.capacity > 0) return parsed.capacity;
  const filled = parsed.items.length;
  if (filled === 0) return DEFAULT_CAPACITY;
  return Math.max(DEFAULT_CAPACITY, Math.ceil(filled / DEFAULT_COLUMNS) * DEFAULT_COLUMNS);
}

function formatStack(quantity: number): string {
  if (quantity >= 1_000_000) {
    const m = quantity / 1_000_000;
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (quantity >= 10_000) {
    const k = quantity / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return quantity.toLocaleString();
}

function StorageSlot({ item }: { item: StorageItemView | null }) {
  if (!item) {
    return <div className="storage-slot storage-slot-empty" />;
  }

  return (
    <div
      className={`storage-slot${item.isBlueprint ? " storage-slot-blueprint" : ""}`}
      title={`${item.name} × ${item.quantity.toLocaleString()}`}
    >
      <img
        className="storage-slot-icon"
        src={item.iconUrl}
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
      {item.quantity > 1 && (
        <span className="storage-slot-qty">{formatStack(item.quantity)}</span>
      )}
      {item.isBlueprint && <span className="storage-slot-bp">BP</span>}
    </div>
  );
}

function StorageGrid({
  slots,
  columns,
  className,
}: {
  slots: Array<StorageItemView | null>;
  columns: number;
  className?: string;
}) {
  return (
    <div
      className={`storage-grid${className ? ` ${className}` : ""}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {slots.map((item, index) => (
        <StorageSlot key={item ? `${item.itemId}-${index}` : `empty-${index}`} item={item} />
      ))}
    </div>
  );
}

function ToolCupboardGrid({ parsed }: { parsed: ParsedStorage }) {
  const tcStorage = parsed.tcStorage;
  if (!tcStorage) return null;

  const otherFilled = tcStorage.otherSlots.filter(Boolean).length;

  return (
    <div className="storage-inventory storage-inventory-tc">
      <div className="storage-tc-section">
        <h3 className="storage-tc-heading">Upkeep</h3>
        <StorageGrid slots={tcStorage.upkeepSlots} columns={4} className="storage-grid-upkeep" />
      </div>
      <div className="storage-tc-section">
        <h3 className="storage-tc-heading">Storage</h3>
        <StorageGrid slots={tcStorage.otherSlots} columns={5} className="storage-grid-other" />
        <p className="muted storage-grid-meta">
          {otherFilled} of 5 slots used
        </p>
      </div>
    </div>
  );
}

function GenericStorageGrid({ parsed }: { parsed: ParsedStorage }) {
  const slots = slotCount(parsed);
  const cells: Array<StorageItemView | null> = Array.from({ length: slots }, (_, i) => {
    return parsed.items[i] ?? null;
  });

  return (
    <div className="storage-inventory">
      <StorageGrid slots={cells} columns={DEFAULT_COLUMNS} />
      <p className="muted storage-grid-meta">
        {parsed.items.length} item stack{parsed.items.length === 1 ? "" : "s"}
        {parsed.capacity ? ` · ${parsed.capacity} slots` : ""}
      </p>
    </div>
  );
}

export function StorageContentsGrid({ parsed }: { parsed: ParsedStorage }) {
  if (parsed.isToolCupboard && parsed.tcStorage) {
    return <ToolCupboardGrid parsed={parsed} />;
  }

  return <GenericStorageGrid parsed={parsed} />;
}

export function StorageUpkeepBanner({ parsed }: { parsed: ParsedStorage }) {
  if (!parsed.isToolCupboard || !parsed.upkeep) return null;

  const { upkeep } = parsed;
  return (
    <div className={`storage-upkeep storage-upkeep-${upkeep.level}`}>
      <strong>Tool Cupboard</strong>
      <span>
        Decay time left: <strong>{upkeep.label}</strong>
      </span>
    </div>
  );
}
