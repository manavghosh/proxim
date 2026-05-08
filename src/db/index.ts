/**
 * Auto-detecting DB singleton.
 * DATABASE_URL starts with postgresql:// → Neon HTTP driver
 * Anything else (e.g. ./proxim-dev.db)  → better-sqlite3
 *
 * Both Next.js and the Python agent share the same DATABASE_URL so they
 * always talk to the same database.
 */
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from './schema'

const url = process.env.DATABASE_URL ?? './proxim-dev.db'
const isNeon = url.startsWith('postgresql') || url.startsWith('postgres')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _neonClient: any = null

if (isNeon) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neon } = require('@neondatabase/serverless')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/neon-http')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const s = require('./schema')
  _neonClient = neon(url)
  _db = drizzle({ client: _neonClient, schema: s, casing: 'snake_case' })
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const s = require('./schema.sqlite')
  const client = new Database(url)
  client.pragma('journal_mode = WAL')
  client.pragma('foreign_keys = ON')
  _db = drizzle(client, { schema: s, casing: 'snake_case' })
}

// Typed as Neon so all existing routes typecheck. At runtime the SQLite
// driver uses the same Drizzle query builder interface via duck typing.
export const db = _db as NeonHttpDatabase<typeof schema>
export const neonClient = _neonClient as ReturnType<
  typeof import('@neondatabase/serverless')['neon']
> | null
