import type {
  CompiledDeadlineCalendarConfig,
  DeadlineDefinitionConfig,
  DeadlineOffsetConfig,
} from "@civic-registry/config";
import type {
  DeadlineInstance,
  DeadlineUrgency,
} from "@civic-registry/core";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PresentedDeadline {
  id: string;
  deadlineTypeId: string;
  label: string;
  description?: string;
  anchorAt: string;
  dueAt: string;
  state: DeadlineInstance["state"];
  urgency: DeadlineUrgency;
  pausedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  publiclyVisible: boolean;
}

function requireValidDate(
  value: string,
  label: string,
): Date {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error(
      `${label} must be a valid ISO date or date-time.`,
    );
  }

  return date;
}

export function normalizeDeadlineAnchor(
  value: string,
  options: {
    dateOnlyAnchorTime?: "start" | "end";
  } = {},
): string {
  if (DATE_ONLY_PATTERN.test(value)) {
    return (
      options.dateOnlyAnchorTime === "start"
        ? `${value}T00:00:00.000Z`
        : `${value}T23:59:59.999Z`
    );
  }

  return requireValidDate(
    value,
    "Deadline anchor",
  ).toISOString();
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isBusinessDay(
  date: Date,
  calendar: CompiledDeadlineCalendarConfig,
): boolean {
  return (
    !calendar.weekendDays.has(date.getUTCDay()) &&
    !calendar.excludedDates.has(utcDateKey(date))
  );
}

function addBusinessDays(
  input: Date,
  value: number,
  calendar: CompiledDeadlineCalendarConfig,
  direction: 1 | -1,
): Date {
  const date = new Date(input.valueOf());
  let remaining = value;

  while (remaining > 0) {
    date.setUTCDate(
      date.getUTCDate() + direction,
    );

    if (isBusinessDay(date, calendar)) {
      remaining -= 1;
    }
  }

  return date;
}

export function applyDeadlineOffset(
  anchorAt: string,
  offset: DeadlineOffsetConfig,
  calendar: CompiledDeadlineCalendarConfig,
  direction: 1 | -1 = 1,
): string {
  const anchor = requireValidDate(
    anchorAt,
    "Deadline anchor",
  );
  const value = offset.value * direction;

  switch (offset.unit) {
    case "hours":
      anchor.setTime(
        anchor.valueOf() +
          value * 60 * 60 * 1000,
      );
      break;
    case "calendarDays":
      anchor.setUTCDate(
        anchor.getUTCDate() + value,
      );
      break;
    case "weeks":
      anchor.setUTCDate(
        anchor.getUTCDate() + value * 7,
      );
      break;
    case "businessDays":
      return addBusinessDays(
        anchor,
        offset.value,
        calendar,
        direction,
      ).toISOString();
  }

  return anchor.toISOString();
}

export function calculateDeadlineDueAt(
  anchorAt: string,
  definition: DeadlineDefinitionConfig,
  calendar: CompiledDeadlineCalendarConfig,
): string {
  return applyDeadlineOffset(
    anchorAt,
    definition.offset,
    calendar,
    1,
  );
}

export function calculateWarningAt(
  dueAt: string,
  definition: DeadlineDefinitionConfig,
  calendar: CompiledDeadlineCalendarConfig,
): string | undefined {
  if (!definition.warningOffset) {
    return undefined;
  }

  return applyDeadlineOffset(
    dueAt,
    definition.warningOffset,
    calendar,
    -1,
  );
}

export function classifyDeadline(
  deadline: DeadlineInstance,
  definition: DeadlineDefinitionConfig,
  calendar: CompiledDeadlineCalendarConfig,
  now = new Date().toISOString(),
): DeadlineUrgency {
  if (deadline.state === "cancelled") {
    return "cancelled";
  }

  if (deadline.state === "completed") {
    return "completed";
  }

  if (deadline.state === "paused") {
    return "paused";
  }

  const nowTime = requireValidDate(
    now,
    "Current time",
  ).valueOf();
  const dueTime = requireValidDate(
    deadline.dueAt,
    "Deadline dueAt",
  ).valueOf();

  if (nowTime > dueTime) {
    return "overdue";
  }

  const warningAt = calculateWarningAt(
    deadline.dueAt,
    definition,
    calendar,
  );

  if (
    warningAt &&
    nowTime >=
      requireValidDate(
        warningAt,
        "Deadline warningAt",
      ).valueOf()
  ) {
    return "due_soon";
  }

  return "open";
}

export function deadlineAppliesToRecord(
  definition: DeadlineDefinitionConfig,
  recordTypeId: string,
): boolean {
  return (
    !definition.recordTypeIds ||
    definition.recordTypeIds.includes(
      recordTypeId,
    )
  );
}

export function presentDeadline(
  deadline: DeadlineInstance,
  definition: DeadlineDefinitionConfig,
  calendar: CompiledDeadlineCalendarConfig,
  now = new Date().toISOString(),
): PresentedDeadline {
  return {
    id: deadline.id,
    deadlineTypeId: deadline.deadlineTypeId,
    label: definition.label,
    description: definition.description,
    anchorAt: deadline.anchorAt,
    dueAt: deadline.dueAt,
    state: deadline.state,
    urgency: classifyDeadline(
      deadline,
      definition,
      calendar,
      now,
    ),
    pausedAt: deadline.pausedAt,
    completedAt: deadline.completedAt,
    cancelledAt: deadline.cancelledAt,
    publiclyVisible:
      definition.publiclyVisible === true,
  };
}
