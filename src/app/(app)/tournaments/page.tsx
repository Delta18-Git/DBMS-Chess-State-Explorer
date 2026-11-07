import Link from "next/link";
import { apiAll, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { createTournament, importLichess } from "@/app/actions";
import { AdminBar, Empty, PageHead, dateRange } from "@/components/ui";

export const metadata = { title: "Tournaments · Chess State Explorer" };

export default async function TournamentsPage() {
  const [user, tournaments] = await Promise.all([currentUser(), apiAll("/tournaments")]);
  return (
    <>
      <PageHead title="Tournaments" lead="Events imported from Lichess broadcasts. Open one for its standings, openings and games." />
      {user.role === "admin" && (
        <AdminBar hint="Importing a broadcast creates the tournament with its dates, format and players">
          <Modal label="Import from Lichess" icon="upload" title="Import a Lichess broadcast" className="btn btn-solid">
            <ActionForm action={importLichess.bind(null, true)} submit="Import tournament" icon="upload">
              <Field label="Broadcast link" hint="Any lichess.org/broadcast/… tournament or round link"><input name="source" required placeholder="https://lichess.org/broadcast/…" /></Field>
            </ActionForm>
          </Modal>
          <Modal label="Add manually" icon="plus" title="Add a tournament" className="btn btn-sm">
            <ActionForm action={createTournament} submit="Create tournament" resetOnSuccess>
              <div className="form-row">
                <Field label="Name"><input name="name" required maxLength={150} /></Field>
                <Field label="Start date"><input name="date" type="date" min="1000-01-01" /></Field>
                <Field label="Location"><input name="location" maxLength={150} /></Field>
              </div>
            </ActionForm>
          </Modal>
        </AdminBar>
      )}
      {tournaments.length ? (
        <div className="tour-grid">
          {tournaments.map((t: any) => (
            <Link key={t.tournament_id} href={`/tournaments/${t.tournament_id}`} className="card tour-card">
              <div className="tour-band"><span>{t.date ? new Date(t.date).toLocaleString("en", { month: "short", year: "numeric" }) : ""}</span><span>{t.games} games</span></div>
              <div className="body">
                <h2>{t.name}</h2>
                <div className="facts">
                  <span className="row" style={{ gap: 4 }}><Icon name="clock" />{dateRange(t.date, t.end_date)}</span>
                  {t.location && <span>{t.location}</span>}
                </div>
                <div className="facts">
                  <span><b>{t.games}</b> games</span><span><b>{t.players}</b> players</span>
                  {t.avg_elo && <span>avg <b>{t.avg_elo}</b></span>}
                  {t.decisive_pct !== null && <span><b>{t.decisive_pct}%</b> decisive</span>}
                </div>
                {t.format && <div className="tiny muted">{t.format}</div>}
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty>No tournaments yet.</Empty>}
    </>
  );
}
