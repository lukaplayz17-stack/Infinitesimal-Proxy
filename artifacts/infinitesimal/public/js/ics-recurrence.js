const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) {
    const date = new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00", utc] = match;
  const date = utc
    ? new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
    : new Date(+year, +month - 1, +day, +hour, +minute, +second);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function parseRecurrenceRule(raw) {
  const fields = {};
  for (const part of String(raw || "").split(";")) {
    const [key, ...values] = part.split("=");
    if (!key || !values.length) throw new Error("The recurring event rule is malformed.");
    fields[key.toUpperCase()] = values.join("=").toUpperCase();
  }
  const supported = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);
  const unsupported = Object.keys(fields).filter(key => !supported.has(key));
  if (unsupported.length) throw new Error(`Unsupported recurrence rule: ${unsupported.join(", ")}.`);

  const freq = fields.FREQ;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    throw new Error(`Unsupported recurrence frequency: ${freq || "missing"}.`);
  }
  const interval = fields.INTERVAL === undefined ? 1 : Number(fields.INTERVAL);
  const count = fields.COUNT === undefined ? null : Number(fields.COUNT);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) {
    throw new Error("Recurrence interval must be between 1 and 1000.");
  }
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 5000)) {
    throw new Error("Recurrence count must be between 1 and 5000.");
  }

  const byday = fields.BYDAY?.split(",").map(code => {
    if (!Object.hasOwn(DAY_CODES, code)) throw new Error("Ordinal or invalid BYDAY rules are not supported.");
    return DAY_CODES[code];
  }) || null;
  if (byday && freq !== "DAILY" && freq !== "WEEKLY") {
    throw new Error("BYDAY is currently supported only for daily and weekly repeats.");
  }
  const bymonthday = fields.BYMONTHDAY?.split(",").map(Number) || null;
  if (bymonthday && !["MONTHLY", "YEARLY"].includes(freq)) {
    throw new Error("BYMONTHDAY is currently supported only for monthly and yearly repeats.");
  }
  if (bymonthday?.some(day => !Number.isInteger(day) || day === 0 || day < -31 || day > 31)) {
    throw new Error("BYMONTHDAY values must be between -31 and 31, excluding zero.");
  }
  const bymonth = fields.BYMONTH?.split(",").map(Number) || null;
  if (bymonth?.some(month => !Number.isInteger(month) || month < 1 || month > 12)) {
    throw new Error("BYMONTH values must be between 1 and 12.");
  }
  if (fields.WKST && !Object.hasOwn(DAY_CODES, fields.WKST)) {
    throw new Error("WKST must be a valid weekday code.");
  }
  const until = fields.UNTIL ? parseDate(fields.UNTIL) : null;
  if (fields.UNTIL && !until) throw new Error("The recurrence UNTIL date is invalid.");

  return { freq, interval, count, until, byday, bymonthday, bymonth, weekStart: fields.WKST ? DAY_CODES[fields.WKST] : 1 };
}

function matchesRule(date, start, rule) {
  if (rule.byday && !rule.byday.includes(date.getDay())) return false;
  if (rule.freq === "DAILY") {
    const days = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
    return days >= 0 && days % rule.interval === 0;
  }
  if (rule.freq === "WEEKLY") {
    const weekStart = date => {
      const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      copy.setDate(copy.getDate() - ((copy.getDay() - rule.weekStart + 7) % 7));
      return copy;
    };
    const weeks = Math.floor((weekStart(date) - weekStart(start)) / (7 * 86_400_000));
    const weekdays = rule.byday || [start.getDay()];
    return weeks >= 0 && weeks % rule.interval === 0 && weekdays.includes(date.getDay());
  }
  if (rule.freq === "MONTHLY") {
    const months = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
    if (months < 0 || months % rule.interval !== 0) return false;
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const wantedDays = rule.bymonthday || [start.getDate()];
    return wantedDays.some(day => (day > 0 ? day : lastDay + day + 1) === date.getDate());
  }
  const years = date.getFullYear() - start.getFullYear();
  if (years < 0 || years % rule.interval !== 0) return false;
  if (rule.bymonth && !rule.bymonth.includes(date.getMonth() + 1)) return false;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const wantedDays = rule.bymonthday || [start.getDate()];
  return wantedDays.some(day => (day > 0 ? day : lastDay + day + 1) === date.getDate()) &&
    (rule.bymonth !== null || date.getMonth() === start.getMonth());
}

export function expandRecurringEvent(event, rangeStart, rangeEnd) {
  const start = new Date(event.startAt);
  const from = new Date(rangeStart);
  const to = new Date(rangeEnd);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return [];
  if (!event.rrule) {
    return start >= from && start < to ? [{ ...event, occurrenceAt: start.toISOString() }] : [];
  }

  const rule = parseRecurrenceRule(event.rrule);
  const until = rule.until ? Math.min(rule.until.valueOf(), to.valueOf() - 1) : to.valueOf() - 1;
  const duration = event.endAt ? Math.max(0, new Date(event.endAt).valueOf() - start.valueOf()) : 0;
  const occurrences = [];
  const candidate = new Date(start);
  let occurrenceCount = 0;
  let attempts = 0;

  while (candidate.valueOf() <= until && attempts < 200_000) {
    attempts++;
    if (matchesRule(candidate, start, rule)) {
      occurrenceCount++;
      if (rule.count !== null && occurrenceCount > rule.count) break;
      if (candidate >= from) {
        const occurrenceAt = candidate.toISOString();
        occurrences.push({
          ...event,
          occurrenceAt,
          occurrenceId: `${event.id || event.title}:${occurrenceAt}`,
          startAt: occurrenceAt,
          endAt: duration ? new Date(candidate.valueOf() + duration).toISOString() : event.endAt,
        });
      }
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return occurrences;
}
