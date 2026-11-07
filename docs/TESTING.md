# Verification results

Latest run: 2026-11-07, on Node.js 26.12.1 (conda env `db_lab`), Next.js 16.4.5, React 19.3.1, TypeScript 7.0.2, mysql2 3.24.6, neo4j-driver 6.3.0, **MySQL 8.4.13** and **Neo4j 2026.10.0 Community** in rootless Podman containers. HTTP tests ran against the compiled production server (`next build` + `next start`), not mocks.

| Check | Result |
| --- | --- |
| `npm test` | 14 unit tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed: 32 API route files (51 handlers) and 16 UI pages |
| `npm run test:integration` (MySQL + HTTP suite) | 10 scenarios passed |
| `npm run test:integration` (Neo4j + outbox + search suite) | 8 scenarios passed |
| Integration suites run twice in a row | 20/20 both times; the test graph returned to only the start node (fixtures fully cleaned up) |
| `npm audit --omit=dev` | 0 known vulnerabilities |
| `npm run db:init` on an empty database | Schema, seed, views, procedure, triggers and both migrations installed |
| Sample load through the API | 67/67 games, 6,461 plies, 6,042 distinct positions; Stockfish 19 depth-14 scores for every non-terminal position |
| Graph consistency after sync | Neo4j 6,042 nodes / 6,072 `MOVE` edges = MySQL positions / `v_move_edge` rows; 31 transpositions |
| Every UI page rendered with an admin session | 21/21 returned 200 (plus a 307 redirect for move-order lookup), no runtime errors |
| Browser flows (headless Chrome, real forms and Server Actions) | Wrong password shows an error and sets no cookie; signed-out visit redirects to `/login`; session cookie is `HttpOnly` + `SameSite=Strict`; admin PGN import redirects to the new game, and its final board shows 4 move orders (3 assembled from other games); analyst submitting the same form sees "read-only" (API 403); admin delete via the UI redirects and re-syncs the graph (edges back to 6,072, 0 pending); sign-out clears the cookie |

## Integration scenarios: Neo4j, outbox and search (`tests/graph.integration.test.ts`)

1. A game insert writes exactly one `UPSERT` outbox row; a failed import (FK violation after position writes) leaves the outbox unchanged: the trigger output rolls back with the transaction.
2. Pending changes appear in `/graph/stats`; analysts can read but get 403 on sync; novelty for an unsynced game reports `synced: false` instead of guessing; draining applies the game's 6 edges, and a second drain processes 0 rows.
3. Two games reaching the same board by different move orders: MySQL stores one position row; the merge board appears in `/graph/transpositions` with 2 routes; `/paths` returns exactly two 6-ply orders, each `played_by` the right game.
4. The opening tree aggregates both games onto one edge (`games = 2`), `min_games=3` prunes it, and depth beyond 4 is rejected (400).
5. Novelty: a third game following the first for 4 plies is detected at ply 5, with `book_plies = 4`, the reference game, and the alternative played by the others.
6. Deleting that game queues a `DELETE` outbox row; after sync exactly one edge disappears, no edge references the game, and no orphan nodes remain.
7. A full rebuild produces exactly the incrementally maintained graph, and its edge count equals `v_move_edge`.
8. FULLTEXT prefix search finds the created player first; hostile input like `Karpovsky" -(>~*` becomes `+Karpovsky*`; blank queries return 400; the overview endpoint responds.

## Integration scenarios: MySQL and HTTP (`tests/integration.test.ts`, phase 1)

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

## Unit tests (`tests/unit.test.ts`)

Canonical FEN identity, transposition boards, PGN legality/result rules, repertoire SAN, insufficient material, PATCH schemas, password hashing and token hashing, strict JSON/UTF-8 bodies, MySQL date bounds, PGN byte limits; **every** route handler (including the new graph and search routes) is checked for its own transaction start, commit, rollback and connection release, and invoked with a failing pool to confirm a safe 503 with no leaked details; failed-rollback connection destruction; FULLTEXT query sanitising; the outbox migration's triggers and the relay's `SKIP LOCKED` claim.

## How to reproduce

See README → Verification. The graph suite needs `NEO4J_TEST_OK=1` and a Neo4j instance used only for tests, because it rebuilds the graph.

## Not covered

Browser automation of every form (pages were rendered and visually inspected; mutations are covered at the API level), sustained load, production deployment, TLS to remote databases, and Neo4j cluster/routing failover. Dependency audits are point-in-time checks, not a penetration test.
