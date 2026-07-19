// Spinner classification for the FALLBACK agents (cursor/agy) — the ones with
// no usable hook coverage (cursor print mode and `agy -p` emit no turn events).
// Hook-covered agents (claude/codex/pi/opencode) get their running state from
// the agent-hook event stream and never consult these classifiers (the
// coordinator drops spinner inputs for them).
//
// The dominant convention — most Ink/Rust TUIs that use the cli-spinners
// "dots" set — animates a Unicode braille glyph as the first character of the
// OSC window title while a turn is in flight, and shows a static marker when
// idle. So: a leading braille-pattern glyph means "running"; anything else (or
// no title) means "idle / awaiting input".

const BRAILLE_PATTERN_START = 0x2800
const BRAILLE_PATTERN_END = 0x28ff

export function titleIndicatesRunning(titleSegment: string): boolean {
  const s = titleSegment.replace(/^\s+/, '')
  if (!s) return false
  const cp = s.codePointAt(0)
  return cp != null && cp >= BRAILLE_PATTERN_START && cp <= BRAILLE_PATTERN_END
}

// Some agents keep a static OSC title and instead animate their braille
// spinner in the terminal BODY. Detect a braille glyph anywhere in a PTY
// output chunk, AFTER stripping OSC sequences so a title spinner isn't counted
// here — those are handled by titleIndicatesRunning on the parsed title and
// must stay purely title-driven.
const OSC_SEQUENCE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
const BODY_SPINNER_GLYPH = /[⠀-⣿]/

export function outputShowsBodySpinner(chunk: string): boolean {
  return BODY_SPINNER_GLYPH.test(chunk.replace(OSC_SEQUENCE, ''))
}
