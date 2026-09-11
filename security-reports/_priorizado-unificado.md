# Reauditoría #2 (2026-09-11) — Checklist unificado
Commits: RadioColonia `ede939d` · POS `ac4f80e` — *deploy security and bug fixes*

ARCA / Mercado Pago: **diferidos a propósito** (aún no en producción), salvo donde el acceso a PII del POS mejoró por RBAC.

## Conteos

| Repo | RESUELTO | PARCIAL | PENDIENTE | DIFERIDO |
|------|----------|---------|-----------|----------|
| RadioColonia | 9 | 5 | 2 | 2 (MP + ARCA) |
| radio-colonia-pos | 2 | 7 | 5 | 0* |

\* Emisión ARCA no en prod; #14 clasificado PARCIAL por mejora de acceso a `/clientes` con `requireRole("admin")`.

---

## 1. Lo pedido en la primera auditoría

### RadioColonia (18)
01 Server Actions admin sin auth · 02 Webhook MP fail-open · 03 quantity Zod · 04 trackGuestOrder PII · 05 defaults admin/DB · 06 callbackUrl · 07 rate limit · 08 headers/remotePatterns · 09 health detail · 10 API isActive · 11 upload limits · 12 Auth.js/JWT · 13 enum email · 14 newsletter · 15 repo público · 16 password reset · 17 legales placeholder · 18 ARCA solo POS

### POS (14)
01 PIN/RBAC · 02 rate-limit login · 03 DB compartida · 04 repo/defaults · 05 offline localStorage · 06 headers · 07 API_TOKEN · 08 health DB · 09 PDF magic · 10 JWT sessionStorage · 11 UPDATE dinámico · 12 voids · 13 SCA · 14 PII/ARCA legal

---

## 2. Lo solucionado

### RadioColonia — RESUELTO
| # | Ítem | Evidencia breve |
|---|------|-----------------|
| 01 | Server Actions admin | `requireAdmin` / guards + `check:admin-guards` |
| 03 | Quantity checkout | Zod int 1–99 |
| 04 | trackGuestOrder | DTO allowlist, match exacto, rate limit |
| 06 | callbackUrl | `safeCallbackUrl` |
| 09 | /api/health | Errores opacos |
| 10 | API producto | `isActive=true` |
| 11 | Upload | 8MB + MIME + magic bytes |
| 13 | Enum email registro | Mensaje genérico |
| 15 | Repo público | Ahora **privado** |

### POS — RESUELTO
| # | Ítem | Evidencia breve |
|---|------|-----------------|
| 02 | Rate-limit / lockout login | `@fastify/rate-limit` + lockout 5→15min |
| 09 | PDF magic bytes | `%PDF-` + max 8MB |

### PARCIAL (mejoró, residual queda)
**RadioColonia:** 05 defaults (privacidad OK; seed/DB fallback siguen) · 07 rate limit (in-memory, sin edge/upload) · 08 headers (hay set; CSP permisiva / sin HSTS) · 12 JWT 12h pero Auth.js beta · 14 newsletter suavizado sin backend  

**POS:** 01 RBAC por PIN/roles (sin identidad operador; tokens viejos→admin) · 03 docs `pos_app` (no verificado en prod) · 04 defaults mejorados pero repo **público** + security-reports · 05 offline sin cliente_id / bloqueo stock (sigue localStorage en claro) · 06 Helmet (CSP off) · 08 health sin database_name (sigue info de estado) · 14 acceso PII admin (ARCA emisión diferida)

### DIFERIDO (decisión de negocio)
| Ítem | Repo |
|------|------|
| Webhook MP fail-open / hardening firma | RadioColonia |
| Facturación / emisión ARCA en flujo web | RadioColonia (#18); emisión POS no prod |

---

## 3. Lo pendiente

### RadioColonia
- **16** Password reset / verificación email  
- **17** Políticas legales reales (footer `href="#"`) — revisión legal  
- Residuales parciales: defaults seed/DB, rate-limit edge, CSP/HSTS, Auth.js estable, newsletter real  

### POS
- **07** `API_TOKEN` timing-safe + scopes  
- **10** JWT fuera de `sessionStorage` / revocación  
- **11** Whitelist UPDATE clientes  
- **12** Voids/refunds (si se implementan: con RBAC)  
- **13** Dependabot/SCA en CI  
- Residuales parciales: usuarios nominados + rotar JWT, aplicar `pos_app` en prod, **privatizar repo**, cifrar cola offline, CSP real  

### P0 residual sugerido
1. POS: cerrar identidad operador / no default-admin en JWT legacy + rotar `POS_JWT_SECRET`  
2. POS: privatizar repo (o sacar `security-reports/` de lo público)  
3. POS: `pos_app` least-privilege en prod  
4. Ecommerce: páginas legales + reset password cuando escalen cuentas  
5. Al activar MP: fail-closed webhook + secreto obligatorio  

---

## Fuentes
- `/workspace/audits/RadioColonia-reaudit2-2026-09-11.md`
- `/workspace/audits/radio-colonia-pos-reaudit2-2026-09-11.md`
