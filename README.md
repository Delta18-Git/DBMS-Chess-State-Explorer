# Chess State Explorer

**Database for Opening Transpositions and Game Analytics**  
Vinaayak G Dasika (PES2UG24CS588) · Vignesh Nunna (PES2UG24CS582)

Backend-first implementation of `Submission1.pdf`, following `DBMS Level 3 Mini_Project Requirements draft.pdf`. MySQL owns normalized chess data and aggregate analytics. Neo4j will eventually own move-order/path traversal; it is **not implemented in this phase**.

## Delivered scope

- Next.js App Router API, TypeScript, MySQL 8.4/InnoDB, raw parameterized SQL (`mysql2`). No ORM.
- All nine submitted domain tables, plus separate login/session tables and an evaluation audit table.
- Legal standard-chess PGN ingestion, atomic position deduplication, ordered plies, and safe game deletion.
- Players, tournaments, openings, positions, evaluations, and repertoires APIs.
- Opening results, player win/loss and centipawn-loss/blunder statistics, one-step position explorer.
- Two roles: **admin** reads/writes; **analyst** reads only. Versioned scrypt passwords, hashed expiring/revocable bearer tokens, database-backed login lockout.
- Transactions, views/window functions, stored procedure/subqueries, triggers, and indexes; integration tests use real MySQL and HTTP.

**Strict API structure:** every exported handler in `src/app/api/**/route.ts` owns its SQL and its explicit `BEGIN`/`START TRANSACTION READ ONLY`, `COMMIT`, `ROLLBACK`, and connection release. Shared files supply only connection pooling, authentication, validation, chess parsing, and response formatting. There is no repository/service/transaction wrapper hiding domain database operations. A test enforces local transaction boundaries in every handler.

## Prerequisites

- Node.js 22+ and npm.
- MySQL **8.4** (not SQLite/MariaDB), or Docker Compose. Rootless Podman is also usable.
- Keep the original PDFs: they contain the submitted ER/schema diagrams and requirements.

## Local setup

```bash
npm ci
cp .env.example .env.local
# Edit .env.local: choose two different local database passwords.
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
# Wait until MySQL is healthy, then:
npm run db:init
```

Already running MySQL? Create an empty `chess_intel` database with `utf8mb4_unicode_ci`, configure `.env.local`, and skip Compose. Creating triggers with binary logging enabled requires a DBA to enable `log_bin_trust_function_creators` or install the schema with appropriate privileges. Compose sets that flag for this local teaching database; do not enable it blindly on a shared production server.

`db:init` applies `database/schema.sql` and `database/seed.sql` **once**. It refuses any nonempty database. MySQL DDL implicitly commits: if initialization fails halfway, inspect the error and use a new empty database rather than rerunning or dropping existing work. There is intentionally no destructive reset command. Seed data supplies four players, one tournament, three openings, and the starting position; it does not invent engine scores or game results.

Create accounts (the terminal does not echo the password):

```bash
read -rsp 'Admin password (12+ characters): ' BOOTSTRAP_PASSWORD
export BOOTSTRAP_PASSWORD
npm run user:create -- admin@example.com admin
unset BOOTSTRAP_PASSWORD

read -rsp 'Analyst password (12+ characters): ' BOOTSTRAP_PASSWORD
export BOOTSTRAP_PASSWORD
npm run user:create -- analyst@example.com analyst
unset BOOTSTRAP_PASSWORD

npm run dev
```

The account-creation script never stores the plaintext password. Login accounts are **not** chess players. Use `http://localhost:3000/api/health` to check readiness. `/` is only an API landing page, not the future frontend.

For rootless Podman without a Compose provider, run the equivalent `mysql:8.4` container with the four `MYSQL_*` environment variables, port binding, persistent volume and `--log-bin-trust-function-creators=1` server argument; then use the same npm commands. Never point application configuration at the root account.

## Use the API

Log in with `POST /api/auth/login`, then send `Authorization: Bearer <token>`. See **[docs/API.md](docs/API.md)** for the endpoint contract, examples, filters, and status codes. Tokens expire after 12 hours; keep them out of URLs and Git. Use HTTPS outside localhost.

Useful demonstrations:

1. Import `1. Nf3 Nf6 2. g3 g6 3. Bg2 Bg7 1-0` and `1. g3 g6 2. Nf3 Nf6 3. Bg2 Bg7 0-1` for the same players/opening. Both final plies reference the **same** position row.
2. Import with a nonexistent opening ID: the game, plies, and any new positions all roll back.
3. Insert evaluations before/after a move. Read `/api/analytics/players/:id`; centipawn losses are computed in SQL, not JavaScript.
4. Read `/api/evaluations/audit`, then delete an evaluation and read it again: triggers preserve both snapshots.
5. Attempt a write as analyst (403), or delete a referenced player (409).

## Verification

```bash
npm test
npm run typecheck
npm run build
```

Integration tests require a **separate, initialized database whose name ends in `_test`** and an exclusive server pointed at that same database. Tests do not initialize or reset it; they remove only their own fixtures. Do not run concurrent integration suites against it.

Example, using a separate `.env.test.local` file (never commit it) with database credentials and `DB_NAME=chess_intel_test`:

```bash
# Provision this empty database and grants first; load variables into this shell:
set -a
source .env.test.local
set +a
# Inherited variables take precedence over .env.local:
npm run db:init
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
# In a second shell with the SAME test environment loaded:
INTEGRATION_TESTS=1 TEST_BASE_URL=http://127.0.0.1:3100 npm run test:integration
```

Tests cover authentication/lockout recovery, legacy password-hash upgrades, simultaneous logins, role permissions, CRUD, PATCH preservation, SQL-injection input, FK/CHECK/UNIQUE constraints, legal PGN/SAN, transposition deduplication, concurrent imports, rollback **after position writes**, deterministic evaluation selection, NULL scores, both-color blunders, views/procedure/triggers, analytics, logout/expiry, and safe DDL demonstration. Unit tests exercise every API handler's connection-failure path and check failed-rollback cleanup, strict JSON/UTF-8, MySQL date bounds and PGN byte limits. Decimal aggregates can be JSON strings (MySQL preserves precision).

## Project layout

```text
src/app/api/          Route-local domain SQL and transaction logic
src/lib/              Pool, auth, validation, chess and HTTP utilities
database/schema.sql   DDL, constraints, indexes, views, procedure and triggers
database/seed.sql     Initial sample metadata
database/ddl-demo.sql Non-destructive temporary-table CREATE/ALTER/DROP example
scripts/              One-time initialization and account provisioning
tests/                Unit and real-MySQL HTTP tests
docs/API.md           Frontend-facing HTTP contract
docs/DATABASE.md      Schema, SQL machinery and modeling decisions
docs/HANDOFF.md       Deferred phase and submission checklist
docs/TESTING.md       Recorded backend verification results
```

## Security and scope limits

Compose grants the local application user database-wide privileges for initialization. For deployment, have a DBA install the schema, then use a runtime account limited to the required `SELECT/INSERT/UPDATE/DELETE` and `EXECUTE` permissions; it should have no schema-changing permissions or direct write permission on `evaluation_audit`. Keep DB ports private, enable TLS on remote database connections, and put the API behind HTTPS plus request/login rate limiting. The current configuration is for a local course project, **not hardened Internet deployment**. Login lockout is per account (five failed attempts, 15-minute lock), not a global anti-abuse system.

No frontend, Neo4j connection/synchronization, graph-path search, engine execution, bulk multi-game import, or custom-start/variant chess is implemented. PGNs are single-game, mainline-only, 1–1000 plies. Positions ignore clocks for board identity; game history remains in PGN/plies. See the [handoff](docs/HANDOFF.md) before building phase two.

Feature slices use Conventional Commits. PDFs and local credentials are excluded from Git. Configure a GitHub remote separately.
