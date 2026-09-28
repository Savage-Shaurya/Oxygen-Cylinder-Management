import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { runMaintenance } from '../scripts/maintenance.js';

test('maintenance reviews legacy records without changing data or permissions by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctms-maintenance-'));
  const dbPath = join(dir, 'synthetic.sqlite');
  const backupPath = join(dir, 'named-backup.sqlite');
  try {
    const store = new Store({ dbPath, demoMode: true });
    try {
      const state = store.getState('batra');
      state.invoices.push({ id: 'legacy-invoice' } as never);
      state.orders.push({ id: 'legacy-order', status: 'delivered' } as never);
      state.movements.push({ id: 'legacy-delivery', action: 'delivery' } as never);
      store.db.prepare('UPDATE org_state SET state_json=? WHERE org_id=?')
        .run(JSON.stringify(state), 'batra');
      store.db.prepare("UPDATE users SET branch_ids='[]' WHERE id='u-admin'").run();
      store.db.prepare("UPDATE users SET email='invalid' WHERE id='u-finance'").run();
    } finally {
      store.close();
    }
    chmodSync(dbPath, 0o644);
    writeFileSync(backupPath, 'synthetic backup placeholder', { mode: 0o644 });
    const before = statSync(dbPath).mtimeMs;
    const dryRun = runMaintenance(['--db', dbPath, '--backup', backupPath]);
    assert.equal(dryRun.permissionChangesApplied, false);
    assert.equal(dryRun.files[0].mode, '644');
    assert.equal(statSync(dbPath).mode & 0o777, 0o644);
    assert.equal(statSync(backupPath).mode & 0o777, 0o644);
    assert.equal(statSync(dbPath).mtimeMs, before);
    const org = dryRun.organizations[0];
    assert.equal(org.missingOrganizationAdmin, true);
    assert.deepEqual(org.invoiceIdsMissingIdentitySnapshot, ['legacy-invoice']);
    assert.deepEqual(org.dispatchedOrderIdsMissingChallanSnapshot, ['legacy-order']);
    assert.deepEqual(org.deliveryMovementIdsMissingBatchSnapshot, ['legacy-delivery']);
    assert.deepEqual(org.invalidUsers, [
      { userId: 'u-admin', reasons: ['invalid branch assignment'] },
      { userId: 'u-finance', reasons: ['invalid email'] },
    ]);
    const applied = runMaintenance(['--db', dbPath, '--backup', backupPath, '--apply-permissions']);
    assert.equal(applied.permissionChangesApplied, true);
    assert.equal(statSync(dbPath).mode & 0o777, 0o600);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    assert.equal(statSync(dbPath).mtimeMs, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
