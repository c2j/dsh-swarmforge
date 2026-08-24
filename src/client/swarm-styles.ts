const STYLE_ID = 'dsh-swarmforge-tab'

const CSS = `
.sf-root { display:flex; flex-direction:column; box-sizing:border-box; height:100%; min-height:0; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:var(--dsw-font-xs-13); }
.sf-empty { display:flex; align-items:center; justify-content:center; height:100%; color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-sm-14); }
.sf-tabs { display:flex; flex:none; align-items:center; gap:2px; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); }
.sf-tab { height:28px; padding:0 10px; border:0; border-radius:6px; color:var(--dsw-alias-label-tertiary); background:transparent; cursor:pointer; font:var(--dsw-font-xs-13); }
.sf-tab:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-hover); }
.sf-tab[aria-pressed="true"] { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-hover); font-weight:600; }
.sf-tab:focus-visible { outline:1px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
.sf-body { flex:1; min-height:0; overflow:auto; padding:16px 16px 24px; }
.sf-alert { margin:0 16px 12px; padding:8px 12px; border-radius:8px; color:var(--dsw-alias-state-error); background:var(--dsw-alias-state-error-bg, color-mix(in srgb, var(--dsw-alias-state-error) 12%, transparent)); font:var(--dsw-font-xxs-12); }
.sf-split { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; align-items:start; }
.sf-section { display:flex; flex-direction:column; gap:10px; min-width:0; }
.sf-h { margin:0; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xs-13); font-weight:600; letter-spacing:.02em; text-transform:uppercase; }
.sf-muted { margin:0; color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xs-13); }
.sf-card { display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }
.sf-title { margin:0; font:var(--dsw-font-sm-14); font-weight:600; }
.sf-meta { margin:0; color:var(--dsw-alias-label-tertiary); font:var(--dsw-font-xxs-12); }
.sf-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.sf-lanes { display:grid; gap:12px; align-items:start; }
.sf-lane { display:flex; flex-direction:column; gap:8px; min-width:0; padding:10px; border-radius:10px; background:var(--dsw-alias-bg-layer-2, color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-1))); }
.sf-count { display:inline-flex; align-items:center; min-width:18px; height:18px; padding:0 6px; border-radius:999px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-interactive-bg-hover); font:var(--dsw-font-xxs-12); }
.sf-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
.sf-field input, .sf-field textarea, .sf-field select { box-sizing:border-box; width:100%; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:7px 10px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; }
.sf-field textarea { min-height:72px; resize:vertical; }
.sf-field input:focus-visible, .sf-field textarea:focus-visible, .sf-field select:focus-visible { outline:1px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
.sf-link { padding:0; border:0; background:none; color:var(--dsw-alias-state-business-primary); cursor:pointer; font:inherit; font-weight:600; text-align:left; }
.sf-link:hover { text-decoration:underline; }
.sf-pre { margin:0; max-height:240px; overflow:auto; padding:10px 12px; border-radius:8px; background:var(--dsw-alias-bg-layer-2, color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)); font:var(--dsw-font-xxs-12); white-space:pre-wrap; }
.sf-stats { display:flex; flex-wrap:wrap; gap:6px; }
.sf-stat { display:inline-flex; align-items:center; height:22px; padding:0 8px; border-radius:999px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-interactive-bg-hover); font:var(--dsw-font-xxs-12); }
.sf-files { margin:0; padding-left:18px; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12); }
`

export function ensureSwarmStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
