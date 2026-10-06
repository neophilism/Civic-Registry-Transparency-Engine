import type {
  PresentedRelationshipGraph,
} from "@civic-registry/registry";
import Link from "next/link";

export function RelationshipMap({
  registryId,
  graph,
}: {
  registryId: string;
  graph: PresentedRelationshipGraph;
}) {
  const nodeById = new Map(
    graph.nodes.map((node) => [node.id, node]),
  );
  const distances = [
    ...new Set(graph.nodes.map((node) => node.distance)),
  ].sort((left, right) => left - right);

  return (
    <div className="relationship-map">
      <section
        className="relationship-map__nodes"
        aria-labelledby="map-nodes-heading"
      >
        <div className="section-heading section-heading--tight">
          <div>
            <p className="eyebrow">Nodes</p>
            <h2 id="map-nodes-heading">Connected records</h2>
          </div>
          <span className="metric">
            {graph.nodes.length} nodes
          </span>
        </div>

        {distances.map((distance) => {
          const nodes = graph.nodes.filter(
            (node) => node.distance === distance,
          );

          return (
            <div
              className="relationship-distance"
              key={distance}
            >
              <h3>
                {distance === 0
                  ? "Root record"
                  : distance === 1
                    ? "1 hop away"
                    : `${distance} hops away`}
              </h3>
              <div className="relationship-node-grid">
                {nodes.map((node) => (
                  <article
                    className={
                      node.root
                        ? "relationship-node relationship-node--root"
                        : "relationship-node"
                    }
                    key={node.id}
                  >
                    <span>
                      {node.record.recordTypeName}
                    </span>
                    <h4>
                      <Link
                        href={`/registries/${encodeURIComponent(
                          registryId,
                        )}/records/${encodeURIComponent(
                          node.id,
                        )}`}
                      >
                        {node.record.title}
                      </Link>
                    </h4>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section
        className="relationship-map__edges"
        aria-labelledby="map-edges-heading"
      >
        <div className="section-heading section-heading--tight">
          <div>
            <p className="eyebrow">Edges</p>
            <h2 id="map-edges-heading">Connections</h2>
          </div>
          <span className="metric">
            {graph.edges.length} edges
          </span>
        </div>

        <div className="relationship-edge-list">
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.fromRecordId);
            const to = nodeById.get(edge.toRecordId);

            if (!from || !to) return null;

            return (
              <article
                className="relationship-edge"
                key={edge.id}
              >
                <Link
                  href={`/registries/${encodeURIComponent(
                    registryId,
                  )}/records/${encodeURIComponent(from.id)}`}
                >
                  {from.record.title}
                </Link>
                <span className="relationship-edge__label">
                  {edge.directed ? "→" : "—"} {edge.label}{" "}
                  {edge.directed ? "→" : "—"}
                </span>
                <Link
                  href={`/registries/${encodeURIComponent(
                    registryId,
                  )}/records/${encodeURIComponent(to.id)}`}
                >
                  {to.record.title}
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
