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
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("بازکردن تنظیمات دسترسی مکان پس‌زمینه ممکن نشد.", error);
        }
    }
}
