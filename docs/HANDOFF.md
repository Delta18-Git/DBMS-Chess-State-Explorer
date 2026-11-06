# Phase-two handoff

## Stop condition for this phase

A runnable Next.js API with the submitted MySQL domain schema; route-local SQL and transactions; legal game import and shared positions; meaningful SQL analytics; two application roles; constraints, views, procedure, triggers, indexes; documented setup and unit/real-database HTTP tests. This is the **SQL/backend half**, not a completed Level 3 final submission.

## Next implementor: frontend

1. Build the actual Next.js interface on the existing App Router skeleton. The current root page is only a backend landing page.
2. Use the documented APIs; keep SQL in each `route.ts`. Do not move transactions into a generic service/ORM while adding UI.
3. Implement login, read-only analyst experience, admin metadata/game/evaluation/repertoire forms, game/ply tables or board viewer, opening/player analytics, and explicit validation/error states.
4. Handle null evaluations and string decimal aggregates. Display evaluation coverage, not just blunder rates.
5. Choose a safe browser session strategy. Bearer tokens currently support HTTP clients; do not casually persist them in browser localStorage. If moving to HttpOnly cookies, add CSRF protections and adapt auth deliberately.
6. Preserve accessibility and use server-side authorization, not just hidden buttons.

## Next implementor: Neo4j

The graph is justified by transpositions and variable-length move-order search. There is no graph driver, environment variable, fake graph endpoint, sync promise or implementation in this phase.

Suggested model to finalize and document:

- `(:Position {position_id, fen})` with uniqueness on canonical FEN and/or MySQL position ID.
- Directed played-move relationships between positions, retaining SAN plus a clear game/ply identity or deliberate aggregated edge model.
- Derive graph data from MySQL's `position` and `ply` tables. Repertoire recommendations are not played moves.
- Implement variable-length path/transposition queries; keep the current SQL one-step explorer for simple aggregates.
- Design idempotent initial backfill and ongoing reconciliation. MySQL transactions do **not** make a dual write to Neo4j atomic. Choose and test an outbox/rebuild strategy when implementing synchronization, including game deletion and retry behavior.
- Use the same canonical FEN rule. Clock counters deliberately do not participate in board identity; do not use raw per-game FEN as a separate node key.
- Never mutate a stored position's FEN to repair graph identity. Repair/import with an explicit migration instead.

## Remaining final-submission items

- Functional frontend and screenshots.
- Neo4j schema, constraints/indexes, graph queries, integration and tests.
- Final report with objectives/scope, original submitted diagrams, implemented data dictionary, important queries, architecture, actual test results, conclusion and future work.
- Actual division of work: both students must contribute to database and application work. Do not claim responsibilities or commits on another person's behalf.
- Individual contribution history for both teammates.
- End-to-end demonstration of SQL plus NoSQL, role differences, rollback, and transposition queries.

## Known boundaries

- Local teaching deployment; production HTTPS, TLS-enabled remote MySQL, runtime least-privilege grants, distributed/global rate limiting and deployment observability remain deployment work.
- Single standard-start chess game per import, max 1000 plies. Custom starts, Chess960, multi-game PGN files, engine jobs and automated opening classification are excluded.
- Direct SQL writers can bypass application-level chess legality checks. Expose only the API to untrusted callers.
- No user-attributed global audit log; only trigger-based evaluation snapshots.
- No automatic orphan-position cleanup or schema migration/reset framework. Existing data must be protected when introducing later schema changes.
- Do not commit `.env.local`, `.env.test.local`, credentials, tokens, or generated build files.
