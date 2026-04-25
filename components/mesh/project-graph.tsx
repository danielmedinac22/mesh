import { MESH } from "./tokens";

export type RepoRelationship = {
  from: string;
  to: string;
  kind: string;
  note?: string;
};

export function ProjectGraph({
  repos,
  relationships,
  height = 300,
}: {
  repos: string[];
  relationships: RepoRelationship[];
  height?: number;
}) {
  const width = 440;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 40;
  const n = Math.max(repos.length, 1);
  const coords = new Map<string, { x: number; y: number }>();
  repos.forEach((name, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    coords.set(name, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{ display: "block" }}
      aria-label="project relationship graph"
    >
      <defs>
        <marker
          id="pg-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={MESH.fgMute} />
        </marker>
      </defs>
      {relationships.map((r, i) => {
        const a = coords.get(r.from);
        const b = coords.get(r.to);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={MESH.borderHi}
            strokeWidth={1}
            strokeDasharray="3,4"
            markerEnd="url(#pg-arrow)"
          />
        );
      })}
      {repos.map((name) => {
        const c = coords.get(name);
        if (!c) return null;
        return (
          <g key={name}>
            <circle
              cx={c.x}
              cy={c.y}
              r={13}
              fill={MESH.bgElev2}
              stroke={MESH.amber}
              strokeWidth={1}
            />
            <circle cx={c.x} cy={c.y} r={3} fill={MESH.fgDim} />
            <text
              x={c.x}
              y={c.y + 28}
              textAnchor="middle"
              style={{
                fontFamily: "var(--font-mono, ui-monospace)",
                fontSize: 10,
                fill: MESH.fgDim,
              }}
            >
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
