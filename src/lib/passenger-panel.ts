type PassengerProfile = {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  emergency_phone?: string | null;
} | null;

export function normalizeIranianMobile(value: string) {
  const ascii = value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const digits = ascii.replace(/\D/g, "");
  if (digits.startsWith("0098") && digits.length === 14) return `0${digits.slice(4)}`;
  if (digits.startsWith("98") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `0${digits}`;
  return digits;
}

export function isIranianMobile(value: string | null | undefined) {
  return /^09\d{9}$/.test(normalizeIranianMobile(value ?? ""));
}

export function passengerProfileComplete(profile: PassengerProfile) {
  if (!profile) return false;
  return (
    (profile.first_name?.trim().length ?? 0) >= 2 &&
    (profile.last_name?.trim().length ?? 0) >= 2 &&
    (profile.display_name?.trim().length ?? 0) >= 2 &&
    isIranianMobile(profile.phone) &&
    isIranianMobile(profile.emergency_phone)
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
