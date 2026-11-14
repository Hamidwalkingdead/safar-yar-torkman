package com.hamidwalkingdead.safaryartorkman;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundLocationPermission")
public class BackgroundLocationPermissionPlugin extends Plugin {
    @PluginMethod
    public void check(PluginCall call) {
        boolean required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        boolean granted = !required || ContextCompat.checkSelfPermission(
            getContext(), android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("required", required);
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String permission = call.getString("permission", "background_location");
        try {
            Intent intent;
            if ("notifications".equals(permission)) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else if ("background_location".equals(permission) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Android 11+ exposes the per-app permission screen on supported Settings apps.
                intent = new Intent("android.intent.action.MANAGE_APP_PERMISSION");
                intent.putExtra("android.intent.extra.PERMISSION_NAME", android.Manifest.permission.ACCESS_BACKGROUND_LOCATION);
                intent.putExtra("android.intent.extra.PACKAGE_NAME", getContext().getPackageName());
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception unsupported) {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("بازکردن صفحه تنظیمات مجوز موردنیاز ممکن نشد.", error);
        }
    }
}
