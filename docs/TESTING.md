# Backend verification results

Verified on 2026-11-07 using Node.js 26.13.0, Next.js 16.4.5 and real MySQL 8.4.13 in an isolated rootless Podman container. HTTP tests exercised the compiled production Next.js server, not mocks or an in-memory SQL substitute.

| Check | Result |
| --- | --- |
| `npm test` | 8 unit tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, including all API handlers |
| `npm run test:integration` with explicit test environment | 8 scenarios passed (Node reports 9 tests including the parent harness) |
| `npm audit --omit=dev` | 0 known vulnerabilities at verification time |
| `npm run db:init` against an empty database | Schema, seed, views, procedure and triggers installed |
| `npm run user:create` | Analyst account provisioned successfully; test account removed afterward |

## Integration scenarios

1. Public health, protected reads, salted passwords/hashed sessions, persistent failed-login lockout, and admin/analyst permissions.
2. Metadata creation/reads/updates/deletion, preservation of omitted PATCH fields, rejection of invalid inputs, and SQL-injection text treated as data.
3. Legal PGN ingestion, contiguous ordered plies, shared canonical positions across transposing move orders, and complete rollback after writes when a later game FK fails.
4. Highest-depth/latest-ID evaluation selection, both-color centipawn losses and blunders, null-score exclusion, audit triggers, opening and position aggregates, and the player-summary stored procedure.
5. Concurrent game imports resolving the same position IDs without stale repeatable-read snapshots.
6. Position identity immutability, canonical lookup, legal repertoire SAN, duplicate/referenced-row protection, explicit child deletion, and survival of shared boards when a game is deleted.
7. Database CHECK constraints, index presence, missing-resource behavior, and safe temporary-table CREATE/ALTER/DROP.
8. Immediate logout revocation and database-enforced session expiration.

The unit suite also checks every exported API handler for local transaction start, commit, rollback, and release logic. Test code and repeatable execution instructions are in `tests/` and `README.md`.

Not tested: frontend/browser flows, Neo4j/synchronization, production deployment, sustained load, remote-MySQL TLS, or custom-start/variant chess. Those are outside this backend phase. Security audit results are point-in-time dependency checks, not a penetration test.
