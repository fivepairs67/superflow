import type { PropsWithChildren } from "react";

export function PanelLayout({ children }: PropsWithChildren) {
  return <main className="app-shell">{children}</main>;
}
