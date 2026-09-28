import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = { org_id: string; state_json: string };
type UserRow = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  branch_ids: string;
  active: number;
};

function usage(): never {
  throw new Error(
    'Usage: npx tsx scripts/maintenance.ts --db <existing.sqlite> [--backup <existing-backup.sqlite>] [--apply-permissions]',
  );
}

function fileMode(path: string) {
  if (!existsSync(path)) return { path, exists: false };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Refusing non-regular file or symbolic link: ${path}`);
  return { path, exists: true, mode: (stat.mode & 0o777).toString(8).padStart(3, '0') };
}

function parseBranchIds(raw: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function inspectDatabase(dbPath: string, backupPath?: string) {
  const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, ...(backupPath ? [backupPath] : [])];
  const files = paths.map(fileMode);
  if (!files[0].exists) throw new Error(`Database does not exist: ${dbPath}`);
  if (backupPath && !files.at(-1)?.exists) throw new Error(`Backup does not exist: ${backupPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableNames = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
        .map((row) => row.name),
    );
    if (!tableNames.has('org_state') || !tableNames.has('users'))
      throw new Error('Not an initialized CTMS database');
    const states = db.prepare('SELECT org_id,state_json FROM org_state').all() as Row[];
    const users = db
      .prepare('SELECT id,org_id,email,role,branch_ids,active FROM users')
      .all() as UserRow[];
    const organizations = states.map((row) => {
      const state = JSON.parse(row.state_json) as Record<string, any>;
      const branchIds = new Set(
        (Array.isArray(state.branches) ? state.branches : []).map((branch: any) => branch.id),
      );
      const orgUsers = users.filter((user) => user.org_id === row.org_id);
      const invalidUsers = orgUsers.flatMap((user) => {
        const reasons: string[] = [];
        const normalized = user.email.trim().toLowerCase();
        if (
          user.email !== normalized ||
          normalized.length > 254 ||
          !/^\S+@\S+\.\S+$/.test(normalized) ||
          normalized.endsWith('@batra.demo') && state.settings?.mode === 'live'
        ) reasons.push('invalid email');
        if (!['admin', 'operations', 'quality', 'finance', 'driver', 'auditor'].includes(user.role))
          reasons.push('invalid role');
        const assigned = parseBranchIds(user.branch_ids);
        if (!assigned || !assigned.length || assigned.some((id) => !branchIds.has(id)))
          reasons.push('invalid branch assignment');
        return reasons.length ? [{ userId: user.id, reasons }] : [];
      });
      const orgAdmins = orgUsers.filter((user) => {
        const assigned = parseBranchIds(user.branch_ids);
        return user.active === 1 && user.role === 'admin' &&
          assigned && [...branchIds].every((id) => assigned.includes(id));
      });
      const invoices = Array.isArray(state.invoices) ? state.invoices : [];
      const orders = Array.isArray(state.orders) ? state.orders : [];
      const movements = Array.isArray(state.movements) ? state.movements : [];
      return {
        orgId: row.org_id,
        missingOrganizationAdmin: orgAdmins.length === 0,
        invalidUsers,
        invoiceIdsMissingIdentitySnapshot: invoices
          .filter((invoice: any) => !invoice.billTo || !invoice.issuer)
          .map((invoice: any) => invoice.id),
        dispatchedOrderIdsMissingChallanSnapshot: orders
          .filter((order: any) =>
            ['dispatched', 'partial', 'delivered', 'closed_short'].includes(order.status) &&
            !order.challanSnapshot,
          )
          .map((order: any) => order.id),
        deliveryMovementIdsMissingBatchSnapshot: movements
          .filter((movement: any) =>
            movement.action === 'delivery' && !movement.before?.batchId &&
            !movement.after?.batchId,
          )
          .map((movement: any) => movement.id),
      };
    });
    return { database: dbPath, files, organizations };
  } finally {
    db.close();
  }
}

export function runMaintenance(args: string[]) {
  let dbPath: string | undefined;
  let backupPath: string | undefined;
  let applyPermissions = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db') dbPath = resolve(args[++i] ?? usage());
    else if (args[i] === '--backup') backupPath = resolve(args[++i] ?? usage());
    else if (args[i] === '--apply-permissions') applyPermissions = true;
    else usage();
  }
  if (!dbPath) usage();
  const report = inspectDatabase(dbPath, backupPath);
  if (applyPermissions) {
    for (const file of report.files) if (file.exists) chmodSync(file.path, 0o600);
    report.files = report.files.map((file) => fileMode(file.path));
  }
  return { ...report, permissionChangesApplied: applyPermissions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(runMaintenance(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
