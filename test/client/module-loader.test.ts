import { describe, expect, it } from 'vitest'

import {
  CLIENT_MODULE_EXTERNALS,
  CLIENT_MODULE_ID,
  MODULE_LOADER_FOOTER,
  MODULE_LOADER_INTRO,
  moduleLoaderBanner,
} from '../../src/client/module-loader.js'

describe('moduleLoaderBanner', () => {
  it('shouldRegisterThePackageIdWithTheOfficialModuleLoaderHandoff', () => {
    expect(moduleLoaderBanner(CLIENT_MODULE_ID)).toBe(
      'window.__ModuleLoader__.load({ id: "dsh-swarmforge", factory: (require) => {',
    )
  })

  it('shouldCloseTheFactoryWithModuleExports', () => {
    expect(MODULE_LOADER_INTRO).toContain('module.exports')
    expect(MODULE_LOADER_FOOTER).toBe('return module.exports; } });')
  })

  it('shouldExternalizeTheShellSeededReactAndCordisSpecifiers', () => {
    expect(CLIENT_MODULE_EXTERNALS).toContain('react')
    expect(CLIENT_MODULE_EXTERNALS).toContain('react/jsx-runtime')
    expect(CLIENT_MODULE_EXTERNALS).toContain('@deepseek-ai/cordis')
  })
})
