# OpenClaw Control UI — Audit UX/UI & Proposition V2

> **Date** : 2026-02-06
> **Auteur** : Audit automatisé (Cascade)
> **Périmètre** : Dashboard complet `http://127.0.0.1:18789` — 13 pages analysées
> **Références** : ChatGPT (GPT-5.2), Google Gemini (3 Pro), Claude (Opus 4.5), best practices UX/UI 2025-2026

---

## Table des matières

1. [Inventaire fonctionnel de l'existant (V1)](#1-inventaire-fonctionnel-de-lexistant-v1)
2. [Audit UX/UI détaillé](#2-audit-uxui-détaillé)
3. [Benchmark concurrentiel (ChatGPT / Gemini / Claude)](#3-benchmark-concurrentiel)
4. [Best practices 2026 applicables](#4-best-practices-2026-applicables)
5. [Proposition V2 — Dashboard](#5-proposition-v2--dashboard)
6. [Proposition V2 — Chat (focus principal)](#6-proposition-v2--chat-focus-principal)
7. [Priorités d'implémentation](#7-priorités-dimplémentation)

---

## 1. Inventaire fonctionnel de l'existant (V1)

### 1.1 Structure de navigation (sidebar)

| Section | Pages | Description |
|---------|-------|-------------|
| **Chat** | Chat | Session de chat directe avec l'agent |
| **Control** | Overview, Channels, Instances, Sessions, Usage, Cron Jobs | Monitoring et gestion gateway |
| **Agent** | Agents, Skills, Nodes | Configuration des agents, compétences, devices |
| **Settings** | Config, Debug, Logs | Configuration JSON, snapshots, logs live |
| **Resources** | Docs (lien externe) | Lien vers docs.openclaw.ai |

### 1.2 Fonctionnalités du Chat (V1)

| Fonctionnalité | Présent | Détail |
|----------------|---------|--------|
| Envoi de message texte | ✅ | Textarea + bouton Send (↵) |
| Nouvelle session | ✅ | Bouton "New session" |
| Sélecteur de session | ✅ | Combobox `agent:main:main` |
| Copie markdown | ✅ | Bouton par message assistant |
| Toggle thinking/working | ✅ | Affiche/masque le raisonnement |
| Mode focus | ✅ | Cache sidebar + header |
| Refresh chat data | ✅ | Recharge les données |
| Coller des images | ✅ | Mention dans le placeholder |
| **Édition de messages** | ❌ | Absent |
| **Attachement de fichiers** | ❌ | Pas de bouton d'upload |
| **Sélection de modèle** | ❌ | Uniquement via page Agents |
| **Sélection de skills** | ❌ | Uniquement via page Skills |
| **TTS (Text-to-Speech)** | ❌ | Absent de l'UI web |
| **STT (Speech-to-Text)** | ❌ | Pas de micro |
| **Historique conversations** | ❌ | Pas de sidebar de conversations |
| **Sessions multiples côte à côte** | ❌ | Une seule session visible |
| **Recherche dans l'historique** | ❌ | Absent |
| **Réactions/feedback** | ❌ | Pas de thumbs up/down |
| **Streaming visible** | ❌ | Le message apparaît d'un bloc |
| **Markdown rendu** | ⚠️ | Texte brut, pas de rendu riche |
| **Syntaxe code colorée** | ❌ | Pas de coloration syntaxique |
| **Indicateur de frappe** | ❌ | Pas de "typing…" |
| **Drag & drop fichiers** | ❌ | Absent |
| **Raccourcis clavier** | ⚠️ | Uniquement ↵ pour envoyer |

### 1.3 Pages Control & Settings — Résumé

- **Overview** : Snapshot gateway (status, uptime, instances, sessions, cron). Layout en cartes. Bien structuré.
- **Channels** : 8 canaux (WhatsApp, Telegram, Discord, Google Chat, Slack, Signal, iMessage, Nostr). Cartes avec statuts + actions (QR, Relink, Probe). Config schema manquant.
- **Instances** : Liste des beacons connectés avec tags (gateway, webchat, operator). Visuellement clair.
- **Sessions** : Tableau avec clé, label, kind, tokens, thinking, verbose, reasoning. Fonctionnel mais dense.
- **Usage** : Filtres date, tokens/cost toggle, graphiques Activity by Time + Daily Usage + Sessions. Complet mais vide au premier lancement.
- **Cron Jobs** : Formulaire de création + liste des jobs + run history. Bien organisé.
- **Agents** : Liste agents, onglets (Overview, Files, Tools, Skills, Channels, Cron Jobs). Riche.
- **Skills** : Liste filtrée, 50 skills built-in. Minimaliste.
- **Nodes** : Exec approvals, node binding, devices paired, tokens. Dense et technique.
- **Config** : Éditeur de configuration complet avec sidebar de sections (~35 catégories). Form + Raw mode. Très riche.
- **Debug** : Snapshots JSON (Status, Health, Heartbeat), Manual RPC, Models catalog, Events log. Technique.
- **Logs** : Live tail JSONL avec filtres par niveau (trace→fatal), auto-follow, export. Fonctionnel.

---

## 2. Audit UX/UI détaillé

### 2.1 Charte graphique

| Aspect | Constat | Sévérité |
|--------|---------|----------|
| **Palette** | Dark theme dominant (#1a1a2e approx.), rouge coral (#e74c4c) comme accent principal | ⚠️ Le rouge est utilisé à la fois pour les actions destructives ET les actions primaires (Save, Send, Show QR) — confusion sémantique |
| **Typographie** | Police monospace/system, lisible, mais pas de hiérarchie claire entre titres et contenu | ⚠️ |
| **Spacing** | Inconsistant : certaines cartes sont serrées (Channels), d'autres spacieuses (Overview) | ⚠️ |
| **Icônes** | Minimalistes, petites, parfois absentes des boutons (Send, New session = texte seul) | 🔴 |
| **Branding** | Logo 🦞 + "OPENCLAW / GATEWAY DASHBOARD" dans le header — correct | ✅ |
| **Themes** | System / Light / Dark — bonne pratique | ✅ |

### 2.2 Navigation

| Aspect | Constat | Sévérité |
|--------|---------|----------|
| **Sidebar** | Collapsible, sections groupées avec +/− | ✅ |
| **Active state** | Item sélectionné = fond rouge coral + texte blanc | ⚠️ Rouge pour l'état actif est inhabituel (confusion avec erreur) |
| **Breadcrumbs** | Absents — on ne sait pas toujours où on est dans la hiérarchie | 🔴 |
| **Health indicator** | "Health OK" en haut à droite — bonne pratique | ✅ |
| **Responsive** | Le sidebar est collapsible, mais pas de breakpoints mobiles observés | ⚠️ |

### 2.3 Chat — Problèmes critiques

| Problème | Impact | Sévérité |
|----------|--------|----------|
| **Pas d'historique de conversations** | L'utilisateur ne peut pas revenir à d'anciennes conversations | 🔴 Critique |
| **Pas de streaming** | Le message assistant apparaît d'un bloc → impression de lenteur | 🔴 Critique |
| **Pas de rendu Markdown** | Les réponses code/listes/gras sont en texte brut | 🔴 Critique |
| **Pas d'upload de fichiers** | Impossible d'envoyer documents, images (sauf coller) | 🔴 |
| **Pas d'édition de message** | On ne peut pas corriger un message envoyé | 🔴 |
| **Pas de sélecteur de modèle** | Il faut aller dans Agents pour changer de modèle | 🔴 |
| **Message système visible** | Le prompt système (/new /reset) est affiché tel quel comme message "You" — confus | 🔴 |
| **Pas d'indicateur de frappe** | Aucun feedback pendant que l'agent travaille | 🔴 |
| **Textarea trop petite** | Pas d'auto-resize, difficile pour les longs messages | ⚠️ |
| **Pas de TTS/STT** | Aucune interaction vocale | ⚠️ |
| **Couleur du bouton Send** | Rouge = destructif en convention UX. Devrait être bleu/vert/brand | ⚠️ |

### 2.4 Pages Control — Problèmes notables

| Problème | Page | Sévérité |
|----------|------|----------|
| **Tokens gateway exposés en clair** | Overview | 🔴 Sécurité : le token gateway est visible sans masquage |
| **"Channel config schema unavailable"** | Channels | ⚠️ Message d'erreur sans action corrective |
| **JSON brut non formaté** | Debug, Channel health | ⚠️ Les blobs JSON sont difficilement lisibles |
| **Logs avec codes ANSI** | Logs | ⚠️ Les logs affichent `[93m⇄[39m` au lieu de couleurs ANSI rendues |
| **Tables débordantes** | Sessions | ⚠️ La table déborde horizontalement sans scroll |
| **Pas de confirmation pour Delete** | Sessions | 🔴 Le bouton Delete n'a pas de modal de confirmation |

---

## 3. Benchmark concurrentiel

### 3.1 Tableau comparatif — Fonctionnalités Chat

| Fonctionnalité | ChatGPT (GPT-5.2) | Gemini (3 Pro) | Claude (Opus 4.5) | **OpenClaw V1** |
|----------------|-------------------|----------------|-------------------|-----------------|
| Streaming réponse | ✅ Token par token | ✅ | ✅ | ❌ |
| Rendu Markdown riche | ✅ Code, tables, LaTeX | ✅ | ✅ | ❌ |
| Coloration syntaxique | ✅ | ✅ | ✅ | ❌ |
| Éditer un message envoyé | ✅ | ✅ | ✅ | ❌ |
| Régénérer une réponse | ✅ | ✅ (variantes) | ✅ | ❌ |
| Upload fichiers (images, PDF, CSV) | ✅ Drag & drop | ✅ | ✅ | ❌ (coller images seulement) |
| Sélecteur de modèle inline | ✅ (GPT-5, 4o, o3…) | ✅ (Pro, Flash) | ✅ (Opus, Sonnet) | ❌ |
| Historique conversations (sidebar) | ✅ Infini, recherchable | ✅ Sync cross-device | ✅ Projects | ❌ |
| Recherche dans l'historique | ✅ | ✅ | ✅ | ❌ |
| TTS (lecture vocale) | ✅ Voix naturelles | ✅ Personas vocales | ✅ | ❌ |
| STT (entrée vocale) | ✅ | ✅ "Hey Google" | ✅ Mobile | ❌ |
| Feedback (thumbs up/down) | ✅ | ✅ | ✅ | ❌ |
| Indicateur "typing…" | ✅ Avec animation | ✅ | ✅ Avec thinking | ❌ |
| Mode Agent/Tasks | ✅ Operator, Tasks | ✅ Deep Research | ✅ Projects | ⚠️ (via CLI/skills) |
| Sélection de skills/plugins | ✅ GPTs, Apps | ✅ Gems | ✅ Projects | ❌ (dans UI web) |
| Multi-conversation simultanée | ✅ Onglets/fenêtres | ✅ | ✅ | ❌ |
| Custom instructions | ✅ Global | ✅ Memory | ✅ Par Project | ⚠️ (via Config) |
| Copier comme Markdown | ✅ | ✅ | ✅ | ✅ |
| Mode focus/zen | ❌ | ❌ | ❌ | ✅ |
| Dark mode | ✅ | ✅ | ✅ | ✅ |
| Thinking/reasoning visible | ✅ (o3, o4) | ✅ Deep Think | ✅ Extended thinking | ✅ |

### 3.2 Points forts d'OpenClaw V1 (à conserver)

- **Mode focus** : unique, masque sidebar + header — ChatGPT/Gemini n'ont pas ça
- **Toggle thinking/working** : bonne transparence
- **Dashboard intégré** : ChatGPT/Gemini n'ont pas de dashboard admin aussi complet
- **Multi-channel** : 8+ canaux messaging gérés depuis une seule UI — unique
- **Skills système** : 50 skills built-in accessibles
- **Cron Jobs** : scheduler intégré — absents chez les concurrents grand public
- **Config éditeur** : ~35 sections éditables en UI — très puissant

---

## 4. Best practices 2026 applicables

Sources : letsgroto.com, intuitionlabs.ai, uilayouts.com, sendbird.com, eleken.co

### 4.1 Chat / Conversational UI

1. **Simplifier la première interaction** : ouvrir avec un prompt clair + boutons de suggestion, pas un message système brut
2. **Feedback loops** : thumbs up/down + "Was this helpful?" sur chaque réponse
3. **Penser en conversation, pas en écrans** : rythme, acknowledgment, pacing — ajouter des indicateurs de frappe et du streaming
4. **Design pour les interruptions** : permettre de reprendre une conversation, persister le contexte, afficher où on en est
5. **Toujours fournir une sortie** : "Talk to human", "Back to menu", "Restart" toujours visibles
6. **Show, don't tell** : images, progress bars, icônes dans les réponses plutôt que du texte seul
7. **Rendu riche** : Markdown, code coloré, tables, LaTeX sont des standards en 2026

### 4.2 Dashboard / Admin UI

1. **Couleurs sémantiques** : rouge = destructif/erreur, vert = succès, bleu = primaire, orange = warning
2. **Consistance des composants** : boutons, badges de statut, cartes — même style partout
3. **Navigation contextuelle** : breadcrumbs, fil d'Ariane, indication claire de la page active
4. **Données sensibles masquées** : tokens, mots de passe masqués par défaut avec toggle "show"
5. **Confirmation des actions destructives** : modal de confirmation avant delete/logout
6. **Empty states informatifs** : pas juste "No data" mais un call-to-action pour remplir
7. **Responsive design** : breakpoints pour tablette et mobile

---

## 5. Proposition V2 — Dashboard

### 5.1 Charte graphique révisée

```
Palette V2 :
├── Background      : #0f0f1a (dark primary)
├── Surface         : #1a1a2e (cards)
├── Surface-hover   : #252540
├── Border          : #2a2a45
├── Text primary    : #e8e8f0
├── Text secondary  : #8888a0
├── Brand/Accent    : #3b82f6 (bleu vif — remplace le rouge pour les actions primaires)
├── Success         : #22c55e (vert)
├── Warning         : #f59e0b (orange)
├── Error/Danger    : #ef4444 (rouge — UNIQUEMENT pour erreurs et actions destructives)
├── Info            : #06b6d4 (cyan)
└── Coral (legacy)  : #e74c4c → réservé au branding 🦞 uniquement
```

**Pourquoi** : Le rouge coral actuel est utilisé pour Send, Save, active state ET Delete. C'est une violation des conventions UX. Le bleu vif (#3b82f6) comme couleur primaire est le standard 2026 (ChatGPT, Claude, Linear, Vercel).

### 5.2 Typographie

| Élément | V1 | V2 |
|---------|----|----|
| Titres de page | System font, gras | Inter/Geist Bold, 24px |
| Sous-titres | System font, normal | Inter/Geist Medium, 14px, text-secondary |
| Corps | System font | Inter/Geist Regular, 14px |
| Code / Monospace | System mono | JetBrains Mono / Fira Code, 13px |
| Badges/Tags | Inline text | Pill badges avec padding, border-radius 9999px |

### 5.3 Navigation révisée

```
SIDEBAR V2 :
┌─────────────────────────┐
│ 🦞 OpenClaw             │ ← Logo + nom
│ Gateway Dashboard       │ ← Sous-titre
│ ● Health OK    v2026.2  │ ← Status + version
├─────────────────────────┤
│ 💬 Chat                 │ ← Entrée principale
│   ├─ Conversations      │ ← NOUVEAU : liste des conversations
│   └─ New Chat           │ ← NOUVEAU : raccourci
├─────────────────────────┤
│ 📊 Control              │
│   ├─ Overview           │
│   ├─ Channels           │
│   ├─ Sessions           │
│   └─ Usage              │
├─────────────────────────┤
│ 🤖 Agent                │
│   ├─ Agents             │
│   ├─ Skills             │
│   └─ Nodes              │
├─────────────────────────┤
│ ⚙️ Settings              │
│   ├─ Config             │
│   └─ Logs               │
├─────────────────────────┤
│ 📖 Docs ↗               │
├─────────────────────────┤
│ 🔧 Debug (collapsé)     │ ← Moins visible, réservé aux devs
│   ├─ Instances          │
│   ├─ Cron Jobs          │
│   └─ Snapshots          │
└─────────────────────────┘
```

**Changements** :
- **Conversations** en sous-item du Chat (au lieu d'une seule session)
- **Instances** et **Cron Jobs** déplacés dans un groupe "Debug/Advanced" — peu utilisés au quotidien
- **Health + version** dans le sidebar, pas juste dans le header
- **Icônes** sur chaque section pour le repérage visuel

### 5.4 Améliorations transversales

| Amélioration | Détail |
|-------------|--------|
| **Breadcrumbs** | `Chat > agent:main:main` ou `Settings > Config > Gateway` |
| **Toasts/notifications** | Feedback visuel pour Save, Delete, Reload (au lieu de rien) |
| **Modales de confirmation** | Avant toute action destructive (Delete session, Logout channel, Revoke token) |
| **Masquage des secrets** | Tokens/passwords masqués par défaut, bouton 👁 pour révéler |
| **Empty states** | Illustrations + CTA explicite ("No channels configured. Set up your first channel →") |
| **Logs ANSI rendering** | Parser et rendre les codes ANSI comme couleurs CSS |
| **JSON viewer** | Collapsible, syntax highlighted, copie en un clic |
| **Responsive** | Grid responsive pour les cartes (Channels, Overview) |
| **Keyboard shortcuts** | `Ctrl+K` command palette, `Ctrl+N` new chat, `Ctrl+/` focus search |

---

## 6. Proposition V2 — Chat (focus principal)

### 6.1 Layout restructuré

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER BAR                                                    │
│ ┌─ 🦞 OpenClaw ──── [Model: gpt-5.2 ▾] ── [Skills ▾] ──── │
│ │                    [🔊 TTS] [🎤 STT] [⚙️] [⛶ Focus]      │
│ └─────────────────────────────────────────────────────────── │
├──────────────┬───────────────────────────────────────────────┤
│ CONVERSATIONS│ CHAT AREA                                      │
│              │                                                │
│ 🔍 Search    │  ┌─ System ──────────────────────────────┐    │
│              │  │ Session started. Model: gpt-5.2       │    │
│ ── Today ──  │  └───────────────────────────────────────┘    │
│ 📝 Chat #1   │                                                │
│ 📝 Chat #2   │  ┌─ Assistant ──────────── 19:10 ── 📋 👍 👎│  │
│              │  │ Hey — I'm online and ready. What do    │    │
│ ── Yesterday │  │ you want to do today?                  │    │
│ 📝 Old chat  │  │                                        │    │
│              │  │ **Suggestions:**                        │    │
│              │  │ [📝 Write code] [📋 Plan] [📊 Analyze] │    │
│              │  └───────────────────────────────────────┘    │
│              │                                                │
│              │  ┌─ You ──────────────── 19:11 ── ✏️ 🗑️ ─┐  │
│              │  │ Help me write a Python script           │    │
│              │  └───────────────────────────────────────┘    │
│              │                                                │
│              │  ┌─ Assistant ────────── 19:11 ── 📋 👍 👎│  │
│              │  │ ```python                               │    │
│              │  │ def hello():                            │    │
│              │  │     print("Hello!")                     │    │
│              │  │ ```                                     │    │
│              │  │ [▶ Copy] [📄 Insert in editor]          │    │
│              │  └───────────────────────────────────────┘    │
│              │                                                │
├──────────────┼───────────────────────────────────────────────┤
│              │ INPUT AREA                                      │
│              │ ┌─────────────────────────────────────────────┐│
│              │ │ 📎 Message... (↵ send, Shift+↵ newline)     ││
│              │ │                                   [🎤] [➤] ││
│              │ └─────────────────────────────────────────────┘│
│              │ Drag & drop files here                         │
└──────────────┴───────────────────────────────────────────────┘
```

### 6.2 Nouvelles fonctionnalités Chat V2

#### 6.2.1 Streaming des réponses
- **Token par token** : afficher chaque token au fur et à mesure qu'il arrive
- **Curseur clignotant** pendant la génération
- **Bouton "Stop generating"** pour interrompre
- **Indicateur "Agent is thinking…"** avec animation de dots

#### 6.2.2 Rendu Markdown complet
- **Titres, gras, italique, listes** rendus en HTML
- **Blocs de code** avec coloration syntaxique (highlight.js / Shiki)
- **Bouton "Copy code"** sur chaque bloc
- **Tables** rendues en HTML
- **LaTeX** rendu (optionnel, via KaTeX)
- **Liens cliquables**

#### 6.2.3 Historique des conversations (sidebar gauche)
- Liste des conversations passées, groupées par date (Today, Yesterday, Last 7 days…)
- **Recherche** dans les conversations (fulltext)
- **Renommer** une conversation (inline edit)
- **Supprimer** une conversation (avec confirmation)
- **Épingler** une conversation en haut
- Persistance côté gateway (sessions.json existe déjà)

#### 6.2.4 Édition de messages
- **Bouton ✏️ (Edit)** au survol d'un message utilisateur
- Ouvre un mode édition inline → re-soumet le message modifié
- L'ancienne réponse est remplacée (ou conservée en fold)

#### 6.2.5 Régénérer une réponse
- **Bouton 🔄 (Regenerate)** sur le dernier message assistant
- Régénère avec le même contexte
- Option de voir les réponses alternatives (comme Gemini "View other drafts")

#### 6.2.6 Upload de fichiers
- **Bouton 📎 (Attach)** dans la barre d'input
- **Drag & drop** sur la zone de chat
- Types supportés : images (PNG, JPG, GIF, WebP), PDF, CSV, TXT, code files
- Aperçu des fichiers attachés avant envoi (thumbnails)
- Intégration avec le système de médias d'OpenClaw (sharp, pdfjs-dist déjà en deps)

#### 6.2.7 Sélecteur de modèle inline
- **Dropdown dans le header du chat** : `[gpt-5.2 ▾]`
- Liste tous les modèles du catalogue (models.list est déjà dans l'API)
- Groupés par provider (OpenAI, Anthropic, Amazon Bedrock…)
- Le modèle sélectionné est appliqué à la session en cours

#### 6.2.8 Sélecteur de skills
- **Bouton/dropdown "Skills"** dans le header
- Toggle des skills actifs pour la session
- Recherche de skills (les 50 built-in sont déjà listés)
- Icônes/badges pour skills actifs

#### 6.2.9 TTS (Text-to-Speech)
- **Bouton 🔊** sur chaque message assistant → lecture audio
- Utilise les providers déjà configurés (Edge TTS, ElevenLabs, OpenAI TTS — tous en deps)
- Indicateur de lecture en cours
- Contrôle play/pause/stop

#### 6.2.10 STT (Speech-to-Text)
- **Bouton 🎤** dans la barre d'input
- Utilise Web Speech API (natif navigateur) ou Whisper via API
- Transcription en temps réel dans le textarea
- Indicateur d'écoute (pulsating dot)

#### 6.2.11 Feedback par message
- **👍 / 👎** sur chaque message assistant
- Stocké côté gateway pour analytics
- Optionnel : textarea de feedback détaillé

#### 6.2.12 Suggestions de prompts
- Après le message de bienvenue, afficher 3-4 boutons de suggestion
- Basés sur les skills activés et le contexte de l'agent
- Exemples : `[📝 Write code]` `[📋 Plan a project]` `[🔍 Search the web]` `[📊 Analyze data]`

#### 6.2.13 Input amélioré
- **Auto-resize** du textarea (grandit avec le contenu)
- **Shift+Enter** pour retour à la ligne
- **Enter** pour envoyer
- **Ctrl+K** pour la command palette (modèle, skills, commandes /)
- Preview des fichiers attachés en chips sous le textarea
- Compteur de caractères/tokens (optionnel)

#### 6.2.14 Messages système redesignés
- Le prompt système `/new` ou `/reset` ne doit **pas** apparaître comme un message "You"
- Remplacé par un **séparateur** discret : `── New session started · gpt-5.2 · 19:10 ──`
- Beaucoup plus propre et moins confus

### 6.3 Design des bulles de message V2

```
┌─ Message Utilisateur ──────────────────────────────────────┐
│ Aligné à droite                                             │
│ Background: brand/accent semi-transparent                   │
│ Actions au hover: [✏️ Edit] [🗑️ Delete]                   │
│ Timestamp en bas à droite, discret                          │
│ Fichiers attachés en chips cliquables                       │
└─────────────────────────────────────────────────────────────┘

┌─ Message Assistant ────────────────────────────────────────┐
│ Aligné à gauche                                             │
│ Background: surface légèrement différente                   │
│ Avatar: 🦞 ou lettre de l'agent                            │
│ Actions au hover: [📋 Copy] [🔄 Regenerate] [🔊 TTS]     │
│ Feedback: [👍] [👎]                                        │
│ Blocs de code: fond distinct + [Copy code]                  │
│ Timestamp + model badge en bas                              │
└─────────────────────────────────────────────────────────────┘

┌─ Thinking/Working (collapsible) ───────────────────────────┐
│ Fond: plus sombre, border-left accent                       │
│ Icône: 🧠 ou ⚙️                                           │
│ Collapsé par défaut, expandable                             │
│ Monospace font pour le raisonnement                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Priorités d'implémentation

### Phase 1 — Quick Wins (1-2 semaines)

| # | Tâche | Impact | Effort |
|---|-------|--------|--------|
| 1 | **Streaming des réponses** (token par token) | 🔴 Critique | Moyen |
| 2 | **Rendu Markdown** (markdown-it est déjà en deps) | 🔴 Critique | Faible |
| 3 | **Coloration syntaxique** (cli-highlight est en deps) | 🔴 Critique | Faible |
| 4 | **Indicateur "typing…"** pendant la génération | 🔴 Critique | Faible |
| 5 | **Refonte couleurs** : bouton Send → bleu, Delete → rouge | ⚠️ Important | Faible |
| 6 | **Masquage tokens** dans Overview | ⚠️ Important | Faible |
| 7 | **Message système redesigné** (séparateur au lieu de bulle) | ⚠️ Important | Faible |

### Phase 2 — Core Features (2-4 semaines)

| # | Tâche | Impact | Effort |
|---|-------|--------|--------|
| 8 | **Historique conversations** (sidebar) | 🔴 Critique | Élevé |
| 9 | **Édition de messages** | 🔴 Important | Moyen |
| 10 | **Régénérer réponse** | 🔴 Important | Moyen |
| 11 | **Sélecteur de modèle** inline | 🔴 Important | Moyen |
| 12 | **Upload fichiers** + drag & drop | 🔴 Important | Moyen |
| 13 | **Feedback 👍/👎** | ⚠️ Nice-to-have | Faible |
| 14 | **Auto-resize textarea** | ⚠️ Important | Faible |
| 15 | **Modales de confirmation** (delete, logout, revoke) | ⚠️ Important | Faible |

### Phase 3 — Différenciateurs (4-8 semaines)

| # | Tâche | Impact | Effort |
|---|-------|--------|--------|
| 16 | **Sélecteur de skills** inline | 🔴 Important | Moyen |
| 17 | **TTS** (bouton lecture vocale) | ⚠️ Nice-to-have | Moyen |
| 18 | **STT** (entrée vocale) | ⚠️ Nice-to-have | Moyen |
| 19 | **Command palette** (Ctrl+K) | ⚠️ Nice-to-have | Moyen |
| 20 | **Suggestions de prompts** | ⚠️ Nice-to-have | Faible |
| 21 | **Multi-conversation onglets** | ⚠️ Avancé | Élevé |
| 22 | **Recherche dans l'historique** | ⚠️ Avancé | Moyen |
| 23 | **JSON viewer** collapsible pour Debug/Logs | ⚠️ Nice-to-have | Moyen |
| 24 | **ANSI rendering** dans Logs | ⚠️ Nice-to-have | Faible |
| 25 | **Raccourcis clavier** complets | ⚠️ Nice-to-have | Faible |

---

## Annexes

### A. Sources

- [AI Chatbot UX: 2026's Top Design Best Practices](https://www.letsgroto.com/blog/ux-best-practices-for-ai-chatbots)
- [Comparing Conversational AI Tool User Interfaces 2025-2026](https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025)
- [Admin Dashboard UI/UX: Best Practices for 2025](https://medium.com/@CarlosSmith24/admin-dashboard-ui-ux-best-practices-for-2025-8bdc6090c57d)
- [Top UI/UX Trends in Admin Dashboard Design for 2025](https://www.uilayouts.com/top-ui-ux-trends-in-admin-dashboard-design-for-2025/)
- [31 Chatbot UI Examples from Product Designers](https://www.eleken.co/blog-posts/chatbot-ui-examples)
- [15 Chatbot UI Examples - Sendbird](https://sendbird.com/blog/chatbot-ui)

### B. Stack technique existante (exploitable pour V2)

| Dep existante | Usage V2 |
|---------------|----------|
| `markdown-it` | Rendu Markdown des réponses |
| `cli-highlight` | Coloration syntaxique des blocs de code |
| `sharp` | Traitement images uploadées |
| `pdfjs-dist` | Parsing PDF uploadés |
| `node-edge-tts` | TTS (Edge voices) |
| `ws` | WebSocket (déjà utilisé pour le chat) |
| `hono` | Serveur HTTP (routes pour uploads) |
| `lit` (devDep) | Web Components (UI chat) |

### C. Résumé exécutif

L'UI actuelle d'OpenClaw est un **dashboard d'administration fonctionnel** mais le composant **Chat est en retard de ~2 générations** par rapport aux standards 2026 fixés par ChatGPT, Gemini et Claude. Les manques critiques sont : **streaming, rendu Markdown, historique des conversations, upload de fichiers, et sélection de modèle/skills inline**.

Les points forts à conserver sont le **mode focus**, la **transparence du thinking**, le **dashboard multi-channel intégré**, et la **richesse de la configuration**.

La V2 proposée conserve l'architecture existante mais ajoute **25 améliorations** priorisées en 3 phases, dont les 7 premières (Phase 1) sont réalisables en 1-2 semaines avec les dépendances déjà installées.
