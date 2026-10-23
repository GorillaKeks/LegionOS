export type AppId = "settings" | "notes" | "demo" | "focus" | "snake" | "spotify";
export type InternalAppId = Exclude<AppId, "spotify">;
export type AppIcon = "settings" | "note" | "spark" | "snake";

export type AppDefinition = {
  name: string;
  subtitle: string;
  icon: AppIcon;
  color: "cyan" | "violet" | "orange";
};

export const appInfo: Record<AppId, AppDefinition> = {
  settings: { name: "Einstellungen", subtitle: "Dein Phone", icon: "settings", color: "cyan" },
  notes: { name: "Notizen", subtitle: "Gedanken festhalten", icon: "note", color: "violet" },
  demo: { name: "Demo", subtitle: "Ein kleiner Spielplatz", icon: "spark", color: "orange" },
  focus: { name: "Fokus", subtitle: "Kurze Fokus-Checkliste", icon: "spark", color: "cyan" },
  snake: { name: "Snake", subtitle: "Klassisches Snake im futuristischen Legion-Design", icon: "snake", color: "cyan" },
  spotify: { name: "Spotify", subtitle: "Spotify Desktop in eigenem Fenster starten", icon: "spark", color: "cyan" },
};

export function isAppId(value: string): value is AppId {
  return Object.prototype.hasOwnProperty.call(appInfo, value);
}
