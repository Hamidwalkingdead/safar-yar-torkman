export function normalizeIranPhone(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (/^09[0-9]{9}$/.test(digits)) return digits;
  if (/^9[0-9]{9}$/.test(digits)) return `0${digits}`;
  if (/^989[0-9]{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^00989[0-9]{9}$/.test(digits)) return `0${digits.slice(4)}`;
  return null;
}
