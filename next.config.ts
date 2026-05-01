import type { NextConfig } from 'next'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? ''
const isSqlite = dbUrl !== '' && !dbUrl.startsWith('postgresql') && !dbUrl.startsWith('postgres')

const config: NextConfig = {
  webpack(webpackConfig) {
    if (isSqlite) {
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        '@/db':        path.resolve(__dirname, 'src/db/index.sqlite.ts'),
        '@/db/schema': path.resolve(__dirname, 'src/db/schema.sqlite.ts'),
      }
    }
    return webpackConfig
  },
}

export default config
