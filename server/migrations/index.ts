import type { Migration } from '../db/migrate.js';

/** Every schema migration, in version order. Never edit one after it has been applied. */
export const MIGRATIONS: Migration[] = [];
