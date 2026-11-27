/**
 * Writes docs/audits/migration-evolution-gate.md, the summary table of the migration evolution gate
 * (bun run migration:audit). The gate's test compares the file with the table and never writes it.
 */
import { writeFileSync } from 'node:fs';

import { AUDIT_FILE, auditTable } from '../test/migrate/migration-evolution.ts';

writeFileSync(AUDIT_FILE, auditTable());
console.log(`Wrote ${AUDIT_FILE}`);
