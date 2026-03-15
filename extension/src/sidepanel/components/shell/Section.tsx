import type { PropsWithChildren, ReactNode } from "react";

interface SectionProps extends PropsWithChildren {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}

export function Section({ eyebrow, title, action, children }: SectionProps) {
  return (
    <section className="panel-card">
      <div className="section-head">
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
