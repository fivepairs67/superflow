interface HeaderProps {
  isSqlLab?: boolean;
  siteAccessSupported?: boolean;
  siteAccessGranted?: boolean;
  siteAccessPending?: boolean;
  isSchemaPanelHidden?: boolean;
  onEnableSiteAccess?: (() => void) | null;
  onDisableSiteAccess?: (() => void) | null;
  onToggleSchemaPanel?: (() => void) | null;
}

export function Header({
  isSqlLab,
  siteAccessSupported,
  siteAccessGranted,
  siteAccessPending,
  isSchemaPanelHidden,
  onEnableSiteAccess,
  onDisableSiteAccess,
  onToggleSchemaPanel,
}: HeaderProps) {
  return (
    <header className="hero-card hero-card--compact">
      <div className="hero-head hero-head--compact">
        <div className="hero-brand" aria-label="SuperFLOW">
          <img className="hero-brand-image" src="./assets/superflow_cr.png" alt="SuperFLOW" />
        </div>
        <div className="hero-actions">
          <span className={`hero-connection ${isSqlLab ? "is-on" : "is-off"}`}>
            <span className="hero-connection-dot" aria-hidden="true" />
            {isSqlLab ? "SQL LAB On" : "SQL LAB Off"}
          </span>
          <div className="hero-secondary-actions">
            {siteAccessSupported ? (
              siteAccessGranted ? (
                <button
                  type="button"
                  className="hero-schema-toggle hero-schema-toggle--active"
                  onClick={onDisableSiteAccess || undefined}
                  disabled={siteAccessPending || !onDisableSiteAccess}
                  title="Disable access for this site"
                >
                  {siteAccessPending ? "Updating..." : "Site Access On"}
                </button>
              ) : onEnableSiteAccess ? (
                <button
                  type="button"
                  className="hero-schema-toggle hero-schema-toggle--cta"
                  onClick={onEnableSiteAccess}
                  disabled={siteAccessPending}
                >
                  {siteAccessPending ? "Updating..." : "Enable Site"}
                </button>
              ) : (
                <span className="hero-site-access-pill is-off">Site Access Off</span>
              )
            ) : null}
            {isSqlLab && onToggleSchemaPanel ? (
              <button
                type="button"
                className="hero-schema-toggle"
                onClick={onToggleSchemaPanel}
              >
                {isSchemaPanelHidden ? "Show Schema Panel" : "Hide Schema Panel"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
