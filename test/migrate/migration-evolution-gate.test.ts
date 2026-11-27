import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { AUDIT_FILE, auditTable, outcomes } from './migration-evolution.ts';

// The v0.5.3 -> 0.1.0 migration evolution gate; what it proves is described in `./migration-evolution.ts`.
for (const outcome of outcomes) {
  test(`v0.5.3 -> 0.1.0 evolution: ${outcome.id}`, () => {
    assert.deepEqual(outcome.failures, [], `${outcome.id}: ${outcome.failures.join('; ')}`);
  });
}

test(`${AUDIT_FILE} is the table this gate produces`, () => {
  const committed = existsSync(AUDIT_FILE) ? readFileSync(AUDIT_FILE, 'utf8') : undefined;
  assert.ok(
    committed === auditTable(),
    `${AUDIT_FILE} is missing or differs from what the code produces: run bun run migration:audit`,
  );
});
