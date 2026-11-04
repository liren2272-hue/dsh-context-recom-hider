// Host half of @local/dsh-context-recom-hider.
// The plugin is a pure Client UI decoration (it only owns a stylesheet and a
// DOM observer in the browser), so the Host side is a no-op. The bundle row is
// inserted by cordis.patch.yml.
export function apply() {}
