import Link from "next/link";
import { apiAll, currentUser } from "@/lib/web/api";
import { ActionForm, Field } from "@/components/ActionForm";
import { importGame } from "@/app/actions";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Import game · Chess State Explorer" };

const SAMPLE = `[Event "Transposition demo"]

1. Nf3 Nf6 2. c4 e6 3. d4 d5 4. Nc3 Be7 *`;

export default async function ImportPage() {
  const [user, players, openings, tournaments] = await Promise.all([currentUser(), apiAll("/players"), apiAll("/openings"), apiAll("/tournaments")]);
  players.sort((a: any, b: any) => a.name.localeCompare(b.name));
  openings.sort((a: any, b: any) => a.eco.localeCompare(b.eco));
  return (
    <>
      <PageHead title="Import a game" sub="Paste one standard-chess PGN. The server checks every move, then writes game, plies and shared positions in ONE transaction." />
      {user.role !== "admin" && <p className="callout callout-warn">You are signed in as an <b>analyst</b>. The form is shown, but the API will reject the import (403): authorization is enforced server-side.</p>}
      <div className="grid grid-2">
        <section className="card">
          <ActionForm action={importGame} submit="Import game">
            <div className="form-row">
              <Field label="White *">
                <select name="white_player_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Black *">
                <select name="black_player_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {players.map((p: any) => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="form-row">
              <Field label="Opening">
                <select name="opening_id" defaultValue="">
                  <option value="">Unclassified</option>
                  {openings.map((o: any) => <option key={o.opening_id} value={o.opening_id}>{o.eco} {o.name}</option>)}
                </select>
              </Field>
              <Field label="Tournament">
                <select name="tournament_id" defaultValue="">
                  <option value="">None</option>
                  {tournaments.map((t: any) => <option key={t.tournament_id} value={t.tournament_id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Date"><input type="date" name="date" min="1000-01-01" max="9999-12-31" /></Field>
            </div>
            <Field label="PGN *" hint="Main line only, 1–1000 plies, standard start. Max 60,000 characters.">
              <textarea name="pgn" rows={10} required maxLength={60000} defaultValue={SAMPLE} />
            </Field>
          </ActionForm>
        </section>
        <section className="card stack small">
          <h2>What happens on import</h2>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>BEGIN</b>, then check the admin session inside the transaction.</li>
            <li>chess.js replays every move; illegal SAN or a contradictory result is rejected (400) before any write.</li>
            <li>Each board is canonicalised (clocks dropped) and <code>INSERT … ON DUPLICATE</code>-merged: a board reached by another move order <b>reuses the same position row</b>.</li>
            <li>Insert the game and every ply; trigger <code>trg_game_graph_insert</code> writes a <code>graph_outbox</code> row in the same transaction.</li>
            <li><b>COMMIT</b>. On any failure (e.g. a bad FK) everything rolls back, including new positions.</li>
            <li>The outbox relay then upserts the affected <code>MOVE</code> edges in Neo4j.</li>
          </ol>
          <p className="callout">Try it: the sample above reaches the Queen&apos;s Gambit Declined by a Réti move order. After import, open its last position and see the transposition paths. Need a new player? <Link href="/players">Add one</Link>.</p>
        </section>
      </div>
    </>
  );
}
