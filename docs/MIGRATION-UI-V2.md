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

### Sessions/Chats (Globaux au Gateway)

Les **sessions de chat** sont stockées dans `~/.openclaw/sessions/` et sont **GLOBALES** :

```
~/.openclaw/sessions/
├── session-abc123.json    ← Chat avec l'agent
├── session-def456.json    ← Autre conversation
└── session-ghi789.json    ← Projet discussions
```

**Important** :
- ✅ Les chats **ne sont PAS liés à un username**
- ✅ Tous les utilisateurs voient **toutes les sessions**
- ✅ Les chats **survivent aux updates** et changements d'auth mode
- ⚠️ Pour un vrai multi-tenant, utiliser plusieurs instances OpenClaw

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

- ✅ **Chats/Sessions** : Toujours visibles (stockés côté serveur, globaux)
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
- Server-side preferences & projects sync
- Enhanced audit logging

**Upgrading**: See [MIGRATION-UI-V2.md](docs/MIGRATION-UI-V2.md)
```

### 3. **Tests de Non-Régression**

Ajouter des tests pour vérifier la compatibilité :

```typescript
// Vérifier que token mode ne charge PAS les nouveaux modules
describe("backward compatibility", () => {
  it("token mode bypasses hashed credentials features", async () => {
    const auth = resolveGatewayAuth({ authConfig: { mode: "token", token: "secret" } });
    expect(auth.useHashedCredentials).toBe(false);
  });

  it("password mode without users falls back to legacy plaintext", async () => {
    const auth = resolveGatewayAuth({ authConfig: { mode: "password", password: "secret" } });
    expect(auth.useHashedCredentials).toBe(false);
    expect(auth.password).toBe("secret");
  });
});
```

---

## 📝 Résumé pour la PR

### ✅ Forces de la Stratégie de Migration

1. **Zero breaking changes** — Aucun utilisateur existant n'est cassé
2. **Opt-in progressif** — Les nouvelles fonctionnalités s'activent explicitement
3. **Fail-open** — Le gateway ne crash JAMAIS à cause des nouveaux modules
4. **Isolation par mode** — Token mode = ZERO side effects
5. **Migration automatique** — Config legacy auto-migrée au boot

### ⚠️ Points à Clarifier dans la PR

1. **Documenter clairement** le upgrade path dans README
2. **Ajouter un CHANGELOG** entry visible
3. **Tester la migration** : token → hashed credentials
4. **Vérifier** que `prepack` build bien l'UI avant npm publish
5. **Screenshots** : avant/après pour montrer l'UI V2

---

## 🚀 Recommandation Finale

**Ta branche est prête pour la PR** avec cette stratégie de migration !

La rétrocompatibilité est **excellente** :
- Utilisateurs token → Aucun changement (sauf UI design)
- Utilisateurs password legacy → Aucun changement
- Nouveaux utilisateurs → Opt-in vers hashed credentials

**Seul point manquant** : Documentation utilisateur claire sur le upgrade path.

Veux-tu que je t'aide à rédiger cette documentation ?
