import type { Migration } from '../db/migrate.js';
import core from './0001_core.js';

/** Every schema migration, in version order. Never edit one after it has been applied. */
export const MIGRATIONS: Migration[] = [core];
