# @civic-registry/deadlines

Pure deadline calculation and presentation utilities for the Civic Registry &
Transparency Engine.

This package contains no persistence and no bill-specific policy.

It provides:

- date-only anchor normalization;
- hour/calendar-day/business-day/week arithmetic;
- configured calendar handling;
- warning-window calculation;
- deadline urgency classification;
- public presentation helpers.

Persistent deadline instances and automatic reconciliation live in
`@civic-registry/database`.

See [Configurable deadline engine](../../docs/DEADLINES.md).
