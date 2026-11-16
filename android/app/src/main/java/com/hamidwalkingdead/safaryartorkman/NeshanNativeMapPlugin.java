package com.hamidwalkingdead.safaryartorkman;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.maplibre.android.MapLibre;
import org.maplibre.android.camera.CameraPosition;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;

/** Full-screen native Neshan map picker used by all three Capacitor app flavors. */
@CapacitorPlugin(name = "NeshanNativeMap")
public class NeshanNativeMapPlugin extends Plugin {
    private static final String LIGHT_STYLE = "https://static.neshan.org/sdk/maplibre/styles/light.json";

    @PluginMethod
    public void pickPoint(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("صفحه اندروید در دسترس نیست.");
            return;
        }
        activity.runOnUiThread(() -> openPicker(call));
    }

    private void openPicker(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("برنامه در حال بسته‌شدن است.");
            return;
        }

        double initialLat = call.getDouble("lat", 37.25);
        double initialLng = call.getDouble("lng", 55.17);
        double initialZoom = call.getDouble("zoom", 15.0);
        if (initialLat < -90 || initialLat > 90 || initialLng < -180 || initialLng > 180) {
            initialLat = 37.25;
            initialLng = 55.17;
        }
        final double mapLat = initialLat;
        final double mapLng = initialLng;
        final double mapZoom = initialZoom;

        try {
            MapLibre.getInstance(activity);
            Dialog dialog = new Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

            FrameLayout root = new FrameLayout(activity);
            root.setBackgroundColor(Color.WHITE);
            MapView mapView = new MapView(activity);
            FrameLayout.LayoutParams mapParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
            root.addView(mapView, mapParams);
            mapView.onCreate((Bundle) null);

            TextView centerPin = new TextView(activity);
            centerPin.setText("●");
            centerPin.setTextColor(Color.rgb(220, 38, 38));
            centerPin.setTextSize(34);
            centerPin.setShadowLayer(5, 0, 2, Color.WHITE);
            centerPin.setGravity(Gravity.CENTER);
            FrameLayout.LayoutParams pinParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
            pinParams.bottomMargin = 22;
            root.addView(centerPin, pinParams);

            LinearLayout bottom = new LinearLayout(activity);
            bottom.setOrientation(LinearLayout.VERTICAL);
            bottom.setPadding(28, 22, 28, 28);
            bottom.setBackgroundColor(Color.WHITE);
            TextView hint = new TextView(activity);
            hint.setText("نقشه را حرکت دهید تا نقطه موردنظر زیر نشانگر قرار بگیرد");
            hint.setTextColor(Color.DKGRAY);
            hint.setTextSize(14);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(0, 0, 0, 14);
            Button confirm = new Button(activity);
            confirm.setText("تأیید نقطه انتخاب‌شده");
            confirm.setTextSize(15);
            confirm.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            bottom.addView(hint, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            bottom.addView(confirm, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
            root.addView(bottom, bottomParams);

            Button close = new Button(activity);
            close.setText("×");
            close.setTextSize(24);
            close.setTextColor(Color.BLACK);
            close.setBackgroundColor(Color.WHITE);
            FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(150, 150, Gravity.TOP | Gravity.END);
            closeParams.setMargins(0, 24, 24, 0);
            root.addView(close, closeParams);

            dialog.setContentView(root);
            Window window = dialog.getWindow();
            if (window != null) {
                window.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
                window.setStatusBarColor(Color.WHITE);
                window.setNavigationBarColor(Color.WHITE);
            }

            final boolean[] completed = { false };
            final MapLibreMap[] mapRef = { null };
            confirm.setEnabled(false);
            mapView.getMapAsync(map -> {
                mapRef[0] = map;
                map.setStyle(new Style.Builder().fromUri(LIGHT_STYLE), style -> {
                    map.setCameraPosition(new CameraPosition.Builder()
                        .target(new LatLng(mapLat, mapLng))
                        .zoom(Math.max(3.0, Math.min(mapZoom, 20.0)))
                        .build());
                    confirm.setEnabled(true);
                });
            });

            confirm.setOnClickListener(v -> {
                MapLibreMap current = mapRef[0];
                if (current == null) return;
                LatLng point = current.getCameraPosition().target;
                if (point == null) return;
                completed[0] = true;
                JSObject result = new JSObject();
                result.put("lat", point.getLatitude());
                result.put("lng", point.getLongitude());
                dialog.dismiss();
                call.resolve(result);
            });
            close.setOnClickListener(v -> dialog.dismiss());
            dialog.setOnDismissListener(ignored -> {
                try {
                    mapView.onPause();
                    mapView.onStop();
                    mapView.onDestroy();
                } catch (Exception ignoredError) { }
                if (!completed[0]) call.reject("انتخاب نقطه لغو شد.");
            });

            dialog.show();
            if (window != null) window.setLayout(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
            mapView.onStart();
            mapView.onResume();
        } catch (Exception error) {
            call.reject("راه‌اندازی نقشه بومی نشان ناموفق بود: " + error.getMessage(), error);
        }
    }
}