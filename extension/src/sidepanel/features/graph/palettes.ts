import type { GraphColorMode } from "../../state/graph-store";

export interface GraphColorPreset {
  mode: GraphColorMode;
  label: string;
  preview: string[];
}

export const GRAPH_COLOR_PRESETS: GraphColorPreset[] = [
  {
    mode: "ocean",
    label: "Preset 01",
    preview: ["#0046FF", "#73C8D2", "#F5F1DC", "#FF9013"],
  },
  {
    mode: "glacier",
    label: "Preset 02",
    preview: ["#3A59D1", "#3D90D7", "#7AC6D2", "#B5FCCD"],
  },
  {
    mode: "reef",
    label: "Preset 03",
    preview: ["#80A1BA", "#91C4C3", "#B4DEBD", "#FFF7DD"],
  },
  {
    mode: "sunset",
    label: "Preset 04",
    preview: ["#432E54", "#4B4376", "#AE445A", "#E8BCB9"],
  },
  {
    mode: "forest",
    label: "Preset 05",
    preview: ["#434E78", "#607B8F", "#F7E396", "#E97F4A"],
  },
  {
    mode: "lavender",
    label: "Preset 06",
    preview: ["#3F9AAE", "#79C9C5", "#FFE2AF", "#F96E5B"],
  },
  {
    mode: "coral",
    label: "Preset 07",
    preview: ["#696FC7", "#A7AAE1", "#F5D3C4", "#F2AEBB"],
  },
  {
    mode: "coffee",
    label: "Preset 08",
    preview: ["#605678", "#8ABFA3", "#FFBF61", "#FFE6A5"],
  },
  {
    mode: "midnight",
    label: "Preset 09",
    preview: ["#0B1D51", "#725CAD", "#8CCDEB", "#FFE3A9"],
  },
  {
    mode: "mono",
    label: "Preset 10",
    preview: ["#4C4B16", "#898121", "#E6C767", "#F87A53"],
  },
];

export const GRAPH_COLOR_PRESET_MAP = Object.fromEntries(
  GRAPH_COLOR_PRESETS.map((preset) => [preset.mode, preset.preview]),
) as Record<GraphColorMode, string[]>;
