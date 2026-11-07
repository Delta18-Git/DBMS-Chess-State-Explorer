# Verification results

Latest run: 2026-11-08, on Node.js 26.12.1 (conda env `db_lab`), Next.js 16.4.5, React 19.3.1, TypeScript 7.0.2, mysql2 3.24.6, neo4j-driver 6.3.0, Stockfish 19, **MySQL 8.4** and **Neo4j 2026.10 Community** in rootless Podman containers. HTTP tests ran against the compiled production server (`next build` + `next start`), not mocks.

| Check | Result |
| --- | --- |
| `npm test` | 17 unit tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed: 41 API route files (61 handlers) and 17 UI pages |
| Integration: MySQL + HTTP suite | 11 scenarios passed (incl. new: multi-game PGN import, totals, standings, repertoire ownership and deviations, accounts) |
| Integration: Neo4j + outbox + search suite | 8 scenarios passed |
| `npm audit --omit=dev` | 0 known vulnerabilities |
| `npm run setup` into an empty database | Schema + 3 migrations, 2 accounts, 3,332 catalogue openings, 7 Lichess tournaments → 397 games / 39,418 plies, Stockfish 19 (depth 12, 16 parallel processes) scored all 35,282 non-terminal boards in ~11 minutes, graph built, 4 example repertoires. About 12 minutes end to end. |
| Graph consistency | Neo4j 35,310 nodes = distinct boards reached in games; 35,709 `MOVE` edges = `v_move_edge` rows; 393 `:Transposition` nodes |
| Every UI page with an admin session | 17 pages (plus filtered/paginated variants) rendered without runtime errors; position lookup by moves redirects to the stored board |
| Visual check (headless Chrome, 1440 px and 390 px) | Sign-in, home, games, game viewer, players, player, tournaments, tournament, openings, opening, explorer, transpositions, repertoire, admin; no horizontal page overflow at phone width |

## Integration scenarios: Neo4j, outbox and search (`tests/graph.integration.test.ts`)

1. A game insert writes exactly one `UPSERT` outbox row; a failed import (FK violation after position writes) leaves the outbox unchanged: the trigger output rolls back with the transaction.
2. Pending changes appear in `/graph/stats`; analysts can read but get 403 on sync; novelty for an unsynced game reports `synced: false` instead of guessing; draining applies the game's 6 edges, and a second drain processes 0 rows.
3. Two games reaching the same board by different move orders: MySQL stores one position row; the merge board appears in `/graph/transpositions` with 2 routes; `/paths` returns exactly two 6-ply orders, each `played_by` the right game.
4. The opening tree aggregates both games onto one edge (`games = 2`), `min_games=3` prunes it, and depth beyond 4 is rejected (400).
5. Novelty: a third game following the first for 4 plies is detected at ply 5, with `book_plies = 4`, the reference game, and the alternative played by the others.
6. Deleting that game queues a `DELETE` outbox row; after sync exactly one edge disappears, no edge references the game, and no orphan nodes remain.
7. A full rebuild produces exactly the incrementally maintained graph, and its edge count equals `v_move_edge`.
8. FULLTEXT prefix search finds the created player first; hostile input like `Karpovsky" -(>~*` becomes `+Karpovsky*`; blank queries return 400; the overview endpoint responds.

## Integration scenarios: MySQL and HTTP (`tests/integration.test.ts`)

1. Public health, protected reads, salted passwords/hashed sessions, persistent failed-login lockout, admin/analyst permissions.
2. Metadata CRUD, PATCH preservation, invalid inputs rejected, SQL-injection text stored as data.
3. Legal PGN ingestion, ordered plies, shared positions across transposing move orders, full rollback after position writes when a later FK fails.
4. Highest-depth evaluation selection, both-colour centipawn loss and blunders, null-score exclusion, audit triggers, opening/position aggregates, stored procedure.
5. Concurrent imports resolve the same position IDs with a current read.
6. Immutable positions, canonical lookup, legal repertoire SAN, duplicate/referenced-row protection, explicit child deletes, shared boards survive game deletion.
7. Database CHECK constraints, index presence, missing resources, safe CREATE/ALTER/DROP demo.
8. Logout revocation and database-enforced session expiry.
9. Expired lockouts restart the failure counter; successful login clears it.
10. Concurrent logins for separate users; legacy hash upgrade; invalid UTF-8/oversized PGNs and unauthorized imports write nothing.
11. Three-game PGN import (analyst 403; admin 201): players matched by name across games, tournament created from `[Event]`, ratings and round stored; re-import skips all 3 (`source_url` UNIQUE); `total_rows` = 3 with `limit=2`; result filter; standings give the winner 1½ and place 1; a repertoire built from the games finds the one deviation; analysts cannot rename others' repertoires but can create and rename their own; `/users` is admin-only, rejects short passwords, protects the caller's own account.

## Unit tests (`tests/unit.test.ts`)

Lichess helpers (broadcast link parsing, multi-game PGN splitting with comment/NAG stripping, classical-only filter), numbered-pagination window, migration 003 safety (triggers re-created with the new columns, no destructive statements), canonical FEN identity, transposition boards, PGN legality/result rules, repertoire SAN, insufficient material, PATCH schemas, password hashing and token hashing, strict JSON/UTF-8 bodies, MySQL date bounds, PGN byte limits; **every** route handler (including the new graph and search routes) is checked for its own transaction start, commit, rollback and connection release, and invoked with a failing pool to confirm a safe 503 with no leaked details; failed-rollback connection destruction; FULLTEXT query sanitising; the outbox migration's triggers and the relay's `SKIP LOCKED` claim.

## How to reproduce

Integration tests need a separate MySQL database whose name ends in `_test` and a disposable Neo4j (the graph suite rebuilds it). Put both in `.env.test.local` (add `NEO4J_CONTAINER=chess-neo4j-test` and `MYSQL_ROOT_PASSWORD` to let setup manage them), then:

```bash
npm run setup -- --env .env.test.local --schema-only      # creates/migrates the test database
npm run build
set -a; source .env.test.local; set +a
npm run start -- --hostname 127.0.0.1 --port 3100 &
INTEGRATION_TESTS=1 NEO4J_TEST_OK=1 TEST_BASE_URL=http://127.0.0.1:3100 npm run test:integration
```

## Not covered

Browser automation of every form (pages were rendered and visually inspected; mutations are covered at the API level), sustained load, production deployment, TLS to remote databases, and Neo4j cluster/routing failover. Dependency audits are point-in-time checks, not a penetration test.
