<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/cate-logo.svg" />
    <img src="assets/cate-logo-light.svg" alt="Cate" width="140" />
  </picture>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.de.md">Deutsch</a>
</p>

> **Note :** Cette traduction a été générée automatiquement et peut contenir des inexactitudes.

<p align="center">
  Le centre de contrôle de vos agents de code : un canevas infini pour vos terminaux, éditeurs, navigateurs et documents.
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

Cate est un IDE de bureau construit sur un canevas infini, conçu pour faire tourner de nombreux terminaux et agents de code à la fois. Lancez Claude Code, Codex ou n'importe quel agent CLI dans un terminal Cate et le canevas devient votre centre de contrôle : chaque terminal indique si son agent travaille, a terminé ou attend votre réponse, et Cate envoie une notification dès que l'un d'eux a besoin de vous. Créez des worktrees git parallèles en un clic : chacun reçoit son propre territoire coloré sur le canevas, si bien que cinq agents sur cinq branches restent cinq flux de travail bien distincts au lieu d'une pile d'onglets.

Autour de ce cœur, un IDE complet : éditeurs Monaco, navigateurs intégrés, visionneuses de documents, outils git et un chat d'agent intégré. Faites flotter les panneaux n'importe où sur le canevas, ancrez-les en onglets et divisions, ou détachez-les dans leurs propres fenêtres. Cate restaure toute la disposition à la réouverture du dossier.

**Démarrage :** ouvrez un dossier et il devient un espace de travail. Cliquez droit pour ajouter des panneaux, appuyez sur `Cmd+K` pour la palette de commandes, glissez des panneaux sur le dock pour créer onglets et divisions. Aucun fichier de configuration.

## Installation

Téléchargez une version précompilée. Ne compilez pas depuis les sources pour un usage quotidien.

| Plateforme | Formats | Lien |
|----------|---------|------|
| macOS | DMG, ZIP (`arm64`, `x64`) | [Dernière version](https://github.com/0-AI-UG/cate/releases/latest) |
| Windows | Installeur NSIS, ZIP (`x64`) | [Dernière version](https://github.com/0-AI-UG/cate/releases/latest) |
| Linux | AppImage, DEB, `tar.gz` (`x64`) | [Dernière version](https://github.com/0-AI-UG/cate/releases/latest) |

## Ce qu'il contient

- **Terminaux conscients des agents :** Cate détecte les agents de code (Claude Code, Codex et d'autres) qui tournent dans n'importe quel terminal. Les onglets affichent l'état de l'agent en direct : en cours, terminé ou en attente d'une réponse, avec une notification système quand un agent a besoin de vous. Les terminaux survivent aux redémarrages et aux déplacements de fenêtre avec leur historique, leurs couleurs et leurs TUI plein écran intacts.
- **Travail parallèle :** décrivez ce sur quoi vous travaillez et Cate crée un worktree git avec sa propre branche, sa couleur et son territoire sur le canevas. Récupérez une PR directement dans un worktree, et liez automatiquement `.env` ou `node_modules` dans chaque nouveau worktree.
- **Navigateur pilotable par agent :** des panneaux navigateur intégrés que les agents peuvent contrôler depuis le shell via la CLI `cate` : ouvrir des pages, prendre des captures d'écran, lire des instantanés d'accessibilité, cliquer et saisir du texte.
- **Chat d'agent intégré :** un agent de code embarqué (Pi) avec fils de discussion et mémoire de modèle par fil. Connectez Anthropic, OpenAI Codex, GitHub Copilot, Gemini, OpenRouter, Groq, Mistral, DeepSeek et d'autres via OAuth ou clé API.
- **Canevas et disposition :** zoom et déplacement infinis, ancrage en onglets et divisions sur quatre zones, fenêtres détachables, dispositions enregistrées et restauration de session multi-projets.
- **Éditeurs et documents :** éditeurs Monaco avec coloration syntaxique, multi-curseur, diffs et aperçu Markdown ; panneaux de document pour PDF, DOCX et images.
- **Git :** arborescence de fichiers consciente de git avec suivi en direct, plus une barre latérale de contrôle de source pour l'index, les branches, les worktrees, l'historique et les diffs en ligne. Recherche plein texte.
- **Espaces de travail distants :** connectez-vous à une machine via SSH et travaillez comme sur un dossier local. Terminaux, agents et recherche s'exécutent à distance via un démon runtime léger.
- **Navigation :** recherche sur tout le canevas dans les fichiers, l'historique des terminaux et les titres de panneaux ; palette de commandes ; navigation clavier de panneau en panneau.

## Extensions

Cate dispose d'un système d'extensions pour panneaux tiers (serveurs MCP, diagrammes et plus), chacun servi dans sa propre webview isolée. Parcourez-les et créez-les dans le dépôt compagnon : [0-AI-UG/cate-extensions](https://github.com/0-AI-UG/cate-extensions).

## Raccourcis clavier

macOS ci-dessous ; sous Windows/Linux, utilisez `Ctrl` à la place de `Cmd`.

| Panneaux & fichiers | | Vue & navigation | |
|---|---|---|---|
| Nouveau terminal | `Cmd+T` | Palette de commandes | `Cmd+K` |
| Nouvel éditeur | `Cmd+Shift+E` | Tout rechercher | `Cmd+Shift+F` |
| Nouveau navigateur | `Cmd+Shift+B` | Afficher/masquer la barre latérale | `Cmd+B` |
| Nouvel agent | `Cmd+Shift+A` | Afficher/masquer l'explorateur | `Cmd+Shift+X` |
| Nouveau canevas | `Cmd+Shift+C` | Afficher/masquer la minimap | `Cmd+Shift+M` |
| Nouveau fichier | `Cmd+N` | Panneau suivant / précédent | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Enregistrer le fichier | `Cmd+S` | Se déplacer entre les panneaux | `Cmd+←↑↓→` |
| Fermer le panneau | `Cmd+W` | Supprimer le panneau actif | `Cmd+Backspace` |

| Canevas | |
|---|---|
| Zoom avant / arrière | `Cmd+=` / `Cmd+-` |
| Réinitialiser le zoom | `Cmd+0` |
| Zoom global / sur la sélection | `Cmd+1` / `Cmd+2` |
| Disposition automatique du canevas | `Cmd+Shift+L` |
| Déplacer le canevas | `Shift+←↑↓→` |
| Basculer outil sélection / main | `Shift+Space` |
| Annuler / rétablir | `Cmd+Z` / `Cmd+Shift+Z` |

Chaque raccourci est reconfigurable dans les Réglages.

## Compiler depuis les sources

Pour les contributeurs. Sinon, utilisez la version ci-dessus.

**Prérequis :**
- [Bun](https://bun.sh) : gestionnaire de paquets et lanceur de scripts.
- [Node.js](https://nodejs.org/) 20 ou 22 LTS (voir `.nvmrc`) sur votre PATH. Les scripts de build s'exécutent avec ; le démon runtime embarque son propre Node 22.
- **Linux uniquement :** `node-pty` fournit des binaires précompilés pour macOS et Windows, mais pas pour Linux, donc il compile depuis les sources. Installez Python 3 et une chaîne d'outils C++ :
  - Debian/Ubuntu : `sudo apt install build-essential python3`
  - Fedora/RHEL : `sudo dnf install @development-tools gcc-c++ make python3`
  - Arch : `sudo pacman -S base-devel python`

Clone frais, une seule commande installe tout (dépendances et démon runtime local) :

```bash
git clone https://github.com/0-AI-UG/cate.git
cd cate
bun run setup
```

Puis :

```bash
bun run dev          # serveur de dev avec rechargement à chaud
bun run typecheck
bun run test         # tests unitaires (vitest)
bun run test:e2e     # tests d'intégration Playwright
bun run build        # build de production
bun run package      # packaging pour distribution (:mac, :win, :linux)
```

Les binaires packagés se retrouvent dans `release/`. Le démon runtime se reconstruit avec `bun run runtime:tarball` (à relancer après toute modification sous `src/runtime/`).

## Architecture

```text
src/
├── agent/      # Agent de code Pi intégré : gestionnaire de processus, auth, marketplace, UI du panneau
├── cli/        # La CLI `cate` disponible dans les terminaux Cate (contrôle du navigateur, panneaux, éditeur)
├── main/       # Processus principal Electron : IPC, espaces de travail, fenêtres, updater, sécurité
├── preload/    # Pont IPC à isolation de contexte
├── renderer/   # App React 18 : canevas, docking, panneaux, barre latérale, stores, hooks
├── runtime/    # Démon runtime pour les espaces de travail distants (SSH) : terminaux, agents, recherche
└── shared/     # Canaux IPC et types partagés
```

Cate fait passer toute l'IPC par un pont preload à isolation de contexte. L'accès au système de fichiers est limité aux racines d'espace de travail enregistrées, les panneaux navigateur désactivent l'intégration Node, et les terminaux ne peuvent pas s'ouvrir hors des répertoires approuvés.

**Stack :** Electron 41, React 18, Zustand 5, Monaco 0.52, xterm.js 5.5 + node-pty 1.0, Tailwind 3.4, electron-vite, electron-builder, electron-updater, Sentry. PDF et DOCX via pdf.js et mammoth, git via simple-git, surveillance des fichiers via `@parcel/watcher` et chokidar. L'agent de code intégré repose sur `@earendil-works/pi`, livré comme runtime à la demande avec l'application.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). L'historique version par version se trouve dans le [CHANGELOG](CHANGELOG.md).

## Historique des étoiles

<a href="https://www.star-history.com/?repos=0-AI-UG%2Fcate&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&theme=dark&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=0-AI-UG/cate&type=date&legend=top-left&sealed_token=LE-sv5TdJtUmugufglkRue9ZJ6mVXcScJNurvXl9qwGAOHy-taiZA7-UfpBCAHbsxUZESm-1aSxX55u3DTth--kCTUty5gqe7XMhmI-dHz2IOkizZgAk26fW8iovuRbeMSyla3c2T9w9fAj6x2_SZZEGbmvonWJvvLcI-X35nHZFkQQIn_ueBO07uQZM" />
 </picture>
</a>

## Licence

[MIT](LICENSE)
