package com.hamidwalkingdead.safaryartorkman;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
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
import org.maplibre.android.camera.CameraUpdateFactory;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;

/** Full-screen native Neshan map picker shared by passenger, driver and admin apps. */
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

    private Button controlButton(Activity activity, String label) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextSize(18);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(Color.rgb(30, 41, 59));
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(0, 0, 0, 0);
        return button;
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
            root.addView(mapView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
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

            TextView mapStatus = new TextView(activity);
            mapStatus.setText("در حال بارگذاری نقشه نشان…");
            mapStatus.setTextColor(Color.DKGRAY);
            mapStatus.setTextSize(12);
            mapStatus.setGravity(Gravity.CENTER);
            mapStatus.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
            FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            statusParams.topMargin = 28;
            root.addView(mapStatus, statusParams);

            LinearLayout controls = new LinearLayout(activity);
            controls.setOrientation(LinearLayout.VERTICAL);
            controls.setGravity(Gravity.CENTER);
            controls.setPadding(6, 6, 6, 6);
            controls.setBackgroundColor(Color.WHITE);
            FrameLayout.LayoutParams controlsParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.START | Gravity.CENTER_VERTICAL);
            controlsParams.leftMargin = 18;
            root.addView(controls, controlsParams);

            Button zoomIn = controlButton(activity, "+");
            Button zoomOut = controlButton(activity, "−");
            Button locate = controlButton(activity, "◎");
            controls.addView(zoomIn, new LinearLayout.LayoutParams(54, 54));
            controls.addView(zoomOut, new LinearLayout.LayoutParams(54, 54));
            controls.addView(locate, new LinearLayout.LayoutParams(54, 54));

            LinearLayout bottom = new LinearLayout(activity);
            bottom.setOrientation(LinearLayout.VERTICAL);
            bottom.setPadding(24, 16, 24, 24);
            bottom.setBackgroundColor(Color.WHITE);
            TextView hint = new TextView(activity);
            hint.setText("نقشه را حرکت دهید تا محل دقیق زیر نشانگر قرار بگیرد");
            hint.setTextColor(Color.DKGRAY);
            hint.setTextSize(14);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(0, 0, 0, 10);
            Button confirm = new Button(activity);
            confirm.setText("تأیید محل انتخاب‌شده");
            confirm.setTextSize(16);
            confirm.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            confirm.setTextColor(Color.WHITE);
            confirm.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(22, 163, 74)));
            bottom.addView(hint, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            bottom.addView(confirm, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 58));
            FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
            root.addView(bottom, bottomParams);

            Button close = controlButton(activity, "×");
            FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(52, 52, Gravity.TOP | Gravity.END);
            closeParams.setMargins(0, 24, 18, 0);
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
            zoomIn.setEnabled(false);
            zoomOut.setEnabled(false);
            locate.setEnabled(false);

            mapView.getMapAsync(map -> {
                mapRef[0] = map;
                map.setStyle(new Style.Builder().fromUri(LIGHT_STYLE), style -> {
                    map.setCameraPosition(new CameraPosition.Builder()
                        .target(new LatLng(mapLat, mapLng))
                        .zoom(Math.max(3.0, Math.min(mapZoom, 20.0)))
                        .build());
                    mapStatus.setText("نقشه آماده است");
                    confirm.setEnabled(true);
                    zoomIn.setEnabled(true);
                    zoomOut.setEnabled(true);
                    locate.setEnabled(true);
                });
            });

            zoomIn.setOnClickListener(v -> {
                if (mapRef[0] != null) mapRef[0].animateCamera(CameraUpdateFactory.zoomIn());
            });
            zoomOut.setOnClickListener(v -> {
                if (mapRef[0] != null) mapRef[0].animateCamera(CameraUpdateFactory.zoomOut());
            });
            locate.setOnClickListener(v -> {
                if (mapRef[0] == null) return;
                if (activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                    && activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
                    }, 7412);
                    mapStatus.setText("مجوز مکان‌یابی را صادر کنید و دوباره دکمه مکان‌یابی را بزنید");
                    return;
                }
                try {
                    LocationManager manager = (LocationManager) activity.getSystemService(Activity.LOCATION_SERVICE);
                    Location best = null;
                    for (String provider : manager.getProviders(true)) {
                        Location candidate = manager.getLastKnownLocation(provider);
                        if (candidate != null && (best == null || candidate.getTime() > best.getTime())) best = candidate;
                    }
                    if (best == null) {
                        mapStatus.setText("موقعیت فعلی هنوز دریافت نشده؛ GPS گوشی را روشن کنید");
                        return;
                    }
                    mapRef[0].animateCamera(CameraUpdateFactory.newLatLngZoom(
                        new LatLng(best.getLatitude(), best.getLongitude()), 17.0));
                    mapStatus.setText("روی موقعیت فعلی شما قرار گرفت");
                } catch (SecurityException error) {
                    mapStatus.setText("دسترسی مکان‌یابی داده نشده است");
                } catch (Exception error) {
                    mapStatus.setText("موقعیت‌یابی ناموفق بود؛ GPS را بررسی کنید");
                }
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
