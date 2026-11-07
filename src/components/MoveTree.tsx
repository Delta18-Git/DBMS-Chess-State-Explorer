import Link from "next/link";
import { ResultBar } from "./ui";

interface Edge { from_position_id: number; to_position_id: number; san: string; games: number; white_wins: number; black_wins: number; draws: number }

/** Renders Neo4j tree edges (a DAG) as nested lists from the root, bounded by the query depth. */
export function MoveTree({ rootId, edges, depth }: { rootId: number; edges: Edge[]; depth: number }) {
  const children = new Map<number, Edge[]>();
  for (const e of edges) {
    const list = children.get(e.from_position_id) ?? [];
    list.push(e);
    children.set(e.from_position_id, list);
  }
  for (const list of children.values()) list.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
  const max = Math.max(1, ...edges.map(e => e.games));

  const render = (id: number, level: number, seen: Set<number>): React.ReactNode => {
    const kids = children.get(id);
    if (!kids || level >= depth) return null;
    return (
      <ul>
        {kids.map(e => (
          <li key={`${e.from_position_id}-${e.san}`}>
            <span className="tree-node">
              <Link href={`/positions/${e.to_position_id}`} className="san">{e.san}</Link>
              <span className="meter" style={{ width: 80 }} title={`${e.games} game(s)`}><i style={{ width: `${(100 * e.games) / max}%` }} /></span>
              <span className="small num" style={{ minWidth: 24 }}>{e.games}</span>
              <span style={{ width: 90 }}><ResultBar w={e.white_wins} d={e.draws} b={e.black_wins} /></span>
            </span>
            {!seen.has(e.to_position_id) && render(e.to_position_id, level + 1, new Set([...seen, e.to_position_id]))}
          </li>
        ))}
      </ul>
    );
  };
  return <div className="tree">{render(rootId, 0, new Set([rootId]))}</div>;
}
