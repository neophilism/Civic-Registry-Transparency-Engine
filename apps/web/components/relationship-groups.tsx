import type {
  PresentedRelationshipGroup,
} from "@civic-registry/registry";
import Link from "next/link";

export function RelationshipGroups({
  registryId,
  groups,
  limitPerGroup,
}: {
  registryId: string;
  groups: PresentedRelationshipGroup[];
  limitPerGroup?: number;
}) {
  return (
    <div className="relationship-groups">
      {groups.map((group) => {
        const items =
          limitPerGroup === undefined
            ? group.relationships
            : group.relationships.slice(0, limitPerGroup);

        return (
          <section
            className="relationship-group"
            key={group.key}
          >
            <div className="relationship-group__heading">
              <div>
                <span className="relationship-direction">
                  {group.direction}
                </span>
                <h3>{group.label}</h3>
              </div>
              <span className="metric">
                {group.count}{" "}
                {group.count === 1
                  ? "connection"
                  : "connections"}
              </span>
            </div>

            <div className="relationship-list">
              {items.map((item) => (
                <article
                  className="relationship-card"
                  key={item.id}
                >
                  <span>{item.directionLabel}</span>
                  <h3>
                    <Link
                      href={`/registries/${encodeURIComponent(
                        registryId,
                      )}/records/${encodeURIComponent(
                        item.relatedRecord.id,
                      )}`}
                    >
                      {item.relatedRecord.title}
                    </Link>
                  </h3>
                  <p>
                    {item.relatedRecord.recordTypeName}
                  </p>
                </article>
              ))}
            </div>

            {limitPerGroup !== undefined &&
            group.count > items.length ? (
              <p className="relationship-more">
                {group.count - items.length} more connection
                {group.count - items.length === 1 ? "" : "s"} not
                shown in this summary.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
