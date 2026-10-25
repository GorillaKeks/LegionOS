export type Greeting = { text: string; icon: "sun" | "sunset" | "spark" | "moon" };
import { t, type Language } from "./i18n.ts";

/** Selects a greeting from the machine's local hour and minute. */
export function getGreeting(date: Date, language: Language = "en"): Greeting {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 5 * 60 && minutes < 11 * 60) return { text: t(language, "greeting.morning"), icon: "sun" };
  if (minutes >= 11 * 60 && minutes < 18 * 60) return { text: t(language, "greeting.day"), icon: "spark" };
  if (minutes >= 18 * 60 && minutes < 22 * 60) return { text: t(language, "greeting.evening"), icon: "sunset" };
  return { text: t(language, "greeting.night"), icon: "moon" };
}
