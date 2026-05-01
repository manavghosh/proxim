import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './migrations/sqlite',
  dialect: 'sqlite',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './proxim-dev.db',
  },
})
