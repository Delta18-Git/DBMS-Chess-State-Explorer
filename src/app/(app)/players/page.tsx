import Link from "next/link";
import { apiGet, currentUser, qs } from "@/lib/web/api";
import { ActionForm } from "@/components/ActionForm";
import { AutoForm } from "@/components/AutoForm";
import { Modal } from "@/components/Modal";
import { PlayerFields } from "@/components/PlayerFields";
import { RowLink } from "@/components/RowLink";
import { Icon } from "@/components/Icon";
import { createPlayer } from "@/app/actions";
import { AdminBar, Avatar, Empty, Flag, PageHead, Pagination, SortTh, TitleChip, federationName, pageOf, pct, totalOf } from "@/components/ui";

export const metadata = { title: "Players · Chess State Explorer" };
const PER_PAGE = 25;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = pageOf(sp);
  const filters = { q: sp.q?.trim() || undefined, title: sp.title, federation: sp.federation, sort: sp.sort, dir: sp.dir };
  const plain = { q: filters.q, title: sp.title, federation: sp.federation };
  const th = (label: string, col: string, defaultDir: "asc" | "desc", className = "") =>
    <SortTh label={label} col={col} base="/players" params={plain} sort={sp.sort ?? "rating"} dir={sp.dir} defaultDir={defaultDir} className={className} />;
  const [user, players, facets] = await Promise.all([
    currentUser(),
    apiGet(`/players${qs({ ...filters, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })}`).catch(() => []),
    apiGet("/players/facets"),
  ]);
  const total = totalOf(players);
  const year = new Date().getFullYear();

  return (
    <>
      <PageHead title="Players" lead="Everyone who played a stored game, with FIDE data and photos from Lichess. Open a player to scout their openings and accuracy." />
      {user.role === "admin" && (
        <AdminBar hint="Players from Lichess imports are created automatically">
          <Modal label="Add player" icon="plus" title="Add a player" className="btn btn-solid">
            <ActionForm action={createPlayer} submit="Create player" resetOnSuccess><PlayerFields /></ActionForm>
          </Modal>
        </AdminBar>
      )}
      <section className="card">
        <AutoForm>
          <label className="field grow" style={{ minWidth: 240 }}><span className="field-label">Search by name</span>
            <div className="global-search" style={{ maxWidth: "none" }}><Icon name="search" /><input name="q" type="search" defaultValue={filters.q ?? ""} placeholder="e.g. Carlsen, Gukesh, Divya" /></div>
          </label>
          <label className="field"><span className="field-label">Title</span>
            <select name="title" defaultValue={sp.title ?? ""}><option value="">Any title</option>{facets.titles.map((t: any) => <option key={t.title} value={t.title}>{t.title} ({t.players})</option>)}</select>
          </label>
          <label className="field"><span className="field-label">Federation</span>
            <select name="federation" defaultValue={sp.federation ?? ""}><option value="">Any federation</option>{facets.federations.map((f: any) => <option key={f.federation} value={f.federation}>{federationName(f.federation)} ({f.players})</option>)}</select>
          </label>
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
          <button className="btn btn-primary" style={{ alignSelf: "flex-end" }}>Search</button>
          {Object.values(plain).some(Boolean) && <Link href="/players" className="btn btn-ghost" style={{ alignSelf: "flex-end" }}>Clear</Link>}
        </AutoForm>
        {players.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr>{th("Player", "name", "asc")}{th("Federation", "federation", "asc")}{th("FIDE rating", "rating", "desc", "num")}{th("Born", "born", "asc", "num hide-sm")}{th("Games", "games", "desc", "num")}<th className="num hide-sm">W / D / L</th>{th("Score", "score", "desc", "num")}</tr></thead>
            <tbody>{players.map((p: any) => (
              <RowLink key={p.player_id} href={`/players/${p.player_id}`}>
                <td><Link href={`/players/${p.player_id}`} className="person"><Avatar name={p.name} photo={p.photo_url} /><span className="truncate"><TitleChip title={p.title} /> <span className="name">{p.name}</span></span></Link></td>
                <td><Flag code={p.federation} /></td>
                <td className="num"><b>{p.rating ?? "—"}</b></td>
                <td className="num muted hide-sm">{p.birth_year ? `${p.birth_year} (${year - p.birth_year})` : "—"}</td>
                <td className="num">{p.games}</td>
                <td className="num small nowrap hide-sm">{Number(p.games) ? `${p.wins} / ${p.draws} / ${p.losses}` : "—"}</td>
                <td className="num">{pct(p.score_pct)}</td>
              </RowLink>
            ))}</tbody>
          </table></div>
        ) : <Empty>{filters.q ? `No player matches “${filters.q}”.` : "No players match these filters."}</Empty>}
        <Pagination base="/players" params={filters} page={page} perPage={PER_PAGE} total={total} />
      </section>
    </>
  );
}
