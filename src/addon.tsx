import { QueryClientProvider } from "@tanstack/react-query";
import type { AddonContext, AddonEnableFunction, QueryClient } from "@wealthfolio/addon-sdk";
import { HeroesAndVillainsPage } from "./pages/HeroesAndVillainsPage";

/**
 * Must match the route declared in `manifest.json`'s `contributes.routes` — that
 * declaration is how the host builds the sidebar and route without executing this
 * code, so the addon boots lazily on first visit instead of at every app start.
 */
const ROUTE_ID = "heroes-villains";
const ROUTE_PATH = "/addons/heroes-villains";

const enable: AddonEnableFunction = (context: AddonContext) => {
  const sidebarItem = context.sidebar.addItem({
    id: ROUTE_ID,
    label: "Heroes & Villains",
    icon: "lightning",
    route: ROUTE_PATH,
  });

  /**
   * Handed to the host as a `component` rather than rendered through `createRoot`:
   * since 3.6.2 the host owns a single React root per addon and swaps the mounted
   * component on navigation. An addon that creates its own root leaves an orphaned
   * tree whose re-renders never reach the DOM — the "buttons do nothing" bug.
   *
   * The sandbox has no react-router provider, so nothing below may call
   * `useLocation()`/`useParams()`; the host passes the current location as a prop.
   */
  function HeroesAndVillainsRoute() {
    const sharedQueryClient = context.api.query.getClient() as QueryClient;
    return (
      <QueryClientProvider client={sharedQueryClient}>
        <HeroesAndVillainsPage ctx={context} />
      </QueryClientProvider>
    );
  }

  context.router.add({
    id: ROUTE_ID,
    path: ROUTE_PATH,
    component: HeroesAndVillainsRoute,
  });

  context.onDisable(() => {
    sidebarItem.remove();
  });
};

export default enable;
