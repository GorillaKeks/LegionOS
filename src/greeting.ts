export type Greeting = { text: string; icon: "sun" | "sunset" | "spark" | "moon" };

/** Selects a greeting from the machine's local hour and minute. */
export function getGreeting(date: Date): Greeting {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 5 * 60 && minutes < 11 * 60) return { text: "Guten Morgen", icon: "sun" };
  if (minutes >= 11 * 60 && minutes < 18 * 60) return { text: "Guten Tag", icon: "spark" };
  if (minutes >= 18 * 60 && minutes < 22 * 60) return { text: "Guten Abend", icon: "sunset" };
  return { text: "Gute Nacht", icon: "moon" };
}
