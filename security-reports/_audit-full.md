# Re-auditoría #2 de seguridad — radio-colonia-pos (post push de código)

| Campo | Valor |
|-------|--------|
| **Repositorio** | [Fran55sh/radio-colonia-pos](https://github.com/Fran55sh/radio-colonia-pos) |
| **Visibilidad** | **PÚBLICO** (`isPrivate: false`) |
| **Rama** | `main` @ `ac4f80ed16d5` (2026-09-11T02:24:05Z) |
| **Mensaje tip** | `deploy security and bug fixes` |
| **Fecha re-auditoría** | 2026-09-11 |
| **Alcance** | READ-ONLY (`gh` + clone local de solo lectura); **sin modificar código**, sin runtime Coolify |
| **Baseline** | `/workspace/audits/radio-colonia-pos-security-audit.md` + `/workspace/security-reports-staging/security-reports/*.md` |
| **Reaudit #1 (obsoleta)** | `/workspace/audits/radio-colonia-pos-reaudit-2026-09-11.md` — solo docs (`0c273d1`); **no** refleja el tip actual |
| **Diff vs tip previo** | `0c273d1...ac4f80ed16d5` → **1 commit**, **26 archivos**, +750/−118 (Backend auth/app/pdf, Frontend offline/RBAC UI, env/docs/compose) |

---

## 1. Resumen ejecutivo

Tras el push real `ac4f80ed16d5` (**deploy security and bug fixes**), el perfil de riesgo **mejoró de forma material** respecto del baseline y de la reaudit #1 (que solo vio docs). Hay RBAC por PIN/roles, rate-limit + lockout de login, Helmet, magic bytes PDF, sanitización de ejemplos, docs de least-privilege DB, endurecimiento de cola offline y recorte de `/health`.

Quedan residuales importantes: identidad de operador aún genérica (`sub: "pos"`), repo público con `security-reports/`, DB compartida (mitigación solo documentada), `API_TOKEN` sin timing-safe ni scopes, JWT en `sessionStorage`, UPDATE dinámico de clientes, SCA sin proceso, y ARCA aún fuera de producción.

| Clasificación | Cantidad |
|---------------|----------|
| **RESUELTO** | **2** |
| **PARCIAL** | **7** |
| **PENDIENTE** | **5** |
| **DIFERIDO** | **0** |

*(El aspecto de emisión ARCA/#14 sigue fuera de producción; se clasifica **PARCIAL** porque el control de acceso a PII/clientes mejoró con `requireRole("admin")`, no como DIFERIDO puro.)*

**Conclusión:** ya no es “equivalente al baseline”. Priorizar cerrar residuales de #1 (usuarios/actor), #3 (aplicar `pos_app` en prod), #4 (privatizar), #7 (timing-safe + scopes) y #10.

---

## 2. Tabla de estado vs hallazgos previos

| # | Hallazgo previo | Severidad orig. | Estado | Evidencia en `main` @ `ac4f80ed16d5` |
|---|-----------------|-----------------|--------|-------------------------------------|
| 1 | PIN único / sin RBAC | 🔴 CRÍTICO | **PARCIAL** | Roles `caja` \| `compras` \| `admin` en JWT; `POS_ADMIN_PIN` / `POS_COMPRAS_PIN` / `POS_DEFAULT_ROLE`; `requireRole` en `/fiscal`, `/compras`, `/contabilidad`, `/clientes`, `/analytics`; UI con `hasRoleAtLeast`. **Residual:** `sub` sigue `"pos"` (sin identidad de operador/auditoría); tokens legacy sin `role` → `admin`; PINs compartidos (no usuarios staff). |
| 2 | Login PIN sin rate-limit / lockout | 🟠 ALTO | **RESUELTO** | `@fastify/rate-limit` global (200/min) + login `max: 10` / 1 min; lockout in-memory 5 fallos → 15 min (`assertLoginAllowed` / `recordLoginFailure`). |
| 3 | DB compartida ecommerce | 🟠 ALTO | **PARCIAL** | Arquitectura sigue siendo misma PostgreSQL. **Nuevo:** `docs/DEPLOY.md` §3b con `CREATE ROLE pos_app` + GRANTs mínimos; `.env.coolify.example` sugiere `DB_USER=pos_app`. Sin evidencia en código de que prod ya use ese rol. |
| 4 | Repo público + defaults PIN/JWT/Coolify | 🟠 ALTO | **PARCIAL** | Repo **sigue PUBLIC**; `security-reports/` sigue indexable. **Mejora:** `DB_HOST` placeholder; PIN/JWT de ejemplo ya no son `1234` / `dev-pos-jwt-secret-change-me` sino `change-me-*` / placeholders Coolify; avisos de rotación. |
| 5 | Cola offline en `localStorage` | 🟠 ALTO | **PARCIAL** | `enqueueSale` omite `cliente_id`; `exceedsKnownStock` bloquea offline sobre stock; `clearOfflineQueue` en logout. **Residual:** cola sigue en claro en `localStorage` (líneas, medio de pago, etc.); sin cifrado. |
| 6 | Security headers | 🟡 MEDIO | **PARCIAL** | `@fastify/helmet` registrado (X-Frame-Options y defaults). **Residual:** `contentSecurityPolicy: false`; frontend/Nitro sin headers propios. |
| 7 | `API_TOKEN` full access + timing | 🟡 MEDIO | **PENDIENTE** | Sigue `token === env.API_TOKEN` (no `timingSafeEqual`); bypass con rol **admin** fijo; sin scopes. |
| 8 | `/health` con info de DB | 🟡 MEDIO | **PARCIAL** | Eliminado `database_name` / `current_database()`. Sigue público con `database` (connected/disconnected) + `schema_ready` + `service`. |
| 9 | Upload PDF sin magic bytes | 🟡 MEDIO | **RESUELTO** | `assertPdfMagicBytes` exige `%PDF-`; llamado en `storePdfBuffer`; límite bajado a 8 MB. Path traversal sigue mitigado. |
| 10 | JWT en `sessionStorage` | 🟡 MEDIO | **PENDIENTE** | Sigue `sessionStorage` (`pos-session`); TTL default 12h; sin `jti`/revocación/HttpOnly. Solo se añade `role` al payload local. |
| 11 | `UPDATE` dinámico clientes | 🔵 BAJO | **PENDIENTE** | `Object.entries(data)` → `` `${key} = $n` `` sin whitelist explícita; mitigación residual Zod strip sin cambio. |
| 12 | Sin voids/refunds | 🔵 BAJO | **PENDIENTE** | Solo `GET /productos`, `POST /ventas`, `POST /ventas/offline-batch`. Posible aceptación de producto. |
| 13 | Deps SCA (INFO) | ⚪ INFO | **PENDIENTE** | Lockfile actualizado (helmet/rate-limit); **sin** `.github/dependabot` / Renovate / evidencia de `npm audit` en CI. |
| 14 | Legal PII fiscal / ARCA | ⚖️ LEGAL | **PARCIAL** | Acceso a `/clientes` (y contabilidad/fiscal/analytics) ahora exige `admin` → mejora de control de acceso a PII. Emisión ARCA **no en producción** (aspecto fiscal sigue diferible por negocio). No es RESUELTO: repo público + cola/sesión en browser + sin usuarios nominados. |

---

## 3. Diff vs `0c273d1` (cambios de seguridad relevantes)

Commit único `ac4f80ed16d5` — archivos clave:

| Área | Archivos | Cambio |
|------|----------|--------|
| RBAC | `middleware/auth.ts`, `auth/service.ts`, `app.ts`, `env.ts`, Frontend auth/compras | Roles + `requireRole` + PINs por rol |
| Rate limit | `app.ts`, `auth/routes.ts`, `package.json` | Helmet + rate-limit + lockout login |
| Health | `app.ts` | Sin `database_name` |
| PDF | `pdf-storage.ts` | Magic bytes `%PDF-`; max 8 MB |
| Offline | `offline-queue.ts`, `routes/index.tsx` | Sin `cliente_id`; bloqueo stock; clear logout |
| Defaults/docs | `.env.coolify.example`, `Backend/.env.example`, `docker-compose.yml`, `docs/DEPLOY.md` | Placeholders; `pos_app` GRANT recipe |
| Extra | `Backend/spa.traineddata` (~3.3 MB) | Datos Tesseract spa (no hallazgo de seguridad de esta lista) |

**No** cambió: visibilidad del repo, presencia de `security-reports/`, patrón UPDATE clientes, ausencia voids, ausencia SCA automatizado, comparación `API_TOKEN` con `===`.

---

## 4. Hallazgos residuales / contexto nuevo

### Tokens JWT legacy sin `role` → admin
`verifyToken` hace `parsed.role ?? "admin"` y el frontend asume admin si hay token sin role. Ventana de privilegio elevado si quedan sesiones antiguas tras el deploy. Mitigar: invalidar sesiones (rotar `POS_JWT_SECRET`) o rechazar tokens sin `role`.

### Informes `security-reports/` aún públicos
Agravante de #4 (ya señalado en reaudit #1): playbook de hallazgos sigue en `main` público.

### `API_TOKEN` ahora explícitamente admin
Antes era bypass total implícito; ahora asigna `role: "admin"` en `authContext`. Mejora de claridad, **no** de least-privilege ni timing-safety.

---

## 5. Top pendientes (prioridad sugerida)

1. **Cerrar #1:** usuarios/operadores + `actor_id` / auditar; rotar JWT secret post-deploy; no default-admin en tokens sin role.  
2. **Aplicar #3 en prod:** usuario `pos_app` real + verificar GRANTs.  
3. **#4:** privatizar repo o mover `security-reports/`; rotar secretos si defaults viejos se usaron.  
4. **#7:** `timingSafeEqual` + scopes para `API_TOKEN`.  
5. **#10 / #5 residual:** TTL más corto, CSP real, cifrado/minimización cola offline.  
6. **#11–#13:** whitelist UPDATE; proceso SCA; voids solo con RBAC+auditoría si se implementan.

---

## 6. Controles positivos (post-fix)

- RBAC por roles en API y UI (caja / compras / admin).  
- Rate-limit global + estricto en login + lockout temporal.  
- Helmet en API Fastify.  
- Magic bytes PDF + path traversal mitigado + límite 8 MB.  
- Offline: sin `cliente_id`, bloqueo por stock conocido, clear al logout.  
- `/health` sin nombre de base.  
- Ejemplos de env/compose sanitizados; docs least-privilege DB.  
- PIN/JWT siguen con `timingSafeEqual` en flujo de PIN/firma.  
- Fail-fast prod: `POS_ACCESS_PIN` + `POS_JWT_SECRET` obligatorios.  
- Precios autoritativos en servidor; SQL parametrizado en flujos principales.  
- Certificados ARCA no commiteados.

---

## 7. Método y limitaciones

- READ-ONLY: clone en `/workspace/radio-colonia-pos` @ `ac4f80ed16d5`; `gh repo view`; diff `0c273d1...ac4f80ed16d5`; lectura de archivos citados.  
- **No** se modificó el remoto ni se ejecutó la app / `npm audit` dinámico / verificación de GRANTs reales en Coolify.  
- Lockout de login es **in-memory por proceso** (no compartido entre réplicas).  
- Headers reales del reverse proxy Coolify no verificados en runtime.

---

## 8. Conteos finales

| RESUELTO | PARCIAL | PENDIENTE | DIFERIDO |
|----------|---------|-----------|----------|
| **2** | **7** | **5** | **0** |

| # RESUELTO | # PARCIAL | # PENDIENTE |
|------------|-----------|-------------|
| 2 (rate-limit), 9 (PDF magic) | 1 (RBAC), 3 (DB), 4 (repo/defaults), 5 (offline), 6 (headers), 8 (health), 14 (PII/ARCA acceso) | 7 (API_TOKEN), 10 (JWT storage), 11 (UPDATE), 12 (voids), 13 (SCA) |

*Informe de re-auditoría #2 — RC Security & Compliance — 2026-09-11. Uso interno sugerido; el repo destino sigue público.*
