// supabase/functions/helpers/calcLeaveDays.ts

export type HolidayRow = {
  date: string; // "YYYY-MM-DD"
  is_half_day: boolean;
  half: "morning" | "afternoon" | null;
};

function toDateOnlyISO(d: Date): string {
  // Force "YYYY-MM-DD" in UTC to avoid timezone drift
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekendUTC(d: Date): boolean {
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 6;
}

/**
 * Counts working-day leave between start_date and end_date (inclusive),
 * excluding weekends, excluding full-day holidays, subtracting 0.5 for half-day holidays.
 * Returns increments of 0.5.
 */
export function calcLeaveDays(params: {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  holidays: HolidayRow[];
}): number {
  const { startDate, endDate, holidays } = params;

  const holidayByDate = new Map<string, HolidayRow>();
  for (const h of holidays) holidayByDate.set(h.date, h);

  // Parse as UTC dates
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (start > end) return 0;

  let total = 0;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (isWeekendUTC(d)) continue;

    const iso = toDateOnlyISO(d);
    const h = holidayByDate.get(iso);

    // Default working day counts as 1
    let dayValue = 1;

    if (h) {
      if (!h.is_half_day) dayValue = 0;
      else dayValue = 0.5; // half-day holiday means only half of that day is leave-deductible
    }

    total += dayValue;
  }

  // Normalize to nearest 0.5 (avoids floating noise)
  return Math.round(total * 2) / 2;
}
