# SQL design and machinery

## Problem and objectives

Chess engines evaluate individual boards, but players need cross-game opening results, move-quality trends and common positions reached through different move orders. Store games and reusable board states once, compute outcomes and centipawn-loss statistics inside MySQL, and mirror the position/move structure into Neo4j for move-order path traversal.

MySQL provides relational integrity, atomic multi-table imports and aggregate analytics; Neo4j is justified for variable-length move-order traversal, not as a duplicate CRUD store.

### Database choice and justification

| Data / question | Store | Why |
| --- | --- | --- |
| Players, tournaments, openings, games, plies, evaluations, repertoires, accounts | **MySQL** (source of truth) | Fixed schema with many FKs; imports must be atomic across game + plies + positions; analytics are aggregates (GROUP BY/HAVING, views, window functions, a stored procedure). |
| "Which move orders reach this board?", "where do lines merge?", "how does play branch from here?", "where did this game leave theory?" | **Neo4j** (derived mirror) | These are variable-length path questions over a graph of ~35k boards and ~36k move edges. In SQL each needs a recursive CTE that enumerates and de-duplicates paths per query; in Cypher they are one pattern: `allShortestPaths((start)-[:MOVE*]->(target))`, `(root)-[:MOVE*1..4]->()`, `COUNT { (p)<-[:MOVE]-() } >= 2`. |
| Engine scores (Stockfish 19, stored with the best move) | MySQL only | Needed by SQL aggregates; not needed for graph traversal. |

Neo4j holds nothing that cannot be rebuilt from MySQL (`POST /api/graph/sync?mode=rebuild`), so there is one authority for every fact.

## Submitted data dictionary

`database/schema.sql` is the executable authority. The original submitted ER and relational diagrams remain in `Submission1.pdf`.

| Table | Key and attributes | Relationships |
| --- | --- | --- |
| player | `player_id` PK; name, title, federation, birth_year, rating | One player has many games in either color and many repertoires |
| tournament | `tournament_id` PK; name, date, location | One tournament has many games |
| opening | `opening_id` PK; eco, name; UNIQUE(eco,name) | One opening classifies many games |
| position | `position_id` PK; UNIQUE fen, comment | Reused by many incoming/outgoing plies, evaluations and repertoire lines |
| game | `game_id` PK; white_player_id, black_player_id, tournament_id?, opening_id?, date?, result, pgn? | Two mandatory players; optional tournament/opening; many plies |
| ply | `ply_id` PK; game_id, ply_no, side, move_san, from_position_id, to_position_id | Game FK and two position FKs; UNIQUE(game_id,ply_no) |
| evaluation | `evaluation_id` PK; position_id, cp?, depth | Many evaluations per position; best by depth then ID |
| repertoire | `repertoire_id` PK; player_id, name | Belongs to one player; many recommended moves |
| repertoire_line | `repertoire_line_id` PK; repertoire_id, start_position_id, move_san | One recommended legal move from a board |

All submitted identifiers/FKs are unsigned INT; optional columns are represented as null. Submitted ON DELETE RESTRICT domain FKs remain intact. SQL primary keys, foreign keys, uniqueness, CHECK constraints and ENUMs enforce ranges, nonempty names, distinct opponents, valid result/side values, positive depths/ply numbers, and standard-start side/ply parity. Full chess rules and chain construction are validated at the API boundary by chess.js; direct arbitrary SQL writers must not bypass that boundary.

### Deliberate additions/clarifications

- FEN and SAN use **case-sensitive ASCII binary collation**: piece/color distinctions must not use the database's case-insensitive default.
- Canonical FEN normalizes clocks to `0 1` and removes irrelevant en-passant targets using chess.js. Side, pieces, castling rights and legally relevant en-passant availability still distinguish nodes. This is a board identity, **not** a complete state for fifty-move/repetition adjudication. Original game counters/history can be recovered from PGN and plies.
- CHECKs strengthen the submitted schema without changing its domain entities. A unique repertoire-move constraint is installed with ALTER TABLE.
- `app_user`: email, scrypt password hash, admin/analyst role, login failure/lockout state. These are application accounts, not public chess player identities.
- Password hashes are versioned: original hashes remain readable and upgrade after successful login. No schema change or password reset is required. Deploy this local backend as one version; rollback builds must also understand `scrypt-v2`, since an older-only reader cannot verify upgraded hashes.
- `api_session`: SHA-256 token hash, user FK, UTC expiry. Revocation deletes the session. User deletion cascades sessions only.
- `evaluation_audit`: trigger-written JSON INSERT/DELETE snapshots, no FK to evaluation so deletion cannot erase its history. This is a demonstration audit of score changes, not a comprehensive user-attributed activity log.

### Migration 003: real tournament data (`database/migrations/003_lichess_metadata.sql`)

All additions are `ALTER TABLE` / `CREATE VIEW` on top of the submitted tables (nothing is dropped or rewritten):

| Table / object | Added | Why |
| --- | --- | --- |
| player | `fide_id` (UNIQUE), `photo_url` | A player is the same person across tournaments: matched by FIDE id from the PGN headers. Federation, birth year, rating and title come from the Lichess FIDE API; photos from Wikimedia Commons via Wikidata. |
| tournament | `end_date`, `format`, `time_control`, `source_url` (UNIQUE), `image_url`; CHECK end ≥ start | Facts from the Lichess broadcast API; `source_url` makes re-imports idempotent. |
| game | `round`, `white_elo`, `black_elo`, `source_url` (UNIQUE), CHECK on ratings, index on date | Ratings at the time of the game belong to the game, not the player (they change); `source_url` skips duplicates. |
| opening | `pgn`, `position_id` → position (FK) | The Lichess opening catalogue (CC0, 3,332 names) names the *board* each line reaches, so any position can be named. |
| evaluation | `best_move_san`, `mate`; CHECK cp and mate not both set | Stockfish's preferred move ("Na5 was best") and forced-mate distance. |
| app_user | `display_name` | Accounts show a person, not an email. |
| repertoire | `color`, `owner_user_id` → app_user (ON DELETE SET NULL), `created_at` | Analysts own the repertoires they create; deleting an account keeps its repertoires. |
| triggers | `DROP TRIGGER` + `CREATE TRIGGER` for both evaluation triggers | Audit snapshots now include `best_move` and `mate` (triggers cannot be altered in place). |
| `v_latest_evaluation` | `CREATE OR REPLACE` | Exposes the new columns. |
| `v_ply_analysis` | `CREATE OR REPLACE` | Mate scores count as ±1000 cp and every score is clamped to ±1000, so a missed mate is no longer silently skipped and one won/lost swing cannot dominate averages. |
| `v_player_game` | `CREATE VIEW … UNION ALL` | Each game seen from each player's side (colour, opponent, ratings, score 1/½/0). Standings, colour splits and opening repertoires are simple GROUP BYs over it. |

## Architecture and ownership

```text
Next.js UI (Server Components + Server Actions, HttpOnly session cookie)
   and any other HTTP client
                |
      src/app/api/**/route.ts
      - validate and authorize
      - explicit transaction boundaries
      - route-local prepared SQL
                |
        mysql2 connection pool
                |
      MySQL 8.4 / InnoDB
      - tables / FK / CHECK / UNIQUE
      - views / stored procedure
      - triggers / indexes

      MySQL graph_outbox  --(relay: /api/graph/sync)-->  Neo4j 5 / 2026.x
      (trigger-written)                                    (:Position)-[:MOVE]->(:Position)
                                                           read by /api/graph/* routes
```

Only authentication lookup SQL is shared in `src/lib/auth.ts`. Chess helpers never issue SQL. No domain service, generic CRUD generator, or transaction wrapper conceals query execution from the route handler. The one shared piece of database logic is the outbox relay (`src/lib/graph-sync.ts`), which is infrastructure used by both the sync route and the CLI; it never begins or commits a transaction itself: the caller owns the MySQL transaction boundary. Graph read queries are written inline in each `/api/graph/**/route.ts`, like SQL.

## Demonstration matrix

| Concept | Where to show it |
| --- | --- |
| CREATE, keys and constraints | `database/schema.sql` |
| ALTER | Unique recommended-move constraint in schema |
| DROP | `database/ddl-demo.sql`: drop only its own temporary table |
| INSERT | POST games/evaluations/metadata |
| UPDATE | PATCH players/tournaments/openings/comments/game metadata |
| DELETE | Game handler explicitly removes child plies before parent; shared nodes survive |
| SELECT/JOIN | Game detail and position explorer |
| GROUP BY/HAVING/ORDER BY | Opening analytics with minimum-game filter |
| Aggregates/subqueries | Stored player summary, opening outcomes and move-quality rates |
| Transactions and locks | Game import, parent updates (`FOR UPDATE`), repertoire validation (`FOR SHARE`) |
| Views/window functions | `v_latest_evaluation`, `v_ply_analysis` |
| Stored procedure | `sp_player_summary`, called by player analytics route |
| Triggers | Score insert/delete → atomic JSON audit row |
| Indexes | FEN uniqueness, game/ply uniqueness, player/date, evaluation position/depth/ID, FK indexes |
| Full-text search | `FULLTEXT` indexes added by `ALTER TABLE` (migration 002); `GET /api/search` uses `MATCH … AGAINST … IN BOOLEAN MODE` |
| Triggers (graph) | `trg_game_graph_insert` / `trg_game_graph_delete` write `graph_outbox` inside the game's transaction |
| Locking reads | Outbox relay claims rows with `FOR UPDATE SKIP LOCKED` |
| Window function | `RANK() OVER` for most-visited boards in `/api/analytics/overview` |
| NoSQL graph | Neo4j constraints/indexes, variable-length traversal, `allShortestPaths`, `COUNT {}` subqueries (see below) |
| INSERT … SELECT + window function | `POST /api/repertoires/{id}/build`: `ROW_NUMBER() OVER (PARTITION BY from_position_id ORDER BY COUNT(*) DESC, …)` keeps a player's most frequent move per board |
| Window functions for pagination and ranking | `COUNT(*) OVER ()` gives every list page its total; `RANK() OVER (ORDER BY SUM(score) DESC)` builds tournament standings; `ROW_NUMBER()` picks each board's first visit for graph captions |
| UNION ALL view | `v_player_game` (one row per game per player) |
| GROUP BY … HAVING for structure | Opening detail: the defining board is the longest common prefix of its games (`GROUP BY ply_no HAVING COUNT(DISTINCT to_position_id) = 1`) |
| Row-level authorization | Repertoire PATCH/DELETE/lines check `owner_user_id` against the session user (analysts edit only their own) |
| Upserts | Imports use `INSERT … AS new ON DUPLICATE KEY UPDATE … LAST_INSERT_ID(id)` for players (by FIDE id), openings and tournaments |

The project demonstrates **seven advanced categories**: transactions, views, stored procedure, triggers, indexing, full-text search and NoSQL graph traversal.

## Neo4j graph mirror

### Data model

```text
(:Position:WhiteToMove|BlackToMove[:Start][:Transposition]
   {position_id, fen, side: 'w'|'b', is_start, ply, line, name, eco, opening})
   -[:MOVE {san, games, white_wins, black_wins, draws, game_ids: [INT]}]->
(:Position …)
```

Readable facts are computed in MySQL by the relay and written with the edges in the same Neo4j transaction:
`ply` (earliest ply any game reached the board), `line` (that game's move order, "1.d4 Nf6 2.c4"),
`name` (short caption, "2.c4"), and `eco`/`opening` (the deepest catalogue opening along that line).
Labels are recomputed from facts on every sync, so they never drift: `:WhiteToMove` / `:BlackToMove`
(side to move), `:Start`, and `:Transposition` (entered from two or more boards).

**Reading the graph in Neo4j Browser** (`http://127.0.0.1:7475`): run `:style` and drop
`database/neo4j/style.grass` onto it. Boards turn white or black by side to move, transpositions get a
blue ring, nodes are captioned with their move and edges with SAN. `database/neo4j/queries.cypher` has
ready-made queries (opening tree, a transposition with all its move orders, branch points, one game's path).
The web app draws the same graph itself (Explorer, player pages, opening pages) with the same colour code.

- **Nodes** are MySQL `position` rows that appear in at least one played move, plus the initial board. `position_id` is the MySQL primary key; `fen` is the same canonical FEN (clocks dropped), so both stores agree on board identity.
- **Edges** are **aggregated** played moves: one `MOVE` per `(from_position_id, to_position_id, SAN)`, carrying the number of distinct games, their results and the list of game IDs. Aggregation keeps path enumeration about *move orders* rather than one parallel edge per game; `game_ids` keeps provenance so "which games played this whole order?" is a list intersection.
- Repertoire lines are recommendations, not played moves, and are **not** in the graph. Evaluations stay in MySQL.
- The graph is a directed graph, not strictly a DAG: repetitions create cycles. All traversals are bounded.

### Constraints and indexes (`src/lib/graph.ts`, created idempotently by every sync and rebuild)

| Statement | Purpose |
| --- | --- |
| `CREATE CONSTRAINT position_id_unique … REQUIRE p.position_id IS UNIQUE` | One node per MySQL row; backing index for every `{position_id: …}` lookup and `MERGE`. |
| `CREATE CONSTRAINT position_fen_unique … REQUIRE p.fen IS UNIQUE` | Same identity rule as MySQL's `uq_position_fen`. |
| `CREATE INDEX position_start … ON (p.is_start)` | Fast anchor for path queries from the initial board. |
| `CREATE INDEX move_games … FOR ()-[m:MOVE]-() ON (m.games)` | Relationship-property index for popularity filters (`min_games`). |
| `CREATE INDEX position_ply / position_eco` | Transposition filters by opening family and move number. |

### Synchronisation: transactional outbox (migration `001_graph_outbox.sql`)

MySQL and Neo4j cannot share one transaction, so a "dual write" from the import handler could commit in one store and fail in the other. Instead:

1. `trg_game_graph_insert` / `trg_game_graph_delete` insert a `graph_outbox(game_id, action)` row **inside the same MySQL transaction** as the game insert/delete. A rolled-back import leaves no outbox row; a committed one always does.
2. The relay (`POST /api/graph/sync`, also run by `npm run setup`) begins a MySQL transaction and claims up to 200 pending rows with `SELECT … FOR UPDATE SKIP LOCKED` (concurrent relays never claim the same rows).
3. Affected edges = the game's current plies in MySQL ∪ graph edges whose `game_ids` contain the game. Each affected edge is **recomputed from the `v_move_edge` view** (MySQL's derived-condition pushdown filters the grouped view by its grouping columns). Edges that no longer exist are deleted, and so are nodes left with no edges.
4. All Neo4j writes run in one Neo4j transaction; then the outbox rows are marked `processed_at` and the MySQL transaction commits.

If Neo4j fails, MySQL rolls back and the rows stay pending. If MySQL fails after Neo4j committed, the rows are replayed, and replay is harmless because edges are *recomputed*, not incremented (idempotent, at-least-once). `mode=rebuild` wipes the graph and reloads it from `v_move_edge`, which the integration tests prove produces exactly the incrementally maintained graph.

`v_move_edge` (same migration) is the single definition of an edge used by both the relay and the rebuild.

### Important Cypher queries

```cypher
// Transpositions: boards entered from >= 2 different boards (labelled by the relay)
MATCH (p:Transposition) WHERE $eco IS NULL OR p.eco STARTS WITH $eco
MATCH (prev:Position)-[m:MOVE]->(p)
WITH p, collect({from: prev.position_id, san: m.san, games: m.games}) AS incoming
RETURN p.position_id, size(incoming) AS routes, incoming ORDER BY routes DESC

// Every minimal move order from the initial board; which games played each one in full
MATCH (s:Position {is_start: true}), (t:Position {position_id: $id})
MATCH p = allShortestPaths((s)-[:MOVE*..500]->(t))
WITH p, relationships(p) AS rs
RETURN [r IN rs | r.san] AS moves,
       reduce(acc = head(rs).game_ids, r IN tail(rs) | [g IN acc WHERE g IN r.game_ids]) AS played_by

// Opening tree: continuations within N plies, pruned by popularity
MATCH p = (:Position {position_id: $id})-[:MOVE*1..3]->()
WHERE all(r IN relationships(p) WHERE r.games >= $min_games)
UNWIND relationships(p) AS r
RETURN DISTINCT startNode(r).position_id, r.san, r.games, endNode(r).position_id


// A player's own opening graph: shared edges restricted to the games they played as one colour
MATCH (a:Position)-[r:MOVE]->(b:Position)
WHERE a.ply < $depth AND any(g IN r.game_ids WHERE g IN $their_games)
RETURN a.position_id, b.position_id, r.san, [g IN r.game_ids WHERE g IN $their_games] AS games
```

Novelty detection reads the game's ply order from MySQL and the per-edge popularity from Neo4j in one request: the first move whose edge contains no other game is the novelty, and the other edges leaving that board are the "theory" alternatives.

Equivalent SQL for move orders would need a recursive CTE walking `ply` from the start board, carrying the path as a string and de-duplicating per depth for every request. The graph answers it from stored adjacency.

## Transaction examples

### Atomic import (`src/app/api/games/route.ts`, POST)

1. Acquire the connection inside the handler's error boundary; BEGIN and authenticate admin.
2. Parse strict PGN, check its normalized UTF-8 byte length, and construct canonical from/to boards before any domain writes.
3. Insert all distinct FENs in stable sorted order; duplicate boards reuse their existing row.
4. Read node IDs with `FOR SHARE` (a current read, not a potentially stale repeatable-read snapshot).
5. Insert game and all plies with prepared placeholders.
6. COMMIT. Any FK, constraint, lock or unexpected failure → ROLLBACK; destroy the connection if rollback fails, and always release it. Connection-acquisition failures return a safe JSON error too.

The rollback test deliberately uses a nonexistent opening after new position rows have been inserted, then verifies that all three table counts are unchanged. Deadlocks/timeouts return a conflict; callers can retry, rather than the server silently replaying a possibly committed request.

### Reads and updates

Reads use explicit read-only transactions. Multi-query responses (game+plies, repertoire+lines, player summary+blunders) share a repeatable-read snapshot under MySQL's default isolation. PATCH locks the existing row before merging only supplied fields, avoiding a lost update caused by concurrent read/modify/write requests. Child creation locks its parent where needed; FKs are the final concurrency/integrity guard.

MySQL DDL is not transactional. Initialization (`npm run setup`) creates the schema only in an empty database and otherwise just applies new numbered migrations, rather than promising rollback or dropping partially created data.

### Whole-tournament import (`POST /api/import/lichess`, `src/lib/importer.ts`)

1. BEGIN, authorize admin, COMMIT: no locks are held while Lichess is contacted.
2. Fetch the broadcast metadata + PGN (or read the cached copy in `data/lichess/`), FIDE records and photos.
3. BEGIN; upsert the tournament (by `source_url`), each player (by `fide_id`) and opening (by ECO + name); skip games whose `source_url` exists; insert positions, game and plies exactly like the single-game import.
4. COMMIT: the whole tournament appears atomically (the game triggers queue one outbox row per game in the same transaction).

### Engine scoring (`POST /api/engine/analyse`)

A read-only transaction selects boards without an evaluation; Stockfish then runs with **no transaction open**
(bundled as the `stockfish` npm package, WebAssembly, or a native binary via `STOCKFISH_PATH`, in parallel
processes); finally one write transaction inserts every score and the audit trigger records each row.

## Evaluation semantics

- Scores are White-relative centipawns (or `mate` in moves) from Stockfish 19, which ships with the app: on the server it scores stored boards (`POST /api/engine/analyse`, also run by `npm run setup`); in the browser it gives live analysis lines that are never stored.
- Latest/best view uses `ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY depth DESC, evaluation_id DESC)`.
- Move-loss view joins game, ply, and two copies of that best-evaluation view. Black's sign is reversed. Mates count as ±1000 cp and every score is clamped to ±1000. Improving moves have zero loss; missing endpoint scores yield null loss.
- Blunder = loss ≥200 CP. Averages and rates use only evaluated plies. No score is fabricated for missing positions.
- SQL decimal results are kept as strings by the driver; the frontend decides display formatting.

## Useful manual checks

Run these with a SQL client connected to the configured database:

```sql
SHOW TABLES;
SHOW TRIGGERS;
SHOW INDEX FROM evaluation;
SHOW CREATE VIEW v_ply_analysis;
CALL sp_player_summary(1);
SELECT * FROM v_player_game WHERE player_id = 1 LIMIT 5;

SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT p.position_id, p.fen, COUNT(DISTINCT m.game_id) AS games
FROM `position` p JOIN ply m ON m.to_position_id = p.position_id
GROUP BY p.position_id, p.fen HAVING COUNT(DISTINCT m.game_id) > 1
ORDER BY games DESC;

EXPLAIN SELECT * FROM evaluation WHERE position_id = 1
ORDER BY depth DESC, evaluation_id DESC LIMIT 1;
```

No schema reset or permanent-table DROP is needed for the demonstration.
