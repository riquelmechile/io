/**
 * Public surface of @io/database — the PostgreSQL-shaped adapter slice over the
 * trust-kernel persistence ports. Exports the injectable SYNCHRONOUS
 * {@link DbConnection} port, the two PG-shaped repository adapters, and the
 * honest {@link PERSISTENT_PORT_DISCLOSURE}. See README.md for scope and the
 * deferred sync/async + DbSession debt.
 */
export type { DbConnection, DbRow } from './connection.js';
export { PgEvidenceRepository } from './evidence-adapter.js';
export { PgAuditRepository } from './audit-adapter.js';
export { PERSISTENT_PORT_DISCLOSURE } from './disclosure.js';
