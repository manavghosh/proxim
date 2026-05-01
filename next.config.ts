import type { NextConfig } from 'next'
import path from 'path'

const config: NextConfig = {
  // better-sqlite3 is a native Node.js module — must not be bundled by webpack
  serverExternalPackages: ['better-sqlite3'],

  webpack(webpackConfig) {
    // DATABASE_URL must be read here, inside the webpack fn.
    // .env.local is loaded before webpack() is invoked but AFTER
    // next.config.ts module evaluation, so reading it at module level
    // would always see an empty string.
    const dbUrl = process.env.DATABASE_URL ?? ''
    const isSqlite =
      dbUrl !== '' &&
      !dbUrl.startsWith('postgresql') &&
      !dbUrl.startsWith('postgres')

    if (isSqlite) {
      const sqliteDb     = path.resolve(__dirname, 'src/db/index.sqlite.ts')
      const sqliteSchema = path.resolve(__dirname, 'src/db/schema.sqlite.ts')

      webpackConfig.resolve.alias = {
        ...(webpackConfig.resolve.alias as object),
        // Alias the @/ tsconfig paths (caught before tsconfig resolution)
        '@/db':        sqliteDb,
        '@/db/schema': sqliteSchema,
        // Alias the resolved absolute paths as a belt-and-suspenders fallback
        [path.resolve(__dirname, 'src/db/index.ts')]:  sqliteDb,
        [path.resolve(__dirname, 'src/db/schema.ts')]: sqliteSchema,
      }
    }

    return webpackConfig
  },
}

export default config
