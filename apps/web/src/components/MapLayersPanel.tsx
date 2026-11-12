import type { MapDrawingStroke, MapPin, ResolvedAutomationBase } from "@rusttools/shared";
import { formatProximityRadiusMeters } from "@rusttools/shared";
import type { MapLayers } from "./MapOverlay";
import type { MapProcgenLayers } from "@rusttools/shared";

interface MapLayersPanelProps {
  layers: MapLayers;
  procgenLayers: MapProcgenLayers;
  procgenReady: boolean;
  onlineCount: number;
  teamOnMapCount: number;
  monumentCount: number;
  showTeamOverlays: boolean;
  drawings: MapDrawingStroke[];
  pins: MapPin[];
  canSwitch: boolean;
  onToggleLayer: (key: keyof MapLayers) => void;
  onToggleProcgenLayer: (key: keyof MapProcgenLayers) => void;
  onShowTeamOverlaysChange: (value: boolean) => void;
  onRefresh: () => void;
  onDeletePin: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  onSelectPin: (pinId: string) => void;
  onSelectDrawing: (drawingId: string) => void;
  resolvedAutomationBase?: ResolvedAutomationBase | null;
  onFocusAutomationBase?: () => void;
  canEditAutomationBase?: boolean;
  automationBaseRadiusMeters?: number;
  onAutomationBaseRadiusChange?: (meters: number) => void;
}

function LayerCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="map-layer-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function MapLayersPanel({
  layers,
  procgenLayers,
  procgenReady,
  onlineCount,
  teamOnMapCount,
  monumentCount,
  showTeamOverlays,
  drawings,
  pins,
  canSwitch,
  onToggleLayer,
  onToggleProcgenLayer,
  onShowTeamOverlaysChange,
  onRefresh,
  onDeletePin,
  onDeleteDrawing,
  onSelectPin,
  onSelectDrawing,
  resolvedAutomationBase,
  onFocusAutomationBase,
  canEditAutomationBase,
  automationBaseRadiusMeters = 150,
  onAutomationBaseRadiusChange,
}: MapLayersPanelProps) {
  return (
    <aside className="map-layers-panel card">
      <h2>Layers</h2>

      <details className="map-layer-group">
        <summary>World</summary>
        <div className="map-layer-group-body">
          <LayerCheckbox
            checked={layers.team}
            onChange={() => onToggleLayer("team")}
            label={`Team (${onlineCount} online / ${teamOnMapCount})`}
          />
          <LayerCheckbox
            checked={layers.monuments}
            onChange={() => onToggleLayer("monuments")}
            label={`Monuments (${monumentCount})`}
          />
        </div>
      </details>

      {procgenReady && (
        <details className="map-layer-group">
          <summary>Procgen (.map)</summary>
          <div className="map-layer-group-body">
            <LayerCheckbox
              checked={procgenLayers.buildingBlocked}
              onChange={() => onToggleProcgenLayer("buildingBlocked")}
              label="Building blocked"
            />
            <LayerCheckbox
              checked={procgenLayers.heatmapOres}
              onChange={() => onToggleProcgenLayer("heatmapOres")}
              label="Ore heatmap"
            />
            <LayerCheckbox
              checked={procgenLayers.heatmapHqm}
              onChange={() => onToggleProcgenLayer("heatmapHqm")}
              label="HQM spawn ground"
            />
            <LayerCheckbox
              checked={procgenLayers.heatmapStones}
              onChange={() => onToggleProcgenLayer("heatmapStones")}
              label="Stone heatmap"
            />
            <LayerCheckbox
              checked={procgenLayers.heatmapSulfur}
              onChange={() => onToggleProcgenLayer("heatmapSulfur")}
              label="Sulfur heatmap"
            />
            <LayerCheckbox
              checked={procgenLayers.paths}
              onChange={() => onToggleProcgenLayer("paths")}
              label="Roads / rivers / rails"
            />
            <LayerCheckbox
              checked={procgenLayers.caves}
              onChange={() => onToggleProcgenLayer("caves")}
              label="Cave entrances"
            />
            <LayerCheckbox
              checked={procgenLayers.icebergs}
              onChange={() => onToggleProcgenLayer("icebergs")}
              label="Icebergs"
            />
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
              HQM overlay is spawn ground (Decor/Cliffside/Clutter). Map files do not mark HQM vs other ores.
            </p>
          </div>
        </details>
      )}

      <details className="map-layer-group">
        <summary>Overlays</summary>
        <div className="map-layer-group-body">
          <LayerCheckbox
            checked={layers.grid}
            onChange={() => onToggleLayer("grid")}
            label="Grid"
          />
          <LayerCheckbox
            checked={layers.base}
            onChange={() => onToggleLayer("base")}
            label={
              resolvedAutomationBase
                ? `Server base (${resolvedAutomationBase.label})`
                : "Server base (not set)"
            }
          />
          {resolvedAutomationBase && onFocusAutomationBase && (
            <button type="button" className="btn-secondary map-base-focus" onClick={onFocusAutomationBase}>
              Focus base
            </button>
          )}
          {canEditAutomationBase && resolvedAutomationBase && onAutomationBaseRadiusChange && (
            <label className="map-base-radius-edit">
              Proximity radius (m)
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                defaultValue={automationBaseRadiusMeters}
                key={automationBaseRadiusMeters}
                onBlur={(e) => {
                  const meters = Math.max(0, Number(e.target.value) || 0);
                  if (meters !== automationBaseRadiusMeters) {
                    onAutomationBaseRadiusChange(meters);
                  }
                }}
              />
              <span className="muted">
                {formatProximityRadiusMeters(automationBaseRadiusMeters)} circle on map
              </span>
            </label>
          )}
          <LayerCheckbox
            checked={showTeamOverlays}
            onChange={() => onShowTeamOverlaysChange(!showTeamOverlays)}
            label={`Annotations (${drawings.length} drawings, ${pins.length} pins)`}
          />
          {showTeamOverlays && (drawings.length > 0 || pins.length > 0) && (
            <div className="map-overlay-list">
              <h3>Team annotations</h3>
              {pins.length > 0 && (
                <ul>
                  {pins.map((pin) => (
                    <li key={pin.id}>
                      <button
                        type="button"
                        className="map-overlay-list-item"
                        onClick={() => onSelectPin(pin.id)}
                      >
                        <strong>{pin.label}</strong>
                        <span className="muted">pin</span>
                      </button>
                      {canSwitch && (
                        <button
                          type="button"
                          className="btn-secondary map-overlay-delete"
                          onClick={() => void onDeletePin(pin.id)}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {drawings.length > 0 && (
                <ul>
                  {drawings.map((stroke) => (
                    <li key={stroke.id}>
                      <button
                        type="button"
                        className="map-overlay-list-item"
                        onClick={() => onSelectDrawing(stroke.id)}
                      >
                        <span className="map-drawing-color-preview" style={{ background: stroke.color }} />
                        <strong>{stroke.label || "Drawing"}</strong>
                        <span className="muted">by {stroke.createdBy}</span>
                      </button>
                      {canSwitch && (
                        <button
                          type="button"
                          className="btn-secondary map-overlay-delete"
                          onClick={() => void onDeleteDrawing(stroke.id)}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </details>

      <button type="button" className="btn-secondary map-layers-refresh" onClick={onRefresh}>
        Refresh now
      </button>

      <ul className="map-legend">
        <li><span className="legend-swatch team-online" /> Team (online)</li>
        <li><span className="legend-swatch team-offline" /> Team (offline)</li>
        <li><span className="legend-swatch monument" /> Monument</li>
        <li><span className="legend-swatch grid" /> Grid (150m cells)</li>
        <li><span className="legend-swatch automation-base" /> Server base zone</li>
        <li><span className="legend-swatch monument" style={{ background: "#eab308" }} /> Team pin</li>
      </ul>

      {canSwitch && (
        <p className="muted map-layers-hint">
          Click <strong>Annotate</strong> on the map toolbar, choose <strong>Draw</strong> or{" "}
          <strong>Pin</strong>, then click or drag on the map.
        </p>
      )}
    </aside>
  );
}
