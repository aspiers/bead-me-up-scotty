import * as React from "react";

type LaunchParams = { targetURL?: string };
type LaunchQueue = { setConsumer(consumer: (params: LaunchParams) => void): void };

/**
 * With the manifest's `launch_handler` set to focus-existing, Chrome focuses
 * the open app window on launch and hands the launch URL here instead of
 * loading it. Open it, unless it is a plain app launch (the start URL), which
 * should keep whatever the window shows, or the URL this page was loaded for,
 * which Chrome also queues when no window was open.
 */
export function useLaunchQueue() {
  React.useEffect(() => {
    const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer(({ targetURL }) => {
      if (!targetURL || new URL(targetURL).pathname === "/") return;
      const loaded = performance.getEntriesByType("navigation")[0]?.name;
      if (targetURL !== loaded) window.location.assign(targetURL);
    });
  }, []);
}
