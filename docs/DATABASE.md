# SQL design and machinery

## Problem and objectives

Chess engines evaluate individual boards, but players need cross-game opening results, move-quality trends and common positions reached through different move orders. Store games and reusable board states once, then compute outcomes and centipawn-loss statistics inside the database. Preserve a clean position/move model that a later Neo4j implementor can mirror for path traversal.

MySQL provides relational integrity, atomic multi-table imports and aggregate analytics; Neo4j is justified for variable-length move-order traversal, not as a duplicate CRUD store. This phase deliberately stops at SQL.

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
- `api_session`: SHA-256 token hash, user FK, UTC expiry. Revocation deletes the session. User deletion cascades sessions only.
- `evaluation_audit`: trigger-written JSON INSERT/DELETE snapshots, no FK to evaluation so deletion cannot erase its history. This is a demonstration audit of score changes, not a comprehensive user-attributed activity log.

## Architecture and ownership

```text
future Next.js UI / current HTTP clients
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

future Neo4j mirror: positions + played moves (not yet connected)
```

Only authentication lookup SQL is shared in `src/lib/auth.ts`. Chess helpers never issue SQL. No domain service, generic CRUD generator, or transaction wrapper conceals query execution from the route handler.

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

The project demonstrates **five advanced categories** before counting Neo4j: transactions, views, stored procedure, triggers, indexing.

## Transaction examples

### Atomic import (`src/app/api/games/route.ts`, POST)

1. Parse strict PGN and construct canonical from/to boards before starting a DB transaction.
2. BEGIN; authenticate admin using the same connection.
3. Insert all distinct FENs in stable sorted order; duplicate boards reuse their existing row.
4. Read node IDs with `FOR SHARE` (a current read, not a potentially stale repeatable-read snapshot).
5. Insert game and all plies with prepared placeholders.
6. COMMIT. Any FK, constraint, lock or unexpected failure → ROLLBACK; always release connection.

The rollback test deliberately uses a nonexistent opening after new position rows have been inserted, then verifies that all three table counts are unchanged. Deadlocks/timeouts return a conflict; callers can retry, rather than the server silently replaying a possibly committed request.

### Reads and updates

Reads use explicit read-only transactions. Multi-query responses (game+plies, repertoire+lines, player summary+blunders) share a repeatable-read snapshot under MySQL's default isolation. PATCH locks the existing row before merging only supplied fields, avoiding a lost update caused by concurrent read/modify/write requests. Child creation locks its parent where needed; FKs are the final concurrency/integrity guard.

MySQL DDL is not transactional. Initialization is one-time and refuses existing tables, rather than promising rollback or automatically dropping partially created data.

## Evaluation semantics

- Scores are White-relative centipawns, supplied externally; no engine runs in this backend.
- Latest/best view uses `ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY depth DESC, evaluation_id DESC)`.
- Move-loss view joins game, ply, and two copies of that best-evaluation view. Black's sign is reversed. Improving moves have zero loss; missing/null endpoint scores yield null loss.
- Blunder = loss ≥200 CP. Averages and rates use only evaluated plies. No score is fabricated for missing positions.
- SQL decimal results are kept as strings by the driver; the frontend decides display formatting.

## Useful manual checks

Run these with a SQL client connected to the configured database:

```sql
SHOW TABLES;
SHOW TRIGGERS;
SHOW INDEX FROM evaluation;
SHOW CREATE VIEW v_ply_analysis;
CALL sp_player_summary(3);

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
