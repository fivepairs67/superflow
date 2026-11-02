export function registerSidePanelController(api) {
  // A global default panel follows unrelated tabs. Only explicit clicks enable a tab.
  const configure = async () => {
    await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await api.sidePanel.setOptions({ enabled: false });
  };

  const resetLegacyPanels = async () => {
    await configure();
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.filter((tab) => Number.isInteger(tab.id)).map(async (tab) => {
      const options = await api.sidePanel.getOptions({ tabId: tab.id });
      if (options.path !== panelPath(tab.id)) {
        await api.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      }
    }));
  };

  const openPanel = async (tab) => {
    if (!Number.isInteger(tab?.id) || tab.id < 0) {
      return;
    }
    // Dispatch in order without yielding: awaiting setOptions loses the worker's user gesture.
    const configured = api.sidePanel.setOptions({ tabId: tab.id, path: panelPath(tab.id), enabled: true });
    const opened = api.sidePanel.open({ tabId: tab.id });
    await Promise.all([configured, opened]);
  };

  const reportError = (error) => console.warn("Unable to configure side panel", error);
  api.action.onClicked.addListener((tab) => { void openPanel(tab).catch(reportError); });
  api.runtime.onInstalled.addListener(() => { void resetLegacyPanels().catch(reportError); });
  api.runtime.onStartup.addListener(() => { void resetLegacyPanels().catch(reportError); });
  void configure().catch(reportError);
}

function panelPath(tabId) {
  return `sidepanel.html?tabId=${tabId}`;
}
