# Project status and handoff

## Phase 1: SQL backend (Vinaayak)

Runnable Next.js API with the submitted MySQL domain schema; route-local SQL and transactions; legal game import and shared positions; SQL analytics; two roles; constraints, views, procedure, triggers, indexes; unit and real-database HTTP tests.

## Phase 2: graph, interface, data (Vignesh)

- **Neo4j mirror** of positions and played moves through a transactional outbox (migration 001), FULLTEXT search (migration 002), graph routes (transpositions, move orders, opening tree, novelty, stats).
- **Real data (migration 003)**: 7 Lichess broadcast tournaments (397 classical games), players enriched from the Lichess FIDE API with Wikimedia Commons photos (via Wikidata), positions named by the Lichess opening catalogue, every board scored by Stockfish 19 with its best move.
- **Stockfish in the app**: the `stockfish` npm package. Server side scores boards (`POST /api/engine/analyse`); the browser runs the WASM build for live lines (`/engine/*`).
- **One command**: `npm run setup` (containers, schema/migrations, accounts, catalogue, tournaments, engine, graph, example repertoires). Old scripts (`dev-db.sh`, `db:init`, `data:load`, `graph:sync`, `user:create`, compose) were folded into it.
- **Graph readability**: node labels (`:WhiteToMove`/`:BlackToMove`, `:Start`, `:Transposition`) and properties (`line`, `name`, `opening`) maintained by the relay; `database/neo4j/style.grass` for Neo4j Browser; the web app draws the same graph (`MoveGraph`).
- **Roles that mean something**: admins curate shared data (all admin actions in a dark "Admin" bar at the top of each page); analysts read everything and own their repertoires (owner checks in the API).
- **UI**: light-only, IBM Plex, numbered pagination, clickable rows, filters, explorer with a playable board, game viewer with eval bar and annotations, player/tournament/opening detail pages, responsive down to phone width.

## Remaining for submission

- Final report in the PES template (`reference/course/DBMS MINI PROJECT REPORT SAMPLE.docx`), using `docs/DATABASE.md`, `docs/TESTING.md` and `docs/screenshots/`.
- Demo rehearsal (README → Demo script).

## Rules to keep when changing things

- Keep SQL and Cypher inside each `route.ts`, with the handler owning `BEGIN`/`START TRANSACTION READ ONLY`, `COMMIT`, `ROLLBACK` and release; the unit tests enforce it. Two shared database routines exist, and in both the **caller owns the transaction**: the outbox relay (`src/lib/graph-sync.ts`) and the multi-game importer (`src/lib/importer.ts`).
- Never write to Neo4j from a domain handler. Change MySQL, let the triggers fill the outbox, let the relay apply it.
- Never mutate a stored FEN; it is the node identity in both stores.
- New schema changes go in a new numbered migration. Never edit an applied one.
- Never hold a MySQL transaction open across a network call or an engine run (see the import and analyse routes).
- Do not commit `.env.local`, `.env.test.local`, tokens or build output.

## Known boundaries

- Local teaching deployment; production HTTPS, TLS to remote databases, least-privilege runtime grants and distributed rate limiting remain deployment work.
- Standard-start main-line games only, max 1000 plies; armageddon/tiebreak broadcast games are skipped.
- Lichess serves its own photos and tournament images only to lichess.org, so photos come from Wikimedia Commons and tournaments have no images.
- Path queries return minimal-length move orders (`allShortestPaths`); orders that waste tempi are not listed.
- Direct SQL writers bypass chess legality checks; expose only the API.
