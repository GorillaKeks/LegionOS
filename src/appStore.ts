import { appInfo, isAppId, type AppDefinition, type AppId } from "./apps.ts";
import type { WindowState } from "./windowManager.ts";

export type LocalAppManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: AppDefinition["icon"];
  type: "internal";
  entry: string;
};

export type LocalCatalogItem = {
  folder: string;
  manifest: LocalAppManifest | null;
  error: string | null;
  installed: boolean;
};

export type LocalAppStoreSnapshot = {
  apps: LocalCatalogItem[];
  installedIds: string[];
};

export type InstalledApp = { id: AppId; info: AppDefinition };
export type AppUsageState = "available" | "installed" | "open" | "minimized" | "active";

export function selectInstalledApps(snapshot: LocalAppStoreSnapshot | null): InstalledApp[] {
  if (!snapshot) return (Object.keys(appInfo) as AppId[]).filter((id) => id !== "focus").map((id) => ({ id, info: appInfo[id] }));
  return snapshot.apps.flatMap((item) => {
    const manifest = item.manifest;
    if (!item.installed || !manifest || !isAppId(manifest.id) || !snapshot.installedIds.includes(manifest.id)) return [];
    return [{
      id: manifest.id,
      info: { ...appInfo[manifest.id], name: manifest.name, subtitle: manifest.description, icon: manifest.icon },
    }];
  });
}

export function selectAvailableApps(snapshot: LocalAppStoreSnapshot | null): LocalCatalogItem[] {
  return snapshot?.apps.filter((item) => item.manifest !== null && !item.installed) ?? [];
}

export function selectInstalledCatalogApps(snapshot: LocalAppStoreSnapshot | null): LocalCatalogItem[] {
  return snapshot?.apps.filter((item) => item.manifest !== null && item.installed) ?? [];
}

export function getAppUsageState(id: string, snapshot: LocalAppStoreSnapshot | null, windows: WindowState): AppUsageState {
  const installed = !!snapshot?.installedIds.includes(id);
  if (!installed) return "available";
  const session = windows.windows.find((window) => window.appId === id);
  if (!session) return "installed";
  if (session.minimized) return "minimized";
  return windows.activeId === session.id ? "active" : "open";
}
