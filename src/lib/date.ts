import dayjs from 'dayjs';

export function currentMonthRange(): { from: string; to: string } {
  const start = dayjs().startOf('month').format('YYYY-MM-DD');
  const end = dayjs().endOf('month').format('YYYY-MM-DD');
  return { from: start, to: end };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toValidDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatDateInTz(
  dateOrMsOrIso: Date | string | number,
  tz: string,
  locale = "fr-FR"
): string {
  if (typeof dateOrMsOrIso === "string" && ISO_DATE_PATTERN.test(dateOrMsOrIso)) {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateFromIsoDate(dateOrMsOrIso));
  }

  const date = toValidDate(dateOrMsOrIso);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function toISODateInTz(
  dateOrMsOrIso: Date | string | number,
  tz: string
): string {
  if (typeof dateOrMsOrIso === "string" && ISO_DATE_PATTERN.test(dateOrMsOrIso)) {
    return dateOrMsOrIso;
  }
  const date = toValidDate(dateOrMsOrIso);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
