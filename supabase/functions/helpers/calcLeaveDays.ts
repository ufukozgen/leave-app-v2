// supabase/functions/helpers/calcLeaveDays.ts

export type HolidayRow = {
  date: string; // "YYYY-MM-DD"
  is_half_day: boolean;
  half: "morning" | "afternoon" | null;
};

type LeaveDurationType = "full" | "half-am" | "half-pm";
type DayHalf = "morning" | "afternoon";

function toDateOnlyISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekendUTC(d: Date): boolean {
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 6;
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function parseDurationType(v: unknown): LeaveDurationType {
  const dt = norm(v);
  if (dt === "half-am") return "half-am";
  if (dt === "half-pm") return "half-pm";
  return "full";
}

function leaveHalf(dt: LeaveDurationType): DayHalf | null {
  if (dt === "half-am") return "morning";
  if (dt === "half-pm") return "afternoon";
  return null;
}

/**
 * Counts leave days between start_date and end_date (inclusive),
 * excluding weekends, excluding full-day holidays, and handling half-day holidays.
 *
 * ✅ Supports leave duration_type:
 *  - full: normal working-day counting (1 per day, 0 on full holiday, 0.5 on half-holiday)
 *  - half-am / half-pm:
 *      * on normal working day => 0.5
 *      * on full holiday => 0
 *      * on half-day holiday:
 *          - if holiday half matches leave half => 0
 *          - if holiday half is opposite => 0.5
 *          - if holiday half unknown (null) => 0.5 (safe fallback)
 *
 * Assumption (recommended): half-day leaves are single-day requests.
 * If someone creates a multi-day leave with half-am/half-pm, we apply half-day ONLY on start_date,
 * and treat the remaining days as full days.
 */
export function calcLeaveDays(params: {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  holidays: HolidayRow[];
  durationType?: unknown; // "full" | "half-am" | "half-pm"
}): number {
  const { startDate, endDate, holidays, durationType } = params;

  const holidayByDate = new Map<string, HolidayRow>();
  for (const h of holidays) holidayByDate.set(h.date, h);

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (start > end) return 0;

  const dt = parseDurationType(durationType);
  const reqHalf = leaveHalf(dt);
  const isSingleDay = startDate === endDate;

  let total = 0;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWeekendUTC(d)) continue;

    const iso = toDateOnlyISO(d);
    const h = holidayByDate.get(iso);

    // Day working capacity after holiday rules:
    // 1 = normal working day
    // 0.5 = half-day holiday (only half of day is deductible)
    // 0 = full holiday (not deductible)
    let workingValue = 1;

    if (h) {
      if (!h.is_half_day) workingValue = 0;
      else workingValue = 0.5;
    }

    if (workingValue === 0) continue;

    // FULL leave: keep your original behavior
    if (dt === "full") {
      total += workingValue;
      continue;
    }

    // HALF leave: apply only on start day (or the only day)
    const isStartDay = iso === startDate;
    const applyHalfToday = isSingleDay || isStartDay;

    if (!applyHalfToday) {
      // Remaining days behave as full leave (defensive behavior)
      total += workingValue;
      continue;
    }

    // Half leave on half-day holiday:
    if (h?.is_half_day && workingValue === 0.5) {
      // If holiday half matches leave half => leave falls into the holiday => 0
      // If opposite => 0.5
      // If holiday half unknown => 0.5 (safe)
      if (h.half && reqHalf && h.half === reqHalf) {
        continue;
      }
      total += 0.5;
      continue;
    }

    // Half leave on a normal working day
    total += 0.5;
  }

  return Math.round(total * 2) / 2;
}