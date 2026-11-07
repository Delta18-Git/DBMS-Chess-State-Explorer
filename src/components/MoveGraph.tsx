"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "./Board";
import { Icon } from "./Icon";

export interface GNode { position_id: number; fen: string; side: "w" | "b"; ply: number | null; name: string | null; line: string | null; opening: string | null; indegree: number; is_start?: boolean }
export interface GEdge { from_position_id: number; to_position_id: number; san: string; games: number; white_wins?: number; draws?: number; black_wins?: number; wins?: number; losses?: number }

const COL = 128, ROW = 40;
type Pt = { x: number; y: number };
type View = { k: number; x: number; y: number };

/**
 * Interactive drawing of a piece of the Neo4j move graph. Columns are plies (distance from the
 * left-most board), discs are boards coloured by side to move, edges are moves (width = games).
 * A blue ring marks a board that two or more drawn move orders reach: a transposition.
 * Drag the background to pan, scroll to zoom, drag a disc to move it, click a disc to open it.
 */
export function MoveGraph({ nodes, edges, rootId, targetId, maxNodes = 400, height = 480 }: {
  nodes: GNode[]; edges: GEdge[]; rootId?: number; targetId?: number; maxNodes?: number; height?: number;
}) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [moved, setMoved] = useState<Map<number, Pt>>(new Map());
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ mode: "pan" | "node"; id?: number; sx: number; sy: number; start: View | Pt; dist: number } | null>(null);

  const layout = useMemo(() => {
    const byId = new Map(nodes.map(n => [Number(n.position_id), n]));
    const out = new Map<number, GEdge[]>(), inn = new Map<number, GEdge[]>();
    const es = edges.filter(e => byId.has(Number(e.from_position_id)) && byId.has(Number(e.to_position_id)));
    for (const e of es) {
      (out.get(e.from_position_id) ?? out.set(e.from_position_id, []).get(e.from_position_id)!).push(e);
      (inn.get(e.to_position_id) ?? inn.set(e.to_position_id, []).get(e.to_position_id)!).push(e);
    }
    // Columns by BFS from the roots (the given root, or boards with no drawn incoming move);
    // the most-played moves are visited first so a node cap keeps the popular part of the graph.
    const roots = rootId !== undefined && byId.has(rootId) ? [rootId] : [...byId.keys()].filter(id => !inn.has(id));
    const level = new Map<number, number>();
    const queue = [...roots];
    roots.forEach(r => level.set(r, 0));
    while (queue.length && level.size < maxNodes) {
      const id = queue.shift()!;
      for (const e of [...(out.get(id) ?? [])].sort((a, b) => b.games - a.games)) {
        if (!level.has(e.to_position_id) && level.size < maxNodes) { level.set(e.to_position_id, level.get(id)! + 1); queue.push(e.to_position_id); }
      }
    }
    const columns: number[][] = [];
    for (const [id, l] of level) (columns[l] ??= []).push(id);
    // Each column is ordered by the weighted average height of its parents (fewer crossings), then packed.
    const y = new Map<number, number>();
    columns.forEach((col, l) => {
      if (l === 0) { col.forEach((id, i) => y.set(id, i * ROW)); return; }
      const want = (id: number) => {
        const ps = (inn.get(id) ?? []).filter(e => y.has(e.from_position_id) && (level.get(e.from_position_id) ?? 99) < l);
        const total = ps.reduce((s, e) => s + e.games, 0) || 1;
        return ps.length ? ps.reduce((s, e) => s + y.get(e.from_position_id)! * e.games, 0) / total : 0;
      };
      const items = col.map(id => ({ id, want: want(id) })).sort((a, b) => a.want - b.want);
      let prev = -Infinity;
      const placed = items.map(it => (prev = Math.max(it.want, prev + ROW)));
      const shift = (items.reduce((s, it) => s + it.want, 0) - placed.reduce((s, v) => s + v, 0)) / items.length;
      items.forEach((it, i) => y.set(it.id, placed[i] + shift));
    });
    const pos = new Map<number, Pt>();
    for (const [id, l] of level) pos.set(id, { x: l * COL, y: y.get(id)! });
    const weight = (id: number) => Math.max((inn.get(id) ?? []).reduce((s, e) => s + e.games, 0), (out.get(id) ?? []).reduce((s, e) => s + e.games, 0));
    const maxW = Math.max(1, ...[...level.keys()].map(weight));
    const maxE = Math.max(1, ...es.map(e => e.games));
    return { byId, es: es.filter(e => pos.has(e.from_position_id) && pos.has(e.to_position_id)), pos, weight, maxW, maxE, inn, truncated: level.size < byId.size };
  }, [nodes, edges, rootId, maxNodes]);

  const at = useCallback((id: number) => moved.get(id) ?? layout.pos.get(id)!, [moved, layout]);

  /** Scale and centre so the whole graph fits the box. */
  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el || !layout.pos.size) return;
    const pts = [...layout.pos.keys()].map(at);
    const minX = Math.min(...pts.map(p => p.x)) - 40, maxX = Math.max(...pts.map(p => p.x)) + 60;
    const minY = Math.min(...pts.map(p => p.y)) - 30, maxY = Math.max(...pts.map(p => p.y)) + 30;
    const k = Math.max(0.03, Math.min(1.4, el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)));
    setView({ k, x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, [layout, at]);
  useEffect(() => { setMoved(new Map()); }, [layout]);
  useEffect(() => { fit(); /* refit only when the data changes */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  // Graphs inside hidden tabs have no size yet: fit the first time they get one.
  const fitted = useRef(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && !fitted.current) { fitted.current = true; fit(); }
      if (el.clientWidth === 0) fitted.current = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = wrap.current!;
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    setView(v => {
      const k = Math.max(0.03, Math.min(3, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const down = (e: React.PointerEvent, id?: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = id === undefined
      ? { mode: "pan", sx: e.clientX, sy: e.clientY, start: view, dist: 0 }
      : { mode: "node", id, sx: e.clientX, sy: e.clientY, start: at(id), dist: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    d.dist = Math.max(d.dist, Math.hypot(dx, dy));
    if (d.mode === "pan") { const s = d.start as View; setView({ k: s.k, x: s.x + dx, y: s.y + dy }); }
    else { const s = d.start as Pt; setMoved(m => new Map(m).set(d.id!, { x: s.x + dx / view.k, y: s.y + dy / view.k })); }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "node" && d.dist < 4) router.push(`/positions/${d.id}`);
  };

  const r = (id: number) => 6 + 7 * Math.sqrt(layout.weight(id) / layout.maxW);
  const merges = (id: number) => (layout.inn.get(id) ?? []).filter(e => layout.pos.has(e.from_position_id)).length >= 2;
  const h = hover !== null ? layout.byId.get(hover) : null;
  const hp = hover !== null ? at(hover) : null;
  const hot = (e: GEdge) => hover !== null && (e.from_position_id === hover || e.to_position_id === hover);
  const labels = view.k >= 0.55;

  return (
    <div>
      <div className="graph-wrap" ref={wrap} style={{ height }} onPointerDown={e => down(e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="graph-tools" onPointerDown={e => e.stopPropagation()}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out">−</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMoved(new Map()); setTimeout(fit, 0); }}>Fit</button>
        </div>
        <svg width="100%" height="100%" role="img" aria-label="Move graph">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.es.map(e => {
              const a = at(e.from_position_id), b = at(e.to_position_id);
              const x1 = a.x + r(e.from_position_id), x2 = b.x - r(e.to_position_id) - 2, mx = (x1 + x2) / 2;
              return (
                <g key={`${e.from_position_id}-${e.to_position_id}-${e.san}`}>
                  <path d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`} className={`graph-edge ${hot(e) ? "hot" : ""}`} strokeWidth={1.2 + 5 * (e.games / layout.maxE)}>
                    <title>{`${e.san}: ${e.games} game(s)`}</title>
                  </path>
                  {labels && <text x={x2 - 6} y={b.y - 6} textAnchor="end" className="graph-edge-label">{e.san}</text>}
                </g>
              );
            })}
            {[...layout.pos.keys()].map(id => {
              const node = layout.byId.get(id)!;
              const p = at(id), rr = r(id);
              return (
                <g key={id} className={`graph-node ${node.side} ${id === rootId || id === targetId ? "root" : ""}`} transform={`translate(${p.x},${p.y})`}
                  onPointerDown={e => down(e, id)} onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)}
                  tabIndex={0} role="link" aria-label={node.line || node.name || `Position ${id}`}
                  onKeyDown={e => { if (e.key === "Enter") router.push(`/positions/${id}`); }}>
                  {merges(id) && <circle r={rr + 4} className="ring" />}
                  <circle r={rr} className="disc" />
                </g>
              );
            })}
          </g>
        </svg>
        {h && hp && !drag.current && (
          <div className="graph-tip" style={{ left: Math.min(hp.x * view.k + view.x + 18, (wrap.current?.clientWidth ?? 400) - 206), top: Math.max(4, Math.min(hp.y * view.k + view.y - 60, height - 250)) }}>
            <Board fen={h.fen} id={`tip${h.position_id}`} notation={false} />
            <div className="tiny"><b>{h.is_start ? "Starting position" : h.line}</b></div>
            {h.opening && <div className="tiny muted">{h.opening}</div>}
            <div className="tiny muted">{h.side === "w" ? "White" : "Black"} to move · {layout.weight(h.position_id)} game(s){h.indegree >= 2 ? ` · reached from ${h.indegree} boards` : ""}</div>
          </div>
        )}
      </div>
      <div className="graph-legend">
        <span><i className="lg-node" /> White to move</span>
        <span><i className="lg-node b" /> Black to move</span>
        <span><i className="lg-node t" /> Transposition (move orders meet)</span>
        <span><i className="lg-edge" /> Move · thicker = more games</span>
        <span className="muted"><Icon name="explore" /> Drag to pan · scroll to zoom · drag a disc to move it · click to open</span>
        {layout.truncated && <span className="muted">Showing the {layout.pos.size} most-played boards of {layout.byId.size}</span>}
      </div>
    </div>
  );
}
