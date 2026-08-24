import { defineConfig } from 'tsdown'

import {
  CLIENT_MODULE_EXTERNALS,
  CLIENT_MODULE_ID,
  MODULE_LOADER_FOOTER,
  MODULE_LOADER_INTRO,
  moduleLoaderBanner,
} from './src/client/module-loader.ts'

const externals = new Set(CLIENT_MODULE_EXTERNALS)

/**
 * Client-half bundle for the Swarm panel (`dsh.client`).
 *
 * Must be the official lazy-CJS factory wire, not a plain ESM module:
 * executing the script only REGISTERS `window.__ModuleLoader__.load({id, factory})`.
 * See deepseek-harness/packages/client/tsdown.client.ts (`clientConfig` banner/footer/intro)
 * and packages/client/modules/README.md.
 *
 * `clean: false` is load-bearing: `dist/` also holds the host tsc output.
 */
export default defineConfig({
  entry: 'src/client/index.tsx',
  platform: 'browser',
  format: 'cjs',
  outDir: 'dist',
  dts: false,
  clean: false,
  sourcemap: false,
  tsconfig: './tsconfig.client.json',
  deps: {
    neverBundle: (specifier: string) => externals.has(specifier),
    alwaysBundle: (specifier: string) => !externals.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: moduleLoaderBanner(CLIENT_MODULE_ID),
    footer: MODULE_LOADER_FOOTER,
    intro: MODULE_LOADER_INTRO,
  },
})
