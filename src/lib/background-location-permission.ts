import { registerPlugin } from "@capacitor/core";

type BackgroundLocationPermissionPlugin = {
  check(): Promise<{ required: boolean; granted: boolean }>;
  openSettings(): Promise<void>;
};

export const BackgroundLocationPermission = registerPlugin<BackgroundLocationPermissionPlugin>(
  "BackgroundLocationPermission",
);
