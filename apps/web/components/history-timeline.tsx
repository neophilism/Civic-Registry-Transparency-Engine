import type {
  PresentedHistoryEvent,
} from "@civic-registry/registry";

import { formatDateTime } from "../lib/format";

export function HistoryTimeline({
  events,
  limit,
}: {
  events: PresentedHistoryEvent[];
  limit?: number;
}) {
  const visible =
    limit === undefined
      ? events
      : events.slice(0, limit);

  return (
    <ol className="history-timeline">
      {visible.map((event) => (
        <li className="history-event" key={event.id}>
          <div className="history-event__marker" aria-hidden="true" />
          <article>
            <div className="history-event__heading">
              <div>
                <h3>{event.label}</h3>
                <time dateTime={event.occurredAt}>
                  {formatDateTime(event.occurredAt)}
                </time>
              </div>
              {event.version !== undefined ? (
                <span className="metric">
                  Version {event.version}
                </span>
              ) : null}
            </div>

            {event.detail ? (
              <p>{event.detail}</p>
            ) : null}

            {event.reason ? (
              <p className="history-reason">
                Reason: {event.reason}
              </p>
            ) : null}
          </article>
        </li>
      ))}

      {limit !== undefined && events.length > visible.length ? (
        <li className="history-more">
          {events.length - visible.length} more public event
          {events.length - visible.length === 1 ? "" : "s"}.
        </li>
      ) : null}
    </ol>
  );
}
