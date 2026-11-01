import { useState } from "react";
import { fa } from "@/lib/fare";
import {
  isoDateToJalali,
  jalaliMonthLength,
  jalaliMonths,
  jalaliToIsoDate,
  todayJalali,
} from "@/lib/jalali";

/** Shamsi date picker; value/onChange use Gregorian ISO "YYYY-MM-DD" (or ""). */
export function JalaliDateInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  label: string;
}) {
  const [ty] = todayJalali();
  const parsed = isoDateToJalali(value);
  const [draft, setDraft] = useState<[number, number, number]>(parsed ?? [0, 0, 0]);
  const [y, m, d] = parsed ?? draft;
  const set = (ny: number, nm: number, nd: number) => {
    const max = ny && nm ? jalaliMonthLength(ny, nm) : 31;
    const day = Math.min(nd, max);
    setDraft([ny, nm, day]);
    onChange(ny && nm && day ? jalaliToIsoDate(ny, nm, day) : "");
  };
  const cls = "min-w-0 rounded-xl bg-muted px-1 py-3 text-sm";
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1">
      <select
        aria-label={`${label} روز`}
        value={d}
        onChange={(e) => set(y, m, +e.target.value)}
        className={cls}
      >
        <option value={0}>روز</option>
        {Array.from({ length: y && m ? jalaliMonthLength(y, m) : 31 }, (_, i) => (
          <option key={i} value={i + 1}>
            {fa(i + 1)}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} ماه`}
        value={m}
        onChange={(e) => set(y, +e.target.value, d)}
        className={cls}
      >
        <option value={0}>ماه</option>
        {jalaliMonths.map((n, i) => (
          <option key={n} value={i + 1}>
            {n}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} سال`}
        value={y}
        onChange={(e) => set(+e.target.value, m, d)}
        className={cls}
      >
        <option value={0}>سال</option>
        {[ty, ty + 1].map((n) => (
          <option key={n} value={n}>
            {String(n).replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[+c] ?? c)}
          </option>
        ))}
      </select>
    </div>
  );
}
