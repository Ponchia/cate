<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cate-logo.svg" />
    <img src="assets/cate-logo-light.svg" alt="Cate" width="140" />
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.de.md">Deutsch</a>
</p>

> **Hinweis:** Diese Übersetzung wurde automatisch erstellt und kann Ungenauigkeiten enthalten.

<p align="center">
  Missionskontrolle für Ihre Coding-Agenten: eine unendliche Arbeitsfläche für Terminals, Editoren, Browser und Dokumente.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0-AI-UG/cate?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/0-AI-UG/cate/actions"><img src="https://img.shields.io/github/actions/workflow/status/0-AI-UG/cate/ci.yml?style=flat-square" alt="CI" /></a>
  <a href="https://github.com/0-AI-UG/cate/releases"><img src="https://img.shields.io/github/downloads/0-AI-UG/cate/total?style=flat-square" alt="Downloads" /></a>
</p>

---

<p align="center">
  <img src="assets/demo-canvas.gif" alt="Cate demo" width="900" />
</p>

Cate ist eine Desktop-IDE auf einer unendlichen Arbeitsfläche, gebaut für viele Terminals und Coding-Agenten gleichzeitig. Starten Sie Claude Code, Codex oder einen beliebigen Agenten-CLI in einem Cate-Terminal, und die Arbeitsfläche wird zur Missionskontrolle: Jedes Terminal zeigt, ob sein Agent arbeitet, fertig ist oder auf Sie wartet, und Cate benachrichtigt Sie in dem Moment, in dem einer Ihre Eingabe braucht. Erstellen Sie parallele Git-Worktrees mit einem Klick: Jeder bekommt sein eigenes farbiges Territorium auf der Fläche, sodass fünf Agenten auf fünf Branches fünf klar getrennte Arbeitsstränge bleiben statt eines Stapels von Tabs.

Um diesen Kern herum steht eine vollständige IDE: Monaco-Editoren, eingebettete Browser, Dokumentanzeigen, Git-Werkzeuge und ein integrierter Agent-Chat. Lassen Sie Panels frei auf der Fläche schweben, docken Sie sie als Tabs und Splits an oder lösen Sie sie in eigene Fenster. Cate stellt das gesamte Layout wieder her, wenn Sie den Ordner erneut öffnen.

**Erste Schritte:** Öffnen Sie einen Ordner und er wird zum Arbeitsbereich. Rechtsklick fügt Panels hinzu, `Cmd+K` öffnet die Befehlspalette, Panels aufs Dock ziehen erzeugt Tabs und Splits. Keine Konfigurationsdateien.

## Installation

Laden Sie eine vorgefertigte Version herunter. Bauen Sie für den täglichen Gebrauch nicht aus dem Quellcode.

| Plattform | Formate | Link |
|----------|---------|------|
| macOS | DMG, ZIP (`arm64`, `x64`) | [Neueste Version](https://github.com/0-AI-UG/cate/releases/latest) |
| Windows | NSIS-Installer, ZIP (`x64`) | [Neueste Version](https://github.com/0-AI-UG/cate/releases/latest) |
| Linux | AppImage, DEB, `tar.gz` (`x64`) | [Neueste Version](https://github.com/0-AI-UG/cate/releases/latest) |

## Was drinsteckt

- **Agenten-bewusste Terminals:** Cate erkennt Coding-Agenten (Claude Code, Codex und andere), die in einem beliebigen Terminal laufen. Tabs zeigen den Agentenzustand live: läuft, fertig oder wartet auf Eingabe, mit einer Systembenachrichtigung, wenn ein Agent Sie braucht. Terminals überstehen Neustarts und Fensterwechsel mit intaktem Verlauf, Farben und Vollbild-TUIs.
- **Paralleles Arbeiten:** Beschreiben Sie, woran Sie arbeiten, und Cate erstellt einen Git-Worktree mit eigenem Branch, eigener Farbe und eigenem Territorium auf der Fläche. Checken Sie eine PR direkt in einen Worktree aus, und lassen Sie `.env` oder `node_modules` automatisch in jeden neuen verlinken.
- **Agenten-steuerbarer Browser:** eingebaute Browser-Panels, die Agenten über die `cate`-CLI aus der Shell steuern können: Seiten öffnen, Screenshots aufnehmen, Accessibility-Snapshots lesen, klicken und tippen.
- **Integrierter Agent-Chat:** ein eingebetteter Coding-Agent (Pi) mit Chat-Threads und Modellgedächtnis pro Thread. Verbinden Sie Anthropic, OpenAI Codex, GitHub Copilot, Gemini, OpenRouter, Groq, Mistral, DeepSeek und weitere per OAuth oder API-Key.
- **Arbeitsfläche & Layout:** unendliches Zoomen und Verschieben, Andocken als Tabs und Splits in vier Zonen, ablösbare Fenster, gespeicherte Layouts und Sitzungswiederherstellung über mehrere Projekte.
- **Editoren & Dokumente:** Monaco-Editoren mit Syntaxhervorhebung, Multi-Cursor, Diffs und Markdown-Vorschau; Dokument-Panels für PDFs, DOCX und Bilder.
- **Git:** git-bewusster Dateibaum mit Live-Überwachung, dazu eine Versionsverwaltungs-Seitenleiste für Staging, Branches, Worktrees, Verlauf und Inline-Diffs. Volltextsuche.
- **Remote-Arbeitsbereiche:** Verbinden Sie sich per SSH mit einer Maschine und arbeiten Sie wie in einem lokalen Ordner. Terminals, Agenten und Suche laufen remote über einen leichtgewichtigen Runtime-Daemon.
- **Navigation:** flächenweite Suche über Dateien, Terminal-Verlauf und Panel-Titel; Befehlspalette; Tastaturnavigation von Panel zu Panel.

## Erweiterungen

Cate hat ein Erweiterungssystem für Panels von Drittanbietern (MCP-Server, Diagramme und mehr), jedes in einer eigenen isolierten Webview. Stöbern und bauen Sie im Begleit-Repo: [0-AI-UG/cate-extensions](https://github.com/0-AI-UG/cate-extensions).

## Tastenkürzel

Unten macOS; unter Windows/Linux `Ctrl` statt `Cmd`.

| Panels & Dateien | | Ansicht & Navigation | |
|---|---|---|---|
| Neues Terminal | `Cmd+T` | Befehlspalette | `Cmd+K` |
| Neuer Editor | `Cmd+Shift+E` | Alles durchsuchen | `Cmd+Shift+F` |
| Neuer Browser | `Cmd+Shift+B` | Seitenleiste umschalten | `Cmd+B` |
| Neuer Agent | `Cmd+Shift+A` | Datei-Explorer umschalten | `Cmd+Shift+X` |
| Neue Arbeitsfläche | `Cmd+Shift+C` | Minimap umschalten | `Cmd+Shift+M` |
| Neue Datei | `Cmd+N` | Nächstes / vorheriges Panel | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Datei speichern | `Cmd+S` | Zwischen Panels wechseln | `Cmd+←↑↓→` |
| Panel schließen | `Cmd+W` | Fokussiertes Panel löschen | `Cmd+Backspace` |

| Arbeitsfläche | |
|---|---|
| Hineinzoomen / herauszoomen | `Cmd+=` / `Cmd+-` |
| Zoom zurücksetzen | `Cmd+0` |
| Auf alles / Auswahl zoomen | `Cmd+1` / `Cmd+2` |
| Automatisches Layout | `Cmd+Shift+L` |
| Fläche verschieben | `Shift+←↑↓→` |
| Auswahl-/Hand-Werkzeug umschalten | `Shift+Space` |
| Rückgängig / Wiederholen | `Cmd+Z` / `Cmd+Shift+Z` |

Jedes Tastenkürzel ist in den Einstellungen neu belegbar.

## Aus dem Quellcode bauen

Für Mitwirkende. Andernfalls die Version oben nutzen.

**Voraussetzungen:**
- [Bun](https://bun.sh): Paketmanager und Skript-Runner.
- [Node.js](https://nodejs.org/) 20 oder 22 LTS (siehe `.nvmrc`) im PATH. Die Build-Skripte laufen darunter; der Runtime-Daemon bündelt sein eigenes Node 22.
- **Nur Linux:** `node-pty` liefert vorgebaute Binärdateien für macOS und Windows, aber nicht für Linux, dort wird also aus dem Quellcode kompiliert. Installieren Sie Python 3 und eine C++-Toolchain:
  - Debian/Ubuntu: `sudo apt install build-essential python3`
  - Fedora/RHEL: `sudo dnf install @development-tools gcc-c++ make python3`
  - Arch: `sudo pacman -S base-devel python`

Frischer Klon, ein Befehl richtet alles ein (installiert Abhängigkeiten und baut den lokalen Runtime-Daemon):

```bash
git clone https://github.com/0-AI-UG/cate.git
cd cate
bun run setup
```

Danach:

```bash
bun run dev          # Dev-Server mit Hot Reload
bun run typecheck
bun run test         # Unit-Tests (vitest)
bun run test:e2e     # Playwright-Integrationstests
bun run build        # Produktions-Build
bun run package      # Paketierung für Distribution (:mac, :win, :linux)
```

Die paketierten Binärdateien landen in `release/`. Der Runtime-Daemon wird mit `bun run runtime:tarball` neu gebaut (nach Änderungen unter `src/runtime/` erneut ausführen).

## Architektur

```text
src/
├── agent/      # Eingebetteter Pi-Coding-Agent: Prozessmanager, Auth, Marktplatz, Panel-UI
├── cli/        # Die `cate`-CLI in Cate-Terminals (Browser-Steuerung, Panels, Editor)
├── main/       # Electron-Hauptprozess: IPC, Arbeitsbereiche, Fenster, Updater, Sicherheit
├── preload/    # Kontextisolierte IPC-Brücke
├── renderer/   # React-18-App: Arbeitsfläche, Docking, Panels, Seitenleiste, Stores, Hooks
├── runtime/    # Runtime-Daemon für Remote-Arbeitsbereiche (SSH): Terminals, Agenten, Suche
└── shared/     # IPC-Kanäle und gemeinsame Typen
```

Cate leitet sämtliches IPC über eine kontextisolierte Preload-Brücke. Der Dateisystemzugriff ist auf registrierte Arbeitsbereichs-Wurzeln beschränkt, Browser-Panels deaktivieren die Node-Integration, und Terminals können nicht außerhalb genehmigter Verzeichnisse starten.

**Stack:** Electron 41, React 18, Zustand 5, Monaco 0.52, xterm.js 5.5 + node-pty 1.0, Tailwind 3.4, electron-vite, electron-builder, electron-updater, Sentry. PDFs und DOCX über pdf.js und mammoth, Git über simple-git, Dateiüberwachung über `@parcel/watcher` und chokidar. Der eingebettete Coding-Agent basiert auf `@earendil-works/pi` und wird als On-Demand-Runtime mit der App ausgeliefert.

## Mitwirken

Siehe [CONTRIBUTING.md](CONTRIBUTING.md). Die Historie Version für Version steht im [CHANGELOG](CHANGELOG.md).

## Star-Verlauf

<a href="https://www.star-history.com/?repos=0-AI-UG%2Fcate&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&theme=dark&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
 </picture>
</a>

## Lizenz

[MIT](LICENSE)
