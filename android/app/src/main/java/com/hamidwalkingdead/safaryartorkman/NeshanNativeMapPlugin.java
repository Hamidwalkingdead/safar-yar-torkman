package com.hamidwalkingdead.safaryartorkman;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.location.LocationListener;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import org.maplibre.android.annotations.Marker;
import org.maplibre.android.annotations.MarkerOptions;
import org.maplibre.android.camera.CameraUpdateFactory;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.MapLibreMap;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;

/** Full-screen native Neshan map picker shared by passenger, driver and admin apps. */
@CapacitorPlugin(name = "NeshanNativeMap")
public class NeshanNativeMapPlugin extends Plugin {
    private static final String DARK_STYLE = "https://static.neshan.org/sdk/maplibre/styles/monochrome_dark.json";

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

            TextView mapStatus = new TextView(activity);
            mapStatus.setText("در حال بارگذاری نقشه نشان…");
            mapStatus.setTextColor(Color.WHITE);
            mapStatus.setTextSize(12);
            mapStatus.setGravity(Gravity.CENTER);
            mapStatus.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(30, 35, 44)));
            FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            statusParams.topMargin = 28;
            root.addView(mapStatus, statusParams);

            LinearLayout controls = new LinearLayout(activity);
            controls.setOrientation(LinearLayout.VERTICAL);
            controls.setGravity(Gravity.CENTER);
            controls.setPadding(6, 6, 6, 6);
            controls.setBackgroundColor(Color.rgb(30, 35, 44));
            FrameLayout.LayoutParams controlsParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.START | Gravity.CENTER_VERTICAL);
            controlsParams.leftMargin = 18;
            root.addView(controls, controlsParams);

            Button zoomIn = controlButton(activity, "+");
            Button zoomOut = controlButton(activity, "−");
            Button locate = controlButton(activity, "◎");
            Button tilt = controlButton(activity, "3D");
            controls.addView(zoomIn, new LinearLayout.LayoutParams(54, 54));
            controls.addView(zoomOut, new LinearLayout.LayoutParams(54, 54));
            controls.addView(locate, new LinearLayout.LayoutParams(54, 54));
            controls.addView(tilt, new LinearLayout.LayoutParams(54, 54));

            LinearLayout bottom = new LinearLayout(activity);
            bottom.setOrientation(LinearLayout.VERTICAL);
            bottom.setPadding(24, 16, 24, 24);
            bottom.setBackgroundColor(Color.rgb(20, 24, 31));
            TextView hint = new TextView(activity);
            hint.setText("نقشه را با انگشت بکشید؛ برای انتخاب محل، همان نقطه را لمس کنید");
            hint.setTextColor(Color.WHITE);
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
                window.setStatusBarColor(Color.rgb(20, 24, 31));
                window.setNavigationBarColor(Color.rgb(20, 24, 31));
            }

            final boolean[] completed = { false };
            final MapLibreMap[] mapRef = { null };
            final Marker[] selectedMarker = { null };
            final LatLng[] selectedPoint = { null };
            confirm.setEnabled(false);
            zoomIn.setEnabled(false);
            zoomOut.setEnabled(false);
            locate.setEnabled(false);
            tilt.setEnabled(false);

            mapView.getMapAsync(map -> {
                mapRef[0] = map;
                map.setStyle(new Style.Builder().fromUri(DARK_STYLE), style -> {
                    map.setCameraPosition(new CameraPosition.Builder()
                        .target(new LatLng(mapLat, mapLng))
                        .zoom(Math.max(3.0, Math.min(mapZoom, 20.0)))
                        .tilt(42.0)
                        .bearing(0.0)
                        .build());
                    // Native map gestures provide continuous panning with momentum/fling.
                    map.getUiSettings().setScrollGesturesEnabled(true);
                    map.getUiSettings().setZoomGesturesEnabled(true);
                    map.getUiSettings().setRotateGesturesEnabled(true);
                    map.getUiSettings().setTiltGesturesEnabled(true);
                    mapStatus.setText("برای انتخاب، روی هر نقطه از نقشه لمس کنید و نقشه را آزادانه بکشید");
                    map.setOnMapClickListener(point -> {
                        selectedPoint[0] = point;
                        if (selectedMarker[0] == null) {
                            selectedMarker[0] = map.addMarker(new MarkerOptions().position(point).title("محل انتخاب‌شده"));
                        } else {
                            selectedMarker[0].setPosition(point);
                        }
                        mapStatus.setText("محل انتخاب شد؛ برای جابه‌جایی، نقطه دیگری از نقشه را لمس کنید");
                        confirm.setEnabled(true);
                        return true;
                    });
                    confirm.setEnabled(false);
                    zoomIn.setEnabled(true);
                    zoomOut.setEnabled(true);
                    locate.setEnabled(true);
                    tilt.setEnabled(true);
                });
            });

            zoomIn.setOnClickListener(v -> {
                if (mapRef[0] != null) mapRef[0].animateCamera(CameraUpdateFactory.zoomIn());
            });
            zoomOut.setOnClickListener(v -> {
                if (mapRef[0] != null) mapRef[0].animateCamera(CameraUpdateFactory.zoomOut());
            });
            tilt.setOnClickListener(v -> {
                if (mapRef[0] == null) return;
                double currentTilt = mapRef[0].getCameraPosition().tilt;
                double nextTilt = currentTilt > 20.0 ? 0.0 : 48.0;
                mapRef[0].animateCamera(CameraUpdateFactory.tiltTo(nextTilt, 450));
                tilt.setText(nextTilt > 0 ? "2D" : "3D");
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
                    if (best != null) {
                        LatLng point = new LatLng(best.getLatitude(), best.getLongitude());
                        mapRef[0].animateCamera(CameraUpdateFactory.newLatLngZoom(point, 17.0));
                        selectedPoint[0] = point;
                        if (selectedMarker[0] == null) selectedMarker[0] = mapRef[0].addMarker(new MarkerOptions().position(point).title("موقعیت فعلی"));
                        else selectedMarker[0].setPosition(point);
                        confirm.setEnabled(true);
                        mapStatus.setText("موقعیت فعلی انتخاب شد؛ در صورت نیاز روی نقطه دیگری لمس کنید");
                        return;
                    }
                    mapStatus.setText("در حال دریافت موقعیت زنده از GPS…");
                    final Handler handler = new Handler(Looper.getMainLooper());
                    final LocationListener listener = new LocationListener() {
                        @Override public void onLocationChanged(Location location) {
                            manager.removeUpdates(this);
                            handler.removeCallbacksAndMessages(null);
                            if (mapRef[0] != null) {
                                LatLng point = new LatLng(location.getLatitude(), location.getLongitude());
                                mapRef[0].animateCamera(CameraUpdateFactory.newLatLngZoom(point, 17.0));
                                selectedPoint[0] = point;
                                if (selectedMarker[0] == null) selectedMarker[0] = mapRef[0].addMarker(new MarkerOptions().position(point).title("موقعیت فعلی"));
                                else selectedMarker[0].setPosition(point);
                                confirm.setEnabled(true);
                            }
                            mapStatus.setText("موقعیت فعلی انتخاب شد؛ در صورت نیاز روی نقطه دیگری لمس کنید");
                        }
                    };
                    boolean requested = false;
                    for (String provider : manager.getProviders(true)) {
                        try {
                            manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper());
                            requested = true;
                        } catch (SecurityException ignored) { }
                    }
                    if (!requested) {
                        mapStatus.setText("GPS در دسترس نیست؛ موقعیت‌یابی گوشی را روشن کنید");
                        return;
                    }
                    handler.postDelayed(() -> {
                        manager.removeUpdates(listener);
                        mapStatus.setText("موقعیت دریافت نشد؛ GPS و مجوز مکان‌یابی را بررسی کنید");
                    }, 15000L);
                } catch (SecurityException error) {
                    mapStatus.setText("دسترسی مکان‌یابی داده نشده است");
                } catch (Exception error) {
                    mapStatus.setText("موقعیت‌یابی ناموفق بود؛ GPS را بررسی کنید");
                }
            });

            confirm.setOnClickListener(v -> {
                MapLibreMap current = mapRef[0];
                if (current == null) return;
                LatLng point = selectedPoint[0];
                if (point == null) {
                    mapStatus.setText("ابتدا یک نقطه از نقشه را لمس کنید یا مکان‌یابی را بزنید");
                    return;
                }
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
