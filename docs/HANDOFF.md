# Project status and handoff

## Phase 1: SQL backend (Vinaayak)

Runnable Next.js API with the submitted MySQL domain schema; route-local SQL and transactions; legal game import and shared positions; SQL analytics; two roles; constraints, views, procedure, triggers, indexes; unit and real-database HTTP tests.

## Phase 2: graph, interface, data (Vignesh)

- **Neo4j mirror** of positions and played moves (aggregated `MOVE` edges), uniqueness constraints and indexes, and graph routes for transpositions, move-order paths, opening tree, novelty and stats.
- **Transactional outbox** (migration 001): game INSERT/DELETE triggers, `v_move_edge`, idempotent relay with `FOR UPDATE SKIP LOCKED`, full rebuild, orphan-node cleanup. Neo4j outages never block MySQL writes.
- **FULLTEXT search** (migration 002) and `/api/search`; `/api/analytics/overview` for the dashboard.
- **Web interface**: login (HttpOnly cookie session + Server Actions), dashboard, games (filters, PGN import, viewer with evaluation chart and novelty), position explorer (lookup by FEN or moves, SQL explorer, graph paths and tree), transpositions, players (search, procedure-backed stats), openings (HAVING filter), tournaments, repertoires, admin (graph sync, evaluation audit). Role-aware, and the API still enforces every role.
- **Data pipeline**: 67 real games from Lichess broadcasts imported through the API, all reachable positions scored by Stockfish 19 (depth 14).
- **Migrations framework** (`database/migrations`, `npm run db:migrate`), `scripts/dev-db.sh` for Podman/Docker, Compose now includes Neo4j.
- **Tests**: unit additions and a Neo4j + MySQL + HTTP integration suite.

## Remaining for submission

- Final report in the PES template (`reference/course/DBMS MINI PROJECT REPORT SAMPLE.docx`), using `docs/DATABASE.md`, `docs/TESTING.md` and `docs/screenshots/`.
- Demo rehearsal (see README "Useful demonstrations").

## Rules to keep when changing things

- Keep SQL and Cypher inside each `route.ts`, with the handler owning `BEGIN`/`START TRANSACTION READ ONLY`, `COMMIT`, `ROLLBACK` and release; the unit tests enforce it. The outbox relay is the only shared database routine, and its caller owns the transaction.
- Never write to Neo4j from a domain handler. Change MySQL, let the triggers fill the outbox, let the relay apply it.
- Never mutate a stored FEN; it is the node identity in both stores.
- New schema changes go in a new numbered migration. Never edit an applied one.
- Do not commit `.env.local`, `.env.test.local`, tokens or build output.

## Known boundaries

- Local teaching deployment; production HTTPS, TLS to remote databases, least-privilege runtime grants and distributed rate limiting remain deployment work.
- One standard-start game per import, max 1000 plies; no Chess960, multi-game API import or automatic opening classification.
- Path queries return minimal-length move orders (`allShortestPaths`); orders that waste tempi are not listed.
- Direct SQL writers bypass chess legality checks; expose only the API.
