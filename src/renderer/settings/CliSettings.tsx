import { useSettingsStore } from '../stores/settingsStore'
import { SettingRow, Toggle } from './SettingsComponents'

export function CliSettings() {
  const store = useSettingsStore()

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted mb-3">
        The `cate` command lets agents and tools running in your terminals drive
        Cate itself. The first toggle is the master switch; the ones below allow
        individual features.
      </p>
      <SettingRow
        label="Command-line control (cate CLI)"
        description="Master switch. On puts a loopback endpoint and token in the env of every process in your terminals, so any of them can call the features enabled below. Off: the endpoint is never created; `cate` stays on PATH and explains how to re-enable it. New terminals pick up a change."
      >
        <Toggle
          checked={store.cliEnabled}
          onChange={(v) => store.setSetting('cliEnabled', v)}
        />
      </SettingRow>
      <SettingRow
        label="Browser control"
        description="`cate browser ...` — open URLs, click, type, screenshot and snapshot pages in the built-in browser panel, which acts on your live logged-in sessions."
      >
        <Toggle
          checked={store.cliBrowserControlEnabled}
          onChange={(v) => store.setSetting('cliBrowserControlEnabled', v)}
        />
      </SettingRow>
      <SettingRow
        label="Terminal read"
        description="`cate terminal read` — read the rendered screen and scrollback of terminal panels, which may contain secrets printed there."
      >
        <Toggle
          checked={store.cliTerminalReadEnabled}
          onChange={(v) => store.setSetting('cliTerminalReadEnabled', v)}
        />
      </SettingRow>
      <SettingRow
        label="Terminal input"
        description="`cate terminal type` / `press` — send keystrokes to terminal panels; input goes to whatever runs in the targeted terminal. Off by default: this lets a CLI caller run commands in your shells."
      >
        <Toggle
          checked={store.cliTerminalInputEnabled}
          onChange={(v) => store.setSetting('cliTerminalInputEnabled', v)}
        />
      </SettingRow>
      <SettingRow
        label="Install cate CLI skill"
        description="Auto-install the cate-cli skill into each workspace so agents learn the `cate` command: Cate's agent always, plus Claude Code, Pi, OpenCode, Codex and Antigravity where their folder exists. Installs once, never overwrites edits; uninstalls stick. Off stops future installs."
      >
        <Toggle
          checked={store.cliSkillInstallEnabled}
          onChange={(v) => store.setSetting('cliSkillInstallEnabled', v)}
        />
      </SettingRow>
    </div>
  )
}
