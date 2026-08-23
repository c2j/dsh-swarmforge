import { defineConfig } from 'tsdown'

/**
 * Client-half bundle for the Swarm panel (`dsh.client`): a self-contained
 * browser artifact registering into the `conversation.view` slot. Bundles
 * React itself (a devDependency only) rather than relying on host-provided
 * externals, since this package builds outside the deepseek-harness
 * monorepo and has no access to its private module-table mapping — see
 * `.sisyphus/plans/m2-findings.md` (M2-b) for the tradeoff.
 *
 * `clean: false` is load-bearing: `dist/` also holds the host build's
 * `index.js`/`index.d.ts` (`tsc -p tsconfig.build.json`), and tsdown's
 * default `clean: true` would delete them.
 */
export default defineConfig({
  entry: 'src/client/index.tsx',
  platform: 'browser',
  format: 'esm',
  outDir: 'dist',
  dts: false,
  clean: false,
  sourcemap: false,
  tsconfig: './tsconfig.client.json',
  outputOptions: {
    entryFileNames: 'client.js',
  },
})
