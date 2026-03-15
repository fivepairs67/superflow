import type { PropsWithChildren } from "react";
import { GraphStoreProvider } from "../state/graph-store";

export function AppProviders({ children }: PropsWithChildren) {
  return <GraphStoreProvider>{children}</GraphStoreProvider>;
}
