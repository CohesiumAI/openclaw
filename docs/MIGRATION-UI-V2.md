# Migration vers UI V2 — Guide de Compatibilité

Ce document explique la stratégie de compatibilité backward pour les utilisateurs existants d'OpenClaw qui mettent à jour vers la version avec UI V2.

## 🎯 Principe Fondamental : **Zero Breaking Changes**

**L'UI V2 et toutes ses fonctionnalités de sécurité sont 100% rétrocompatibles.**

Les utilisateurs existants peuvent mettre à jour sans **AUCUNE** action requise. Leur configuration actuelle continue de fonctionner exactement comme avant.

---

## 🔐 Modes d'Authentification

OpenClaw supporte **4 modes d'authentification** :

| Mode             | Description                                       | UI disponible | Nouvelles fonctionnalités V2 |
| ---------------- | ------------------------------------------------- | ------------- | ---------------------------- |
| `none`           | Pas d'authentification (localhost uniquement)     | ✅ V2         | ❌ Non (localStorage seul)   |
| `token`          | Token partagé (legacy, par défaut)               | ✅ V2         | ❌ Non (localStorage seul)   |
| `password`       | Password plaintext (legacy)                       | ✅ V2         | ❌ Non (localStorage seul)   |
| `password` + 🆕  | Password hashé (scrypt) + users multi-utilisateurs | ✅ V2 + Login | ✅ **OUI** (sync serveur)    |

### Mode Détection Automatique

```typescript
// src/gateway/auth.ts ligne 293
const useHashedCredentials = mode === "password" && hasGatewayUsers();
```

**Si `gateway-users.json` existe** → Nouvelles fonctionnalités activées
**Sinon** → Comportement legacy préservé

---

## 🗂️ Architecture de Stockage

### Sessions/Chats

Les **sessions de chat** sont stockées dans `~/.openclaw/agents/<agentId>/sessions/` :

```
~/.openclaw/agents/main/sessions/
├── sessions.json          ← Index des sessions (avec ownerId)
├── session-abc123.jsonl   ← Transcript chat
├── session-def456.jsonl   ← Autre conversation
└── session-ghi789.jsonl   ← Projet discussions
```

**Isolation per-user** (mode hashed credentials) :

- ✅ Chaque session a un champ `ownerId` qui stocke le username du créateur
- ✅ Un **opérateur** ne voit que ses propres sessions + les sessions legacy (sans `ownerId`)
- ✅ Un **admin** voit ses propres sessions dans la sidebar, et accède à un **panneau Administration** (Settings) pour gérer les sessions de tous les utilisateurs (métadonnées seules)
- ✅ Les sessions **legacy** (créées avant l'isolation) restent visibles par tous
- ✅ Les chats **survivent aux updates** et changements d'auth mode

**Comportement par mode** :

| Mode | Visibilité sessions |
|---|---|
| `token` / `none` | Toutes les sessions visibles (pas de filtrage) |
| `password` (legacy plaintext) | Toutes les sessions visibles |
| `password` (hashed credentials, operator) | Propres sessions + sessions legacy uniquement |
| `password` (hashed credentials, admin) | Sidebar : propres sessions + legacy. Panneau admin : métadonnées de toutes les sessions |

> **Note** : le stockage fichier reste global. L'isolation est appliquée au niveau gateway (filtrage `sessions.list`, guards sur `sessions.patch/delete`, `chat.history/send`).

### Métadonnées UI (Par Utilisateur)

Les **préférences et métadonnées** sont stockées par username :

**Mode Token** (avant update) :
```
Navigateur localStorage:
├── pinnedSessionKeys: []
├── archivedSessionKeys: []
├── projects: []
└── theme: "dark"
```

**Mode Password + Hashed** (après update) :
```
~/.openclaw/user-preferences/<username>.json
~/.openclaw/user-projects/<username>/
```

**Migration automatique** : localStorage → Serveur au premier login

---

## 📦 Scénarios de Migration

### Scénario 1 : Utilisateur avec `mode: "token"` (Défaut)

**Configuration actuelle** :
```yaml
gateway:
  auth:
    mode: token
    token: "mon-token-secret"
```

**Après mise à jour** :
- ✅ UI V2 s'affiche (nouveau design)
- ✅ Token auth fonctionne exactement comme avant
- ✅ Pas de login screen
- ✅ Pas de sync serveur (localStorage uniquement)
- ✅ **ZÉRO changement de comportement**

**Pour activer les nouvelles fonctionnalités** (optionnel) :
```bash
# Créer un compte admin avec password hashé
openclaw user create

# Changer le mode
openclaw config set gateway.auth.mode password
```

---

### Scénario 2 : Utilisateur avec `mode: "password"` (legacy plaintext)

**Configuration actuelle** :
```yaml
gateway:
  auth:
    mode: password
    password: "mon-password"
```

**Après mise à jour** :
- ✅ UI V2 s'affiche
- ✅ Password plaintext continue de fonctionner
- ✅ Pas de login screen (bypass automatique)
- ✅ Pas de sync serveur
- ✅ **ZÉRO changement de comportement**

**Pour activer les nouvelles fonctionnalités** (optionnel) :
```bash
# Créer un compte admin avec password hashé
openclaw user create

# Le password plaintext dans config.yaml sera ignoré
# en faveur des credentials hashés
```

---

### Scénario 3 : Nouvel utilisateur (Fresh install)

**Première installation** :
```bash
npm install -g openclaw
openclaw onboard
```

**Flow onboarding** :
1. **Quick setup** : Token généré automatiquement (comportement legacy)
2. **Advanced setup** : Option "Hashed credentials (recommended)" disponible

**Résultat** :
- Quick → Mode token (comme avant)
- Advanced + Hashed → Mode password avec UI V2 complète

---

### Scénario 4 : Migration vers les nouvelles fonctionnalités

**Étapes manuelles pour activer UI V2 avec auth** :

```bash
# 1. Créer le premier utilisateur admin
openclaw user create
# Username: admin
# Password: ******
# Role: admin
# Recovery code: 12345678

# 2. Changer le mode d'auth (si token ou password plaintext)
openclaw config set gateway.auth.mode password

# 3. Redémarrer le gateway
openclaw gateway restart

# 4. Accéder à l'UI
# → Login screen s'affiche
# → Authentification avec username/password
# → Toutes les fonctionnalités V2 activées !
```

#### ⚠️ **IMPORTANT : Migration des Préférences**

**Lors de votre premier login**, l'UI V2 migrera automatiquement vos données du navigateur vers le serveur :

- ✅ **Chats/Sessions** : Les sessions existantes (sans `ownerId`) restent visibles par tous les utilisateurs. Les nouvelles sessions seront isolées per-user.
- ✅ **Projets** : Migrés automatiquement du localStorage → serveur
- ✅ **Pinned/Archived** : Migrés automatiquement du localStorage → serveur
- ✅ **Préférences UI** : Migrées automatiquement du localStorage → serveur

**Pour une migration réussie** :

1. ⚠️ **Ne PAS clear le cache/localStorage du navigateur avant le premier login**
2. ✅ Créez votre utilisateur admin
3. ✅ **Connectez-vous depuis LE MÊME NAVIGATEUR** que celui utilisé avant l'update
4. ✅ Vérifiez que vos projets et chats épinglés apparaissent
5. ✅ Ensuite, vous pouvez vous connecter depuis n'importe quel navigateur !

**Si vous avez plusieurs navigateurs** :
- La migration se fait depuis le **premier navigateur** à se connecter
- Les autres navigateurs se synchroniseront automatiquement avec les données du serveur

**Si la migration échoue** :
- Vos chats restent accessibles (liste complète dans la sidebar)
- Seules les métadonnées UI (pinned, projects) devront être recréées manuellement

---

## 🛡️ Modules de Sécurité — Fail-Open Strategy

Tous les nouveaux modules de sécurité sont **fail-open** : si l'initialisation échoue, le gateway démarre quand même.

### Session Persistence (Encrypted)

```typescript
// src/gateway/server.impl.ts ligne 355
initSessionPersistence() now gated by resolvedAuth.useHashedCredentials
```

**Comportement** :
- **Mode token/none** → Module NON chargé
- **Mode password (legacy plaintext)** → Module NON chargé
- **Mode password (hashed credentials)** → Module chargé
- **Si échec d'init** → Warning logged, gateway continue sans crash

### Audit Logging

```typescript
// Integrated into server.impl.ts (all auth modes, fail-open)
```

**Comportement** :
- **Tous les modes** → Module chargé (mais log uniquement les events pertinents)
- **Si échec d'init** → Warning logged, gateway continue

### User Preferences & Projects Sync

**WS Methods** :
- `user.preferences.get/set`
- `user.projects.*`
- `chat.files.*`

**Gating** :
```typescript
// Only available for password-authenticated users (session cookie auth)
if (!authUser) {
  return { error: "authentication required" };
}
```

**Comportement** :
- **Mode token** → Methods retournent error, UI fallback sur localStorage
- **Mode password (hashed)** → Methods fonctionnent, sync serveur actif

---

## 📊 Tableau de Compatibilité Fonctionnalités

| Fonctionnalité                      | Token mode | Password (legacy) | Password (hashed) |
| ----------------------------------- | ---------- | ----------------- | ----------------- |
| **UI V2 Design**                    | ✅         | ✅                | ✅                |
| Login screen                        | ❌         | ❌                | ✅                |
| Multi-utilisateurs (RBAC)           | ❌         | ❌                | ✅                |
| Session cookies (HttpOnly)          | ❌         | ❌                | ✅                |
| CSRF protection                     | ❌         | ❌                | ✅                |
| 2FA TOTP                            | ❌         | ❌                | ✅ (optionnel)    |
| Encrypted session persistence       | ❌         | ❌                | ✅                |
| User preferences sync (serveur)     | ❌         | ❌                | ✅                |
| Projects sync (serveur)             | ❌         | ❌                | ✅                |
| Session attachments (serveur)       | ❌         | ❌                | ✅                |
| **Per-user session isolation**      | ❌         | ❌                | ✅                |
| **Admin session management panel** | ❌         | ❌                | ✅                |
| **E2E encryption (sessions archivées)** | ❌    | ❌                | ✅                |
| Audit logging                       | ⚠️ Minimal | ⚠️ Minimal        | ✅ Complet        |
| Rate limiting                       | ✅         | ✅                | ✅                |
| CSP / Security headers              | ✅         | ✅                | ✅                |
| **Pinning / Archive (localStorage)**| ✅         | ✅                | ✅                |
| **Multi-chat**                      | ✅         | ✅                | ✅                |
| **File attachments**                | ✅         | ✅                | ✅                |
| **Model switching**                 | ✅         | ✅                | ✅                |
| **Voice input (STT)**               | ✅         | ✅                | ✅                |
| **TTS read-aloud**                  | ✅         | ✅                | ✅                |
| **Search modal (Cmd+K)**            | ✅         | ✅                | ✅                |
| **Slash commands**                  | ✅         | ✅                | ✅                |

**Légende** :
- ✅ = Fonctionnel
- ❌ = Non disponible (par design)
- ⚠️ = Partiel

---

## 🔄 Migration Automatique de Config

Le gateway **migre automatiquement** les anciennes configs au démarrage.

```typescript
// src/gateway/server.impl.ts lignes 202-222
if (configSnapshot.legacyIssues.length > 0) {
  const { config: migrated, changes } = migrateLegacyConfig(configSnapshot.parsed);
  await writeConfigFile(migrated);
  log.info(`gateway: migrated legacy config entries:\n${changes.join("\n")}`);
}
```

**Exemples de migrations** :
- `CLAWDBOT_GATEWAY_TOKEN` → `OPENCLAW_GATEWAY_TOKEN`
- Anciennes clés de config → Nouveau schéma

---

## ⚠️ Points d'Attention pour la PR

### 1. **Documentation Upgrade Path**

Ajouter dans `README.md` ou `UPGRADING.md` :

```markdown
## Upgrading from Previous Versions

### UI V2 is Now Default

The web UI has been completely redesigned. All users will see the new ChatGPT-style interface.

**No action required** — your existing configuration continues to work.

### Optional: Enable New Security Features

To activate multi-user auth, server-side sync, and 2FA:

1. Create an admin user: `openclaw user create`
2. Update auth mode: `openclaw config set gateway.auth.mode password`
3. Restart: `openclaw gateway restart`

See [MIGRATION-UI-V2.md](docs/MIGRATION-UI-V2.md) for details.
```

### 2. **Changelog Entry**

Dans `CHANGELOG.md` :

```markdown
## [Version X.Y.Z] - 2026-02-XX

### 🎨 UI V2 - Complete Redesign

- **New ChatGPT-style interface** with sidebar, projects, and modern UX
- **100% backward compatible** — existing configs work without changes
- Legacy V1 UI removed

### 🔐 Security (Optional Features)

New opt-in features for users who create hashed credentials:

- Multi-user authentication with RBAC (admin/operator/viewer)
- 2FA TOTP support
- Encrypted session persistence
- **E2E encryption of archived sessions** (AES-256-GCM, client-side PBKDF2 key derivation)
- Server-side preferences & projects sync
- Enhanced audit logging

> **Note** : Le recovery code ne permet **pas** de récupérer les sessions chiffrées. La réinitialisation du password via recovery code régénère le salt de chiffrement — les fichiers `.enc` existants deviennent irrécupérables (`encryptedSessionsLost: true`).

**Upgrading**: See [MIGRATION-UI-V2.md](docs/MIGRATION-UI-V2.md)
```

### 3. **Tests de Non-Régression** ✅

Tests unitaires couvrant les chemins de rétrocompatibilité (implémentés) :

- **`src/gateway/server-methods/auth-identity.test.ts`** (26 tests) :
  - `resolveAuthIdentity` : retourne `null` en token mode → pas de filtrage
  - `canSeeAllSessions` : `true` en token mode uniquement, `false` pour admin/operator/read-only
  - `assertSessionOwnership` : bypass token/admin/legacy, FORBIDDEN cross-user
  - `filterStoreByOwner` : own + legacy sessions, pas celles des autres
- **`src/auto-reply/reply/session.test.ts`** (+5 tests) :
  - `ownerId` stampé depuis `GatewayAuthUser` sur nouvelle session
  - `ownerId` absent en token mode (pas de `GatewayAuthUser`)
  - `ownerId` préservé sur messages suivants et après `/new`
  - Legacy session acquiert `ownerId` au premier contact authentifié
- **`src/gateway/auth.test.ts`** (+7 tests) :
  - `assertGatewayAuthConfigured` : throw/no-throw par mode
  - Tailscale bypass, hashed credentials, trusted-proxy validation

---

## 📝 Résumé pour la PR

### ✅ Forces de la Stratégie de Migration

1. **Zero breaking changes** — Aucun utilisateur existant n'est cassé
2. **Opt-in progressif** — Les nouvelles fonctionnalités s'activent explicitement
3. **Fail-open** — Le gateway ne crash JAMAIS à cause des nouveaux modules
4. **Isolation par mode** — Token mode = ZERO side effects
5. **Migration automatique** — Config legacy auto-migrée au boot
6. **Isolation sessions per-user** — En mode hashed credentials, chaque utilisateur ne voit que ses propres sessions dans la sidebar (admins inclus). Les admins accèdent à un panneau dédié pour gérer les sessions de tous (métadonnées seules, sessions legacy restent visibles par tous)
7. **E2E encryption** — Les transcripts archivés sont chiffrés client-side (AES-256-GCM via WebCrypto). Le serveur ne voit jamais le plaintext. Re-encryption automatique au changement de password

### ⚠️ Points à Clarifier dans la PR

1. **Documenter clairement** le upgrade path dans README
2. **Ajouter un CHANGELOG** entry visible
3. **Tester la migration** : token → hashed credentials
4. **`prepack` vérifié** ✅ — `pnpm build && pnpm ui:build` enchaîné automatiquement par `npm pack`. Assets UI inclus dans le tarball (index.html, CSS, JS, sourcemaps).
5. **Screenshots** : avant/après pour montrer l'UI V2

---

## 🚀 Recommandation Finale

**Ta branche est prête pour la PR** avec cette stratégie de migration !

La rétrocompatibilité est **excellente** :
- Utilisateurs token → Aucun changement (sauf UI design)
- Utilisateurs password legacy → Aucun changement
- Nouveaux utilisateurs → Opt-in vers hashed credentials

Le upgrade path est documenté ci-dessus. Les tests de non-régression couvrent les chemins critiques de rétrocompatibilité.
