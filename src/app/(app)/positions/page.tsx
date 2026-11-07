import Link from "next/link";
import { redirect } from "next/navigation";
import { Chess, DEFAULT_POSITION } from "chess.js";
import { apiGet } from "@/lib/web/api";
import { ExplorerBoard } from "@/components/ExplorerBoard";
import { RowLink } from "@/components/RowLink";
import { Card, EvalChip, Empty, PageHead, ResultBar } from "@/components/ui";

export const metadata = { title: "Explorer · Chess State Explorer" };

// Same identity rule as the server: board, side to move, castling, en passant; clocks dropped.
const canonical = (fen: string) => new Chess(fen).fen().split(" ").slice(0, 4).join(" ") + " 0 1";
function play(moves: string) {
  const board = new Chess();
  const sans: string[] = [], fens: string[] = [canonical(board.fen())];
  const tokens = moves.replace(/\{[^}]*\}/g, " ").split(/\s+/).map(t => t.replace(/^\d+\.(\.\.)?/, "")).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  for (const t of tokens) { sans.push(board.move(t).san); fens.push(canonical(board.fen())); } // throws on illegal SAN
  return { fen: board.fen(), sans, fens };
}
const numbered = (sans: string[]) => sans.map((m, i) => `${i % 2 === 0 ? `${i / 2 + 1}.` : ""}${m}`).join(" ");
const find = async (fen: string) => (await apiGet(`/positions?fen=${encodeURIComponent(fen)}`))[0] ?? null;

// Looks a board up by FEN or by moves and opens it. When the database does not have it, this page
// shows where the line left the database, what was played there instead, and live Stockfish.
export default async function LookupPage({ searchParams }: { searchParams: Promise<{ fen?: string; moves?: string }> }) {
  const { fen, moves } = await searchParams;
  let target = DEFAULT_POSITION, line: string[] = [], fens: string[] = [], error: string | null = null;
  try {
    if (moves?.trim()) ({ fen: target, sans: line, fens } = play(moves));
    else if (fen?.trim()) target = fen.trim();
    target = canonical(target);
  } catch { error = moves ? "Those moves are not legal from the starting position." : "That is not a valid FEN."; }
  if (!error) {
    const found = await find(target);
    if (found) redirect(`/positions/${found.position_id}${line.length ? `?line=${encodeURIComponent(line.join(" "))}` : ""}`);
  }

  // Deepest stored board along the moves, and what the games played from there.
  let known: { position_id: number; ply: number } | null = null;
  for (let ply = fens.length - 2; ply >= 0 && !error; ply--) {
    const hit = await find(fens[ply]);
    if (hit) { known = { position_id: hit.position_id, ply }; break; }
  }
  const there = known ? await apiGet(`/analytics/positions/${known.position_id}?limit=6`) : null;
  const playedHere = known && there ? there.next_moves.filter((m: any) => Number(m.games) > 0) : [];
  const leftWith = known ? line[known.ply] : null;
  const toMove = target.split(" ")[1] === "w" ? "White" : "Black";

  return (
    <>
      <PageHead crumbs={[["Explorer", "/positions"]]}
        title={error ? "Position not found" : "New position: no stored game reached it"}
        lead={error ?? <>{toMove} to move{line.length ? <> after <span className="line">{numbered(line)}</span></> : null}. There are no statistics for this position, but Stockfish can still analyse it.</>} />
      <div className="explorer">
        {!error ? <ExplorerBoard fen={target} line={line} next={[]} autoEngine /> : <div />}
        <div className="stack">
          {known && there && (
            <Card title={<>Left the database with <span className="san">{known.ply % 2 === 0 ? `${known.ply / 2 + 1}.` : `${Math.ceil(known.ply / 2)}…`}{leftWith}</span></>}
              sub={<>The last stored position is after <span className="line">{numbered(line.slice(0, known.ply)) || "the start"}</span>{there.opening ? ` (${there.opening.name})` : ""}. Games played instead:</>}
              foot={<Link href={`/positions/${known.position_id}?line=${encodeURIComponent(line.slice(0, known.ply).join(" "))}`}>Open the last stored position →</Link>}>
              {playedHere.length ? (
                <table className="t"><thead><tr><th>Move</th><th className="num">Games</th><th className="center">White / draw / Black</th><th className="num">Eval</th></tr></thead>
                  <tbody>{playedHere.map((m: any) => (
                    <RowLink key={m.move_san} href={`/positions/${m.to_position_id}?line=${encodeURIComponent([...line.slice(0, known!.ply), m.move_san].join(" "))}`}>
                      <td className="san">{m.move_san}</td><td className="num">{m.games}</td>
                      <td style={{ width: 170 }}><ResultBar w={m.white_wins} d={m.draws} b={m.black_wins} /></td>
                      <td className="num"><EvalChip cp={m.cp} mate={m.mate} /></td>
                    </RowLink>
                  ))}</tbody></table>
              ) : <Empty>No game continued from there either.</Empty>}
            </Card>
          )}
          <Card title="Go to another position" pad>
            <div className="stack-sm">
              <form className="lookup" action="/positions"><input name="moves" placeholder="Moves, e.g. 1. d4 Nf6 2. c4 e6 3. Nf3" defaultValue={moves ?? ""} /><button className="btn btn-primary">Go</button></form>
              <form className="lookup" action="/positions"><input name="fen" className="mono" placeholder="…or paste a FEN" defaultValue={fen ?? ""} /><button className="btn btn-ghost">Go</button></form>
              <Link href="/positions" className="small">← Starting position</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
