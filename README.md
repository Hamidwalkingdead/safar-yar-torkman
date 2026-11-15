# Safar Yar Torkman

Build a polished Persian RTL ride-hailing web app prototype with a distinctive original brand and visual identity (do not copy Maxim branding/layout). Working title: «راه‌یار». Mobile-first responsive UI. Include separate passenger and driver flows, trip request and driver acceptance, passenger name visible from the beginning, and only reveal both parties' phone numbers/contact buttons after a driver accepts. Include central support/helpdesk UI with online issue reporting and complaint ticket status. Fare rules in toman: minimum fare 80,000; standard rate 14,000 per km; night surcharge +1,500 per km; difficult/mountain road rate 16,000 per km instead of standard rate; for trips beyond 300 km add 1,000 per km only for kilometers over 300; passenger can suggest a fare from the initial request screen; platform commission is 10% of fare. Show clear fare breakdown and calculate 10% commission separately. For overlapping night/mountain/long-trip conditions, use mountain rate instead of standard and apply night surcharge on top; apply long-distance surcharge only to distance beyond 300 km; enforce minimum fare last. Add demo data and interactive screens for passenger request, fare suggestion, driver incoming offers/acceptance, trip details, support center, and basic profile/settings. Use Persian labels and Persian numerals where practical. State this is a functional prototype/demo; don't fake real phone calls, payment, GPS, or live dispatch—show realistic UI and clearly mark integrations needing setup. Keep app identity, colors, typography, iconography and layout original.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://safar-yar-torkman.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/39c246c8-e415-4c54-94b1-9751703c447b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Neshan map setup

Add these as **GitHub Actions repository secrets**; never put service-key values in source code:

- `NESHAN_MAP_KEY` — Neshan Web map key. It is injected into the WebView as `VITE_NESHAN_MAP_KEY`; it is public by design.
- `NESHAN_SERVICE_KEY` — optional shared Neshan Service key.
- `NESHAN_SEARCH_KEY` — required dedicated Service key with Search permission.
- `NESHAN_ROUTE_KEY`, `NESHAN_REVERSE_KEY` — optional dedicated Service keys; they fall back to `NESHAN_SERVICE_KEY` when omitted.
- `SUPABASE_ACCESS_TOKEN` — allows the deployment workflow to configure Supabase secrets and deploy the three Neshan Edge Functions.

The deployment workflow copies Service keys into Supabase Edge Function secrets. They are never included in APK builds. The Android workflow checks that map tiles' SDK, reverse geocoding, place search and road routing APIs are reachable before producing the three APKs. Straight-line distance is never used as road distance.


## سه برنامه مستقل اندروید

این مخزن یک کدپایه و یک پروژه Supabase مشترک دارد، اما سه برنامه اندرویدی مستقل می‌سازد:
- مسافر: شناسه نصب `com.hamidwalkingdead.safaryartorkman.passenger`
- راننده: شناسه نصب `com.hamidwalkingdead.safaryartorkman.driver`
- مدیریت: شناسه نصب `com.hamidwalkingdead.safaryartorkman.admin`

هر برنامه مسیرهای غیرمرتبط با نقش خود را مسدود می‌کند. مجوزهای واقعی همچنان در Supabase و با RLS و نقش‌های پایگاه داده کنترل می‌شوند؛ پنهان‌کردن صفحه در برنامه جایگزین امنیت سرور نیست. خروجی‌ها از گردش‌کار Android APK به‌صورت سه فایل جداگانه ساخته می‌شوند. برای ساخت محلی هر نسخه، مقدار `VITE_APP_TARGET` را روی `passenger`، `driver` یا `admin` قرار دهید و سپس build و Capacitor sync را اجرا کنید.
