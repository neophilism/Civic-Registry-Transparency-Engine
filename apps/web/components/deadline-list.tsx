import type {
  PresentedDeadline,
} from "@civic-registry/deadlines";

import { formatDateTime } from "../lib/format";

function urgencyLabel(
  urgency: PresentedDeadline["urgency"],
): string {
  switch (urgency) {
    case "due_soon":
      return "Due soon";
    case "overdue":
      return "Overdue";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "paused":
      return "Paused";
    case "open":
      return "Open";
  }
}

export function DeadlineList({
  deadlines,
}: {
  deadlines: PresentedDeadline[];
}) {
  return (
    <div className="deadline-list">
      {deadlines.map((deadline) => (
        <article
          className="deadline-card"
          key={deadline.id}
        >
          <div className="deadline-card__heading">
            <div>
              <h3>{deadline.label}</h3>
              {deadline.description ? (
                <p>{deadline.description}</p>
              ) : null}
            </div>
            <span
              className={
                "deadline-pill deadline-pill--" +
                deadline.urgency
              }
            >
              {urgencyLabel(deadline.urgency)}
            </span>
          </div>

          <dl className="deadline-metadata">
            <div>
              <dt>Due</dt>
              <dd>{formatDateTime(deadline.dueAt)}</dd>
            </div>
            <div>
              <dt>Started from</dt>
              <dd>{formatDateTime(deadline.anchorAt)}</dd>
            </div>
            {deadline.pausedAt ? (
              <div>
                <dt>Paused</dt>
                <dd>
                  {formatDateTime(deadline.pausedAt)}
                </dd>
              </div>
            ) : null}
            {deadline.completedAt ? (
              <div>
                <dt>Completed</dt>
                <dd>
                  {formatDateTime(deadline.completedAt)}
                </dd>
              </div>
            ) : null}
            {deadline.cancelledAt ? (
              <div>
                <dt>Cancelled</dt>
                <dd>
                  {formatDateTime(deadline.cancelledAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>
      ))}
    </div>
  );
}
