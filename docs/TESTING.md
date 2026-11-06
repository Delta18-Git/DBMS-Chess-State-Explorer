# Backend verification results

Verified on 2026-11-07 using Node.js 26.13.0, TypeScript 7.0.2, Next.js 16.4.5 and real MySQL 8.4.13 in an isolated rootless Podman container. HTTP tests exercised the compiled production Next.js server, not mocks or an in-memory SQL substitute.

| Check | Result |
| --- | --- |
| `npm test` | 12 unit tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, including all API handlers |
| `npm run test:integration` with explicit test environment | 10 scenarios passed (Node reports 11 tests including the parent harness) |
| `npm outdated --json` | No outdated direct dependencies; checked against npm latest stable tags |
| `npm audit` | 0 known vulnerabilities at verification time, including development dependencies |
| HTTP checks with MySQL stopped | Health, players and login return safe JSON 503 responses with `no-store` |
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
9. Expired account lockouts restart their failed-attempt counter; successful login clears it. This caught and fixed a bug caused by treating MySQL's string `"0"` flag as true.
10. Repeated concurrent logins for separate users succeed. Legacy password hashes upgrade on successful login; invalid UTF-8/oversized PGNs and unauthorized imports cannot write domain data.

The unit suite also checks every exported API handler for local transaction start, commit, rollback, and release logic, and invokes each handler with a failing pool to verify safe 503 responses. A failed-rollback test verifies connection destruction and preservation of the original error. Further tests cover legacy password verification, malformed hash rejection, strict JSON media types, invalid UTF-8, MySQL's year limits, PGN byte limits and insufficient mating material. Test code and repeatable execution instructions are in `tests/` and `README.md`.

Not tested: frontend/browser flows, Neo4j/synchronization, production deployment, sustained load, remote-MySQL TLS, or custom-start/variant chess. Those are outside this backend phase. Security audit results are point-in-time dependency checks, not a penetration test.
