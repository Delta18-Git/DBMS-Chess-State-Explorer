# HTTP API contract

Base path: `/api`. Node.js runtime; JSON requests and responses. No API version prefix or non-Next.js router. Files under `src/app/api` correspond directly to these paths.

## Conventions

- Success: `{ "data": ... }`. Errors: `{ "error": { "message": "..." } }`.
- `POST` creates return 201; successful reads, updates, deletes and auth operations return 200. Deletes return `{ "data": { "deleted": <id> } }`.
- Public: health and login. All other endpoints require `Authorization: Bearer <64-character-hex-token>`.
- **admin:** all operations. **analyst:** GET/read only (plus own login/logout).
- Send `Content-Type: application/json` for request bodies. Maximum streamed body: 128 KiB. Unknown body fields are rejected.
- IDs in JSON bodies must be positive integer numbers, not strings. IDs in paths/query strings are parsed and bounded to MySQL unsigned INT.
- Optional database fields default to `null` on creation; PATCH preserves omitted fields. Explicit `null` clears nullable fields. Empty PATCH bodies are rejected.
- Collections default to `limit=25&offset=0`, max limit 100, max offset 1,000,000. Detail game plies and repertoire lines are returned together with their parent, not paginated. Analytics player pagination applies to the `blunders` list, not the summary.
- Dates: `YYYY-MM-DD`, years 1000–9999 (MySQL DATE range). Session timestamps use UTC. `COUNT`/`DECIMAL`/BIGINT outputs may be strings to avoid precision loss; frontend should parse display values deliberately.
- Responses containing data/errors set `Cache-Control: no-store`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON/UTF-8, input, FEN/PGN/SAN, or database CHECK violation |
| 401 | Missing/invalid/expired bearer token or wrong login credentials |
| 403 | Authenticated but not admin |
| 404 | Resource not found |
| 409 | Duplicate key, referenced resource, or concurrent lock conflict (retry) |
| 413 / 415 | Body too large / unsupported content type |
| 422 | Foreign-key reference does not exist |
| 429 | Login account locked after five failed attempts |
| 500 / 503 | Unexpected failure / database connection unavailable (health also detects uninitialized DB) |

Unsupported HTTP methods are handled by Next.js (405).

## Authentication

### `POST /auth/login` (public)

```json
{ "email": "admin@example.com", "password": "your-password" }
```

Returns `{ data: { token, expires_in: 43200, user: { user_id, email, role } } }`. Email is normalized to lowercase. Tokens are returned only at login; the database stores SHA-256 hashes, not raw tokens. New passwords use versioned salted scrypt hashes (`N=16384, r=8, p=5`). Original `scrypt:` hashes remain valid and upgrade atomically on successful login. Five failed attempts lock the account for 15 minutes. After expiry, the next failed attempt starts at one; successful login resets failures. Expired sessions are cleaned up on successful login.

### `GET /auth/me`

Returns `{ data: { user_id, email, role } }`.

### `POST /auth/logout`

No body required. Revokes only the supplied token; returns `{ data: { logged_out: true } }`.

No public registration or role-change endpoint. Provision trusted accounts with `npm run user:create`.

## Players, tournaments, openings

| Collection | Methods | Detail | Methods |
| --- | --- | --- | --- |
| `/players` | GET, POST | `/players/:id` | GET, PATCH, DELETE |
| `/tournaments` | GET, POST | `/tournaments/:id` | GET, PATCH, DELETE |
| `/openings` | GET, POST | `/openings/:id` | GET, PATCH, DELETE |

Create bodies:

```json
{ "name": "Demo Player", "title": "GM", "federation": "IND", "birth_year": 1990, "rating": 2400 }
```

Only player `name` is required. Rating 0–3500; birth year 1850–2100; federation exactly three uppercase letters; title at most 10 characters.

```json
{ "name": "Demo Tournament", "date": "2026-01-01", "location": "Bengaluru" }
```

Only tournament `name` is required.

```json
{ "eco": "A05", "name": "Reti: Kingside fianchetto" }
```

Both opening fields are required. ECO must match `A00`–`E99`; `(eco, name)` is unique. PATCH accepts any subset of each create body's fields. Deleting referenced metadata returns 409; detach references through game PATCH or delete dependent games/repertoires first.

## Positions

| Endpoint | Behavior |
| --- | --- |
| `GET /positions?fen=<URL-encoded-FEN>` | List, optionally exact canonical-FEN lookup |
| `POST /positions` | `{ "fen": "...", "comment": null }`; validates and canonicalizes FEN; duplicate returns 409 |
| `GET /positions/:id` | Position plus best `evaluation_id`, `cp`, `depth` (null if absent) |
| `PATCH /positions/:id` | `{ "comment": "..." }` only; FEN is immutable |
| `DELETE /positions/:id` | Only if no plies/evaluations/repertoire lines reference it |

Canonical FEN = board placement, side to move, castling rights, meaningful en-passant target, followed by `0 1`. Counters are deliberately excluded from board identity. Case-sensitive storage preserves the difference between white and black pieces. Comments are limited to 10,000 characters.

## Games and plies

### `GET /games`

Optional `player_id` (either color), `opening_id`, `limit`, `offset`. Returns game metadata with joined player/tournament/opening names, newest game ID first. Does not include large PGNs or ply lists.

### `POST /games`

```json
{
  "white_player_id": 3,
  "black_player_id": 4,
  "tournament_id": 1,
  "opening_id": 1,
  "date": "2026-01-01",
  "pgn": "1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 1-0"
}
```

Required: two distinct player IDs and `pgn`. Other metadata may be omitted or null. Optional `result`: `1-0`, `0-1`, `1/2-1/2`, `*`; defaults to the PGN result. Explicit result must agree with any decisive/drawn PGN result and with checkmate/stalemate/insufficient material. Resignations and agreed draws are valid without a terminal board.

Only standard-start, standard-chess, single-game main lines with 1–1000 legal plies are supported. PGN input is limited to 60,000 characters; normalized UTF-8 output must also fit MySQL TEXT's 65,535-byte limit, including generated headers. Oversized output is rejected before domain writes. Variations/comments may be parsed by chess.js, but only mainline moves become ply rows. The normalized PGN stores the authoritative result. API player/opening/tournament IDs are authoritative; PGN header names do not provision records or determine opening classification.

The handler begins a transaction and authorizes admin before parsing the PGN, then upserts canonical positions, reads current position IDs, inserts the game, and inserts every ordered ply. Any failure rolls back **all** database changes. Connections that fail rollback are destroyed rather than returned to the pool with an uncertain transaction state.

Returns `{ data: { game_id, result, plies, positions } }`. `plies` and `positions` are counts; positions counts distinct nodes used in this game, not newly created rows. Duplicate PGN imports create distinct game records but reuse positions.

### `GET /games/:id`

Returns game fields, normalized `pgn`, joined names, and `plies` ordered by `ply_no`. Each ply includes submitted-schema fields plus `from_fen`, `to_fen`, `before_cp`, `after_cp`, `cp_loss` from the SQL analysis view.

### `PATCH /games/:id`

Only `tournament_id`, `opening_id`, and `date` may change. Moves, players, result and PGN are immutable; delete/reimport to replace a game. This prevents move histories and PGN results from drifting apart.

### `DELETE /games/:id`

Explicitly deletes plies, then the game, in one transaction. Shared positions, evaluations, and repertoires are preserved. Unreferenced positions are not automatically garbage-collected.

## Evaluations

| Endpoint | Behavior |
| --- | --- |
| `GET /evaluations?position_id=...` | Paginated evaluation history, newest ID first |
| `POST /evaluations` | `{ "position_id": 1, "cp": 35, "depth": 20 }` |
| `DELETE /evaluations/:id` | Remove an evaluation; trigger retains its snapshot |
| `GET /evaluations/audit` | Paginated JSON snapshots, newest audit ID first |

`cp` is required but nullable; range −100000…100000. Scores always use **White's perspective**, irrespective of side to move. `depth` is 1–255. There is no engine execution: an implementor/admin supplies scores. A null CP means unscored/non-centipawn evaluation, not zero or a mate distance. Evaluations are append-only apart from explicit deletion. Best evaluation = greatest depth, then greatest evaluation ID. Audit entries are trigger-managed and cannot be changed through the API.

## Repertoires

| Endpoint | Body / response |
| --- | --- |
| `GET /repertoires?player_id=...` | Paginated repertoires, player names and line counts |
| `POST /repertoires` | `{ "player_id": 3, "name": "White repertoire" }` |
| `GET /repertoires/:id` | Repertoire and its `lines`, including start FENs |
| `PATCH /repertoires/:id` | `{ "name": "Updated repertoire" }` |
| `DELETE /repertoires/:id` | Delete lines then repertoire atomically |
| `POST /repertoires/:id/lines` | `{ "start_position_id": 1, "move_san": "e4" }` |
| `DELETE /repertoires/:id/lines/:lineId` | Delete exactly this parent's line |

A line represents **one recommended move from a position**, as submitted, not a serialized multi-move variation. SAN is checked against the stored FEN. Duplicate `(repertoire, start position, SAN)` returns 409. A line neither creates a game nor fabricates position graph edges.

## Analytics

### `GET /analytics/openings?min_games=1`

SQL JOIN/GROUP BY/HAVING/ORDER BY analysis. Each row includes `opening_id, eco, name, games, white_wins, black_wins, draws, unfinished, white_win_pct, white_score_pct`. Completed-game denominator excludes `*`; with no completed games percentages are null. White score gives half a point for a draw. Openings without games are omitted; `min_games` counts all games, including unfinished. Supports collection pagination.

### `GET /analytics/players/:id`

Returns `{ data: { summary, blunders } }`. Summary is produced by `CALL sp_player_summary(?)`: games/wins/draws/losses/unfinished, evaluated plies, average centipawn loss, blunders, blunder rate. `blunders` lists individual moves with loss ≥200 CP, sorted largest first, with limit/offset.

SQL calculates `max(0, (before_cp - after_cp) * (white ? 1 : -1))`. Both endpoint scores must exist and be non-null. Unevaluated moves are excluded from averages/rates; empty averages/rates are null. Blunder threshold is 200 CP. Coverage (`evaluated_plies`) matters: these are stored-evaluation statistics, not a complete engine assessment.

### `GET /analytics/positions/:id`

Returns `{ data: { position, usage: { games, occurrences }, next_moves } }`. Counts incoming visits plus an initial-game visit, then groups outgoing moves/destinations and distinct-game outcomes. Repeated visits in one game count multiple occurrences but only one game/outcome per move/destination. `next_moves` supports pagination. This is a SQL one-step opening explorer, **not** the deferred Neo4j transposition-path API.

## Example import

After login, copy the returned token to `TOKEN` in your local shell. IDs below use the initial metadata seed.

```bash
curl -s http://localhost:3000/api/games \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"white_player_id":3,"black_player_id":4,"opening_id":1,"tournament_id":1,"pgn":"1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 1-0"}'

curl -s http://localhost:3000/api/analytics/openings \
  -H "Authorization: Bearer $TOKEN"
```
