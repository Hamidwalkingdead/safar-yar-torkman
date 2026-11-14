import { registerPlugin } from "@capacitor/core";

type SettingsTarget = "background_location" | "notifications";
type BackgroundLocationPermissionPlugin = {
  check(): Promise<{ required: boolean; granted: boolean }>;
  openSettings(options?: { permission?: SettingsTarget }): Promise<void>;
};

export const BackgroundLocationPermission = registerPlugin<BackgroundLocationPermissionPlugin>(
  "BackgroundLocationPermission",
);
