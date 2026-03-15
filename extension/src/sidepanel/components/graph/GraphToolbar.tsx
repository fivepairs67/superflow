import type { CSSProperties, ReactNode } from "react";

import type { GraphColorMode, GraphViewMode } from "../../state/graph-store";
import { GRAPH_COLOR_PRESETS } from "../../features/graph/palettes";

interface GraphToolbarProps {
  hasScriptView: boolean;
  viewMode: GraphViewMode;
  colorMode: GraphColorMode;
  zoom: number;
  zoomLevel: number;
  compactMode: boolean;
  canCompact: boolean;
  onSetViewMode: (mode: GraphViewMode) => void;
  onSetColorMode: (mode: GraphColorMode) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onResetView: () => void;
  onToggleCompact: () => void;
}

export function GraphToolbar({
  hasScriptView,
  viewMode,
  colorMode,
  zoom,
  zoomLevel,
  compactMode,
  canCompact,
  onSetViewMode,
  onSetColorMode,
  onZoomOut,
  onZoomIn,
  onFit,
  onResetView,
  onToggleCompact,
}: GraphToolbarProps) {
  return (
    <div className="graph-toolbar">
      <ToolbarGroup label="View" variant="view">
        <ModeButton
          active={viewMode === "logical"}
          label="Logical"
          onClick={() => onSetViewMode("logical")}
        />
        {hasScriptView ? (
          <ModeButton
            active={viewMode === "script"}
            label="Script"
            onClick={() => onSetViewMode("script")}
          />
        ) : null}
      </ToolbarGroup>

      <ToolbarGroup label="Color" variant="color">
        {GRAPH_COLOR_PRESETS.map((option) => (
          <ColorSwatchButton
            key={option.mode}
            active={colorMode === option.mode}
            label={option.label}
            preview={option.preview}
            onClick={() => onSetColorMode(option.mode)}
          />
        ))}
      </ToolbarGroup>

      <ToolbarGroup label="Zoom" variant="zoom">
        <ToolButton label="-" title="Zoom out" onClick={onZoomOut} />
        <ZoomIndicatorButton zoom={zoom} zoomLevel={zoomLevel} onClick={onResetView} />
        <ToolButton label="+" title="Zoom in" onClick={onZoomIn} />
        <ToolButton label="Fit" title="Fit to panel" onClick={onFit} />
      </ToolbarGroup>

      {canCompact ? (
        <ToolbarGroup label="Density" variant="density">
          <ModeButton
            active={compactMode}
            label={compactMode ? "Folded" : "Expanded"}
            onClick={onToggleCompact}
          />
        </ToolbarGroup>
      ) : null}
    </div>
  );
}

interface ToolbarGroupProps {
  label: string;
  variant: "view" | "color" | "zoom" | "density";
  children: ReactNode;
}

function ToolbarGroup({ label, variant, children }: ToolbarGroupProps) {
  return (
    <div className={`graph-toolbar-group graph-toolbar-group--${variant}`}>
      <span className="graph-toolbar-label">{label}</span>
      <div className="graph-toolbar-actions">{children}</div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function ModeButton({ active, label, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      className={`graph-toolbar-button ${active ? "is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

interface ColorSwatchButtonProps {
  active: boolean;
  label: string;
  preview: string[];
  onClick: () => void;
}

function ColorSwatchButton({ active, label, preview, onClick }: ColorSwatchButtonProps) {
  const [color1, color2, color3, color4] = preview;
  const gradient = `conic-gradient(
    from 210deg,
    ${color1} 0deg 90deg,
    ${color2} 90deg 180deg,
    ${color3} 180deg 270deg,
    ${color4} 270deg 360deg
  )`;
  return (
    <button
      type="button"
      className={`graph-toolbar-button graph-toolbar-button--swatch ${active ? "is-active" : ""}`}
      aria-pressed={active}
      aria-label={`Color ${label}`}
      title={`Color ${label}`}
      onClick={onClick}
    >
      <span
        className="graph-color-swatch"
        aria-hidden="true"
        style={
          {
            ["--swatch-gradient" as string]: gradient,
            ["--swatch-outline" as string]: color4,
          } as CSSProperties
        }
      />
    </button>
  );
}

interface ToolButtonProps {
  label: string;
  title: string;
  onClick: () => void;
}

function ToolButton({ label, title, onClick }: ToolButtonProps) {
  return (
    <button type="button" className="graph-tool-button" title={title} onClick={onClick}>
      {label}
    </button>
  );
}

interface ZoomIndicatorButtonProps {
  zoom: number;
  zoomLevel: number;
  onClick: () => void;
}

function ZoomIndicatorButton({ zoom, zoomLevel, onClick }: ZoomIndicatorButtonProps) {
  const activeLevels = [0, 1, 2, 3].map((index) => zoomLevel >= (index + 1) / 4);

  return (
    <button
      type="button"
      className="graph-tool-button graph-tool-button--zoom-indicator"
      title={`Reset zoom (${Math.round(zoom * 100)}%)`}
      aria-label={`Reset zoom (${Math.round(zoom * 100)}%)`}
      onClick={onClick}
    >
      <span className="graph-zoom-indicator" aria-hidden="true">
        <span className="graph-zoom-indicator-bars">
          {activeLevels.map((active, index) => (
            <span
              key={index}
              className={active ? "is-active" : ""}
              style={{ ["--bar-index" as string]: String(index) } as CSSProperties}
            />
          ))}
        </span>
      </span>
    </button>
  );
}
