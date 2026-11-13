type PassengerProfile = {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  emergency_phone?: string | null;
} | null;

function normalizeIranianMobile(value: string) {
  const ascii = value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  return ascii.replace(/\D/g, "");
}

export function passengerProfileComplete(profile: PassengerProfile) {
  if (!profile) return false;
  return (
    (profile.first_name?.trim().length ?? 0) >= 2 &&
    (profile.last_name?.trim().length ?? 0) >= 2 &&
    (profile.display_name?.trim().length ?? 0) >= 2 &&
    /^09\d{9}$/.test(normalizeIranianMobile(profile.phone ?? "")) &&
    /^09\d{9}$/.test(normalizeIranianMobile(profile.emergency_phone ?? ""))
  );
}

export function passengerTripStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "در انتظار راننده",
    accepted: "راننده پذیرفت",
    ongoing: "در حال سفر",
    done: "پایان‌یافته",
    cancelled: "لغوشده",
  };
  return labels[status] ?? "وضعیت نامشخص";
}
