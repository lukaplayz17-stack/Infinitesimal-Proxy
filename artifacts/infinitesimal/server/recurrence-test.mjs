import assert from "node:assert/strict";
import { expandRecurringEvent, parseRecurrenceRule } from "../public/js/ics-recurrence.js";

const localDate = (day, hour = 9) => new Date(2026, 0, day, hour).toISOString();
const event = {
  id: "weekly-class",
  title: "Study group",
  startAt: localDate(5),
  endAt: localDate(5, 10),
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
};
const repeated = expandRecurringEvent(event, new Date(2026, 0, 1), new Date(2026, 1, 1));
assert.deepEqual(repeated.map(item => new Date(item.startAt).getDate()), [5, 7, 12, 14]);
assert.ok(repeated.every(item => item.id === event.id && item.occurrenceId));

const monthly = expandRecurringEvent({
  id: "monthly",
  title: "Monthly review",
  startAt: localDate(15),
  rrule: "FREQ=MONTHLY;COUNT=3",
}, new Date(2026, 0, 1), new Date(2026, 3, 1));
assert.deepEqual(monthly.map(item => new Date(item.startAt).getMonth()), [0, 1, 2]);

const bounded = expandRecurringEvent({
  id: "bounded",
  title: "Bounded",
  startAt: localDate(5),
  rrule: "FREQ=DAILY;INTERVAL=2;UNTIL=20260109T235959",
}, new Date(2026, 0, 1), new Date(2026, 0, 15));
assert.deepEqual(bounded.map(item => new Date(item.startAt).getDate()), [5, 7, 9]);
assert.throws(() => parseRecurrenceRule("FREQ=WEEKLY;BYDAY=2MO"), /Ordinal or invalid BYDAY/);

process.stdout.write("ICS recurrence tests passed.\n");
