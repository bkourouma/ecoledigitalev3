export const SETTINGS_TABS = ["periods", "levels", "funding", "enrollments", "numbering", "calendar"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value ?? "");
}
