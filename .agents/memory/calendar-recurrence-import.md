---
name: Calendar recurrence import
description: Product behavior and safety bounds for recurring events imported from iCalendar files.
---

Imported recurrence rules should expand only when their behavior is supported and bounded. The current supported set covers DAILY, WEEKLY, MONTHLY, and YEARLY, with interval, count, until, weekday, and month-day filters. Unsupported or invalid rules remain a one-time event and must produce a visible warning rather than silently pretending to repeat.

**Why:** iCalendar recurrence has a large surface area, and unbounded or partially interpreted rules can create missing or misleading calendar events.

**How to apply:** When extending recurrence support, add explicit parsing and tests for each newly supported rule part; preserve the warning behavior for rules the importer still cannot interpret.
