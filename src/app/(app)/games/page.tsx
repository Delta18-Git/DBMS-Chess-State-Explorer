import Link from "next/link";
import { apiAll, apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { AutoForm } from "@/components/AutoForm";
import { Modal } from "@/components/Modal";
import { RowLink } from "@/components/RowLink";
import { importLichess, importPgn } from "@/app/actions";
import { AdminBar, Eco, Empty, PageHead, Pagination, Result, SortTh, TitleChip, fmtDate, pageOf, roundLabel, totalOf, EcoName } from "@/components/ui";

export const metadata = { title: "Games · Chess State Explorer" };
const PER_PAGE = 25;
const FAMILIES: [string, string][] = [["A", "A · Flank openings"], ["B", "B · Semi-open (1.e4, not 1…e5)"], ["C", "C · Open games (1.e4 e5) & French"], ["D", "D · Closed (1.d4 d5)"], ["E", "E · Indian defences"]];

export default async function GamesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageOf(sp);
  const filters = { player_id: sp.player_id, tournament_id: sp.tournament_id, opening_id: sp.opening_id, eco: sp.eco, result: sp.result, sort: sp.sort, dir: sp.dir };
  const plain = { player_id: sp.player_id, tournament_id: sp.tournament_id, opening_id: sp.opening_id, eco: sp.eco, result: sp.result };
  const sortBy = sp.sort ?? "date";
  const th = (label: string, col: string, defaultDir: "asc" | "desc", className = "") =>
    <SortTh label={label} col={col} base="/games" params={plain} sort={sortBy} dir={sp.dir} defaultDir={defaultDir} className={className} />;
  const [user, games, players, tournaments, openings] = await Promise.all([
    currentUser(),
    apiGet(`/games${qs({ ...filters, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`),
    apiAll("/players?sort=name"),
    apiAll("/tournaments"),
    apiAll("/analytics/openings?sort=eco"),
  ]);
  const total = totalOf(games);
  const admin = user.role === "admin";
  const resultHref = (r?: string) => `/games${qs({ ...filters, result: r })}`;

  return (
    <>
      <PageHead title="Games" lead="Every classical game in the database. Open one to replay it with Stockfish's evaluation of each move." />
      {admin && (
        <AdminBar hint="New games are checked move by move and stored in one transaction">
          <Modal label="Import from Lichess" icon="upload" title="Import a Lichess broadcast" className="btn btn-solid">
            <p className="small ink-2" style={{ marginBottom: 12 }}>Paste a tournament or round link from <code>lichess.org/broadcast</code>. The tournament, its players (with FIDE data) and every finished classical game are imported. Running it again only adds new games.</p>
            <ActionForm action={importLichess.bind(null, true)} submit="Import tournament" icon="upload">
              <Field label="Broadcast link"><input name="source" required placeholder="https://lichess.org/broadcast/…" /></Field>
            </ActionForm>
          </Modal>
          <Modal label="Paste PGN" icon="plus" title="Import games from PGN">
            <p className="small ink-2" style={{ marginBottom: 12 }}>Players, event and opening are read from the PGN headers and matched to stored ones (or created).</p>
            <ActionForm action={importPgn} submit="Import games" resetOnSuccess>
              <Field label="PGN (one or more games)"><textarea name="pgn" rows={10} required maxLength={120000} placeholder={'[Event "Club championship"]\n[White "Player, A"]\n[Black "Player, B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 …'} /></Field>
              <Field label="Tournament" hint="Optional: otherwise the [Event] header decides">
                <select name="tournament_id" defaultValue=""><option value="">From the PGN header</option>{tournaments.map((t: any) => <option key={t.tournament_id} value={t.tournament_id}>{t.name}</option>)}</select>
              </Field>
            </ActionForm>
          </Modal>
        </AdminBar>
      )}
      {sp.deleted && <p className="note note-ok" style={{ marginBottom: 16 }}>Game deleted. Its moves were removed in the same transaction, and the graph was updated.</p>}

      <section className="card">
        <AutoForm>
          <label className="field grow"><span className="field-label">Player</span>
            <select name="player_id" defaultValue={sp.player_id ?? ""}><option value="">Any player</option>{players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}</select>
          </label>
          <label className="field grow"><span className="field-label">Tournament</span>
            <select name="tournament_id" defaultValue={sp.tournament_id ?? ""}><option value="">Any tournament</option>{tournaments.map((t: any) => <option key={t.tournament_id} value={t.tournament_id}>{t.name}</option>)}</select>
          </label>
          <label className="field"><span className="field-label">Opening family</span>
            <select name="eco" defaultValue={sp.eco ?? ""}><option value="">Any</option>{FAMILIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field grow"><span className="field-label">Opening</span>
            <select name="opening_id" defaultValue={sp.opening_id ?? ""}><option value="">Any opening</option>{openings.map((o: any) => <option key={o.opening_id} value={o.opening_id}>{o.eco} {o.name} ({o.games})</option>)}</select>
          </label>
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
          {sp.result && <input type="hidden" name="result" value={sp.result} />}
          <div className="field"><span className="field-label">Result</span>
            <div className="seg">
              {[[undefined, "All"], ["1-0", "1–0"], ["1/2-1/2", "½–½"], ["0-1", "0–1"]].map(([v, l]) => (
                <Link key={l} href={resultHref(v)} aria-current={sp.result === v ? "true" : undefined}>{l}</Link>
              ))}
            </div>
          </div>
          {Object.values(plain).some(Boolean) && <Link href="/games" className="btn btn-ghost">Clear</Link>}
        </AutoForm>
        {games.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr>{th("Date", "date", "desc", "hide-sm")}{th("White", "white", "asc")}{th("Result", "result", "asc", "center")}{th("Black", "black", "asc")}{th("Opening", "opening", "asc", "hide-sm")}{th("Event", "event", "asc", "hide-sm")}{th("Moves", "moves", "desc", "num hide-sm")}</tr></thead>
            <tbody>{games.map((g: any) => (
              <RowLink key={g.game_id} href={`/games/${g.game_id}`}>
                <td className="nowrap small muted hide-sm">{fmtDate(g.date)}</td>
                <td><Link href={`/players/${g.white_player_id}`} className="person"><span className="truncate"><TitleChip title={g.white_title} /> <span className="name">{g.white_name}</span> <span className="meta">{g.white_elo ?? ""}</span></span></Link></td>
                <td className="center"><Result result={g.result} /></td>
                <td><Link href={`/players/${g.black_player_id}`} className="person"><span className="truncate"><TitleChip title={g.black_title} /> <span className="name">{g.black_name}</span> <span className="meta">{g.black_elo ?? ""}</span></span></Link></td>
                <td className="small hide-sm"><EcoName eco={g.eco} name={g.opening_name} /></td>
                <td className="small hide-sm"><div className="truncate" style={{ maxWidth: 170 }}>{g.tournament_name ?? "—"}</div><div className="tiny muted">{roundLabel(g.round)}</div></td>
                <td className="num small hide-sm">{g.plies ? Math.ceil(g.plies / 2) : "—"}</td>
              </RowLink>
            ))}</tbody>
          </table></div>
        ) : <Empty>No games match these filters.</Empty>}
        <Pagination base="/games" params={filters} page={page} perPage={PER_PAGE} total={total} />
      </section>
    </>
  );
}
