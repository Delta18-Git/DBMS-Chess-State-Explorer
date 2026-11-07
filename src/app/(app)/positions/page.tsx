import Link from "next/link";
import { redirect } from "next/navigation";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { apiGet } from "@/lib/web/api";
import { Board } from "@/components/Board";
import { Db, Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Position explorer · Chess State Explorer" };

// Same identity rule as the server: board, side to move, castling, en passant; clocks dropped.
function canonical(fen: string) {
  return new Chess(fen).fen().split(" ").slice(0, 4).join(" ") + " 0 1";
}
function fromMoves(moves: string) {
  const board = new Chess();
  const tokens = moves.replace(/\{[^}]*\}/g, " ").split(/\s+/).map(t => t.replace(/^\d+\.(\.\.)?/, "")).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  for (const t of tokens) board.move(t); // throws on illegal SAN
  return board.fen();
}

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ fen?: string; moves?: string }> }) {
  const { fen, moves } = await searchParams;
  let error: string | null = null;
  let lookedUp: string | null = null;
  if (fen || moves) {
    try { lookedUp = canonical(moves ? fromMoves(moves) : fen!.trim()); }
    catch { error = moves ? "Those moves are not legal from the starting position." : "That is not a valid FEN."; }
    if (lookedUp) {
      const found = await apiGet(`/positions?fen=${encodeURIComponent(lookedUp)}`);
      if (found.length) redirect(`/positions/${found[0].position_id}`);
    }
  }
  const [overview, start] = await Promise.all([
    apiGet("/analytics/overview"),
    apiGet(`/positions?fen=${encodeURIComponent(DEFAULT_POSITION)}`),
  ]);

  return (
    <>
      <PageHead title="Position explorer" sub="Every distinct board is stored once (UNIQUE canonical FEN), however many games or move orders reach it." />
      <div className="grid grid-2">
        <section className="card stack">
          <form method="get" className="form">
            <label className="field"><span className="field-label">Find by moves</span>
              <input name="moves" placeholder="1. d4 Nf6 2. c4 e6 3. Nf3 d5" defaultValue={moves ?? ""} />
              <span className="field-hint">Try two different move orders of the same opening: both land on the same position row.</span>
            </label>
            <div><button className="btn btn-primary">Look up</button></div>
          </form>
          <form method="get" className="form">
            <label className="field"><span className="field-label">…or by FEN</span>
              <input name="fen" className="mono" placeholder={DEFAULT_POSITION} defaultValue={fen ?? ""} />
            </label>
            <div><button className="btn btn-ghost">Look up FEN</button></div>
          </form>
          {error && <p className="msg msg-error">{error}</p>}
          {lookedUp && !error && (
            <div className="callout callout-warn">
              No stored game reaches this board yet.
              <div style={{ maxWidth: 220, marginTop: 8 }}><Board fen={lookedUp} id="lookup" /></div>
            </div>
          )}
          {start[0] && <p className="small"><Link href={`/positions/${start[0].position_id}`}>Start from the initial position →</Link> (full opening tree)</p>}
        </section>
        <section className="card">
          <h2>Most-visited boards after move 3 <Db kind="MySQL" /></h2>
          <p className="muted small" style={{ marginTop: -6 }}><code>RANK() OVER (ORDER BY COUNT(DISTINCT game_id) DESC)</code> over a grouped derived table.</p>
          {overview.popular_positions.length ? (
            <table className="data">
              <thead><tr><th>Position</th><th className="num">Games</th></tr></thead>
              <tbody>{overview.popular_positions.map((p: any) => (
                <tr key={p.position_id}>
                  <td><Link href={`/positions/${p.position_id}`}>#{p.position_id}</Link> <code className="small muted">{p.fen.split(" ")[0]}</code></td>
                  <td className="num">{p.games}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>Import a few games to see shared positions.</Empty>}
          <p className="small"><Link href="/transpositions">See transpositions in the graph →</Link></p>
        </section>
      </div>
    </>
  );
}
