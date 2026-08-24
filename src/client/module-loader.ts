export const CLIENT_MODULE_ID = 'dsh-swarmforge'

/** Shell-seeded `require()` keys (harness platform.ts). Anything else must be inlined. */
export const CLIENT_MODULE_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

export function moduleLoaderBanner(id: string): string {
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`
}

export const MODULE_LOADER_INTRO = 'var module = { exports: {} }; var exports = module.exports;'

export const MODULE_LOADER_FOOTER = 'return module.exports; } });'
