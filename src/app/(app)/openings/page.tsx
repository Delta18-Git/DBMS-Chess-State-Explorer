import Link from "next/link";
import { apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { AutoForm } from "@/components/AutoForm";
import { Modal } from "@/components/Modal";
import { RowLink } from "@/components/RowLink";
import { createOpening } from "@/app/actions";
import { AdminBar, Eco, Empty, PageHead, Pagination, ResultBar, ResultLegend, SortTh, fmtDate, pageOf, pct, totalOf, EcoName } from "@/components/ui";

export const metadata = { title: "Openings · Chess State Explorer" };
const PER_PAGE = 30;
const FAMILIES: [string, string][] = [["A", "A · Flank"], ["B", "B · Semi-open"], ["C", "C · Open & French"], ["D", "D · Closed"], ["E", "E · Indian"]];

export default async function OpeningsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageOf(sp);
  const filters = { eco: sp.eco, q: sp.q?.trim() || undefined, sort: sp.sort, dir: sp.dir, min_games: sp.min_games };
  const plain = { eco: sp.eco, q: filters.q, min_games: sp.min_games };
  const th = (label: string, col: string, defaultDir: "asc" | "desc", className = "", title?: string) =>
    <SortTh label={label} col={col} base="/openings" params={plain} sort={sp.sort ?? "games"} dir={sp.dir} defaultDir={defaultDir} className={className} title={title} />;
  const [user, rows] = await Promise.all([
    currentUser(),
    apiGet(`/analytics/openings${qs({ ...filters, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`),
  ]);
  return (
    <>
      <PageHead title="Openings" lead="How each opening scores in these games. Names and ECO codes follow the Lichess opening catalogue." />
      {user.role === "admin" && (
        <AdminBar hint="Games are classified from their PGN headers on import">
          <Modal label="Add opening" icon="plus" title="Add an opening" className="btn btn-solid">
            <ActionForm action={createOpening} submit="Create opening" resetOnSuccess>
              <div className="form-row">
                <Field label="ECO" hint="A00–E99"><input name="eco" required pattern="[A-Ea-e][0-9]{2}" maxLength={3} /></Field>
                <Field label="Name"><input name="name" required maxLength={150} /></Field>
              </div>
            </ActionForm>
          </Modal>
        </AdminBar>
      )}
      <section className="card">
        <AutoForm>
          <div className="field"><span className="field-label">Family</span>
            <div className="seg">
              <Link href={`/openings${qs({ ...filters, eco: undefined })}`} aria-current={!sp.eco ? "true" : undefined}>All</Link>
              {FAMILIES.map(([v, l]) => <Link key={v} href={`/openings${qs({ ...filters, eco: v })}`} aria-current={sp.eco === v ? "true" : undefined} title={l}>{v}</Link>)}
            </div>
          </div>
          {sp.eco && <input type="hidden" name="eco" value={sp.eco} />}
          <label className="field grow"><span className="field-label">Name contains</span><input name="q" type="search" defaultValue={filters.q ?? ""} placeholder="e.g. Sicilian, Catalan, Berlin" /></label>
          <label className="field"><span className="field-label">Min. games</span>
            <select name="min_games" defaultValue={sp.min_games ?? ""}><option value="">1+</option><option value="2">2+</option><option value="3">3+</option><option value="5">5+</option></select>
          </label>
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        </AutoForm>
        {rows.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr>{th("Opening", "eco", "asc")}{th("Games", "games", "desc", "num")}<th className="center">Results</th>{th("White score", "white", "desc", "num", "White's score: win = 1, draw = ½")}{th("Avg length", "moves", "desc", "num hide-sm")}{th("Last played", "last", "desc", "num hide-sm")}</tr></thead>
            <tbody>{rows.map((o: any) => (
              <RowLink key={o.opening_id} href={`/openings/${o.opening_id}`}>
                <td><EcoName eco={o.eco} name={o.name} href={`/openings/${o.opening_id}`} /></td>
                <td className="num">{o.games}</td>
                <td style={{ width: 200 }}><ResultBar w={o.white_wins} d={o.draws} b={o.black_wins} /></td>
                <td className="num">{pct(o.white_score_pct)}</td>
                <td className="num small hide-sm">{o.avg_moves ? `${o.avg_moves} moves` : "—"}</td>
                <td className="num small muted hide-sm">{fmtDate(o.last_played)}</td>
              </RowLink>
            ))}</tbody>
          </table></div>
        ) : <Empty>No opening matches.</Empty>}
        <div className="card-foot"><ResultLegend /></div>
        <Pagination base="/openings" params={filters} page={page} perPage={PER_PAGE} total={totalOf(rows)} />
      </section>
    </>
  );
}
