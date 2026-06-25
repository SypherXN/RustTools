import { rustItemIconUrl, type SellOrderListing } from "@rusttools/shared";

interface VendingTradeRowProps {
  order: SellOrderListing;
  className?: string;
}

export function VendingTradeRow({ order, className }: VendingTradeRowProps) {
  return (
    <div
      className={["map-vending-trade", className].filter(Boolean).join(" ")}
      title={`${order.itemName} ×${order.quantity} for ${order.costQuantity} ${order.costItemName}`}
    >
      <div className="map-vending-trade-side">
        <img
          className="map-vending-trade-icon"
          src={rustItemIconUrl(order.itemShortname)}
          alt=""
          loading="lazy"
        />
        <div className="map-vending-trade-meta">
          <span className="map-vending-trade-name">{order.itemName}</span>
          <span className="map-vending-trade-qty">×{order.quantity.toLocaleString()}</span>
        </div>
      </div>
      <span className="map-vending-trade-arrow" aria-hidden>
        →
      </span>
      <div className="map-vending-trade-side map-vending-trade-side-cost">
        <img
          className="map-vending-trade-icon"
          src={rustItemIconUrl(order.costItemShortname)}
          alt=""
          loading="lazy"
        />
        <div className="map-vending-trade-meta">
          <span className="map-vending-trade-name">{order.costItemName}</span>
          <span className="map-vending-trade-qty">×{order.costQuantity.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
