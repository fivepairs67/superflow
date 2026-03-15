import {
  createContext,
  startTransition,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type GraphViewMode = "logical" | "script";
export type GraphColorMode =
  | "ocean"
  | "glacier"
  | "reef"
  | "sunset"
  | "forest"
  | "lavender"
  | "coral"
  | "coffee"
  | "midnight"
  | "mono";
export type GraphSelectionSource = "panel" | "editor" | null;

interface GraphStoreValue {
  selectedNodeId: string | null;
  selectedColumnId: string | null;
  selectionSource: GraphSelectionSource;
  selectedStatementIndex: number | null;
  ignoredEditorSelectionSignature: string;
  viewMode: GraphViewMode;
  colorMode: GraphColorMode;
  selectNode: (nodeId: string, source?: Exclude<GraphSelectionSource, null>) => void;
  selectColumn: (columnId: string, source?: Exclude<GraphSelectionSource, null>) => void;
  clearSelection: () => void;
  selectStatementIndex: (index: number, ignoredSelectionSignature?: string) => void;
  setIgnoredEditorSelectionSignature: (signature: string) => void;
  setViewMode: (mode: GraphViewMode) => void;
  setColorMode: (mode: GraphColorMode) => void;
}

const GraphStoreContext = createContext<GraphStoreValue | null>(null);

export function GraphStoreProvider({ children }: PropsWithChildren) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [selectionSource, setSelectionSource] = useState<GraphSelectionSource>(null);
  const [selectedStatementIndex, setSelectedStatementIndex] = useState<number | null>(null);
  const [ignoredEditorSelectionSignature, setIgnoredEditorSelectionSignatureState] = useState("");
  const [viewMode, setViewModeState] = useState<GraphViewMode>("logical");
  const [colorMode, setColorModeState] = useState<GraphColorMode>("ocean");

  const value = useMemo<GraphStoreValue>(
    () => ({
      selectedNodeId,
      selectedColumnId,
      selectionSource,
      selectedStatementIndex,
      ignoredEditorSelectionSignature,
      viewMode,
      colorMode,
      selectNode(nodeId, source = "panel") {
        startTransition(() => {
          setSelectedNodeId((current) => (current === nodeId ? null : nodeId));
          setSelectedColumnId(null);
          setSelectionSource((current) => {
            if (selectedNodeId === nodeId) {
              return null;
            }
            return source;
          });
        });
      },
      selectColumn(columnId, source = "panel") {
        startTransition(() => {
          setSelectedColumnId((current) => (current === columnId ? null : columnId));
          setSelectionSource((current) => {
            if (selectedColumnId === columnId) {
              return null;
            }
            return source;
          });
        });
      },
      clearSelection() {
        startTransition(() => {
          setSelectedNodeId(null);
          setSelectedColumnId(null);
          setSelectionSource(null);
        });
      },
      selectStatementIndex(index, ignoredSelectionSignature = "") {
        startTransition(() => {
          setSelectedStatementIndex(index);
          setSelectedNodeId(null);
          setSelectedColumnId(null);
          setSelectionSource(null);
          setIgnoredEditorSelectionSignatureState(ignoredSelectionSignature);
        });
      },
      setIgnoredEditorSelectionSignature(signature) {
        startTransition(() => {
          setIgnoredEditorSelectionSignatureState(signature);
        });
      },
      setViewMode(mode) {
        startTransition(() => {
          setViewModeState(mode);
          setSelectedNodeId(null);
          setSelectedColumnId(null);
          setSelectionSource(null);
        });
      },
      setColorMode(mode) {
        startTransition(() => {
          setColorModeState(mode);
        });
      },
    }),
    [
      colorMode,
      ignoredEditorSelectionSignature,
      selectedColumnId,
      selectedNodeId,
      selectedStatementIndex,
      selectionSource,
      viewMode,
    ],
  );

  return <GraphStoreContext.Provider value={value}>{children}</GraphStoreContext.Provider>;
}

export function useGraphStore() {
  const context = useContext(GraphStoreContext);

  if (!context) {
    throw new Error("useGraphStore must be used inside GraphStoreProvider");
  }

  return context;
}
