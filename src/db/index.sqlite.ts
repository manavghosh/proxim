import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.sqlite'

const url = process.env.DATABASE_URL ?? './proxim-dev.db'
const client = new Database(url)

// Enable WAL mode for better concurrent read performance
client.pragma('journal_mode = WAL')
client.pragma('foreign_keys = ON')

export const db = drizzle(client, { schema, casing: 'snake_case' })
