# Security reports — radio-colonia-pos (estado actual)

> **Fuente de verdad para remediación.** Solo hallazgos **abiertos** (PENDIENTE / PARCIAL).
> Lo cerrado está en [`SOLUCIONADOS.md`](./SOLUCIONADOS.md).
>
> Última reauditoría: 2026-09-11 · `main` @ `ac4f80e` (*deploy security and bug fixes*)
> Informe: [`_audit-full.md`](./_audit-full.md)

## Cómo usar (Cursor / agentes)

1. Trabajar solo ítems de este README.
2. No reabrir `SOLUCIONADOS.md`.
3. Al cerrar: mover a `SOLUCIONADOS.md` con evidencia y borrar de aquí.
4. Emisión **ARCA** aún no en producción — no priorizar emisión fiscal; sí mantener RBAC sobre PII/clientes.

## Resumen

| Estado | Cantidad |
|--------|----------|
| PARCIAL | 7 |
| PENDIENTE | 5 |
| RESUELTO (ver SOLUCIONADOS) | 2 |

**Nota:** el repo sigue **PÚBLICO** con este playbook visible → priorizar privatizar o mover informes.

---

## PARCIAL

### P-01 · RBAC incompleto / sin identidad de operador
**Severidad orig.:** 🔴 CRÍTICO  
**Qué quedó:** Roles `caja|compras|admin` + `requireRole` en fiscal/compras/contabilidad/clientes/analytics.  
**Residual:** `sub` sigue `"pos"`; tokens sin `role` → `admin`; PINs compartidos (no usuarios).  
**Hacer:** Usuarios nominados + `actor_id`; rotar `POS_JWT_SECRET` post-deploy; rechazar JWT sin `role`.

### P-03 · DB compartida ecommerce
**Severidad orig.:** 🟠 ALTO  
**Qué quedó:** Docs `pos_app` + GRANTs en `DEPLOY.md`; examples sugieren `DB_USER=pos_app`.  
**Residual:** Sin evidencia de rol aplicado en prod; sigue misma PostgreSQL.  
**Hacer:** Crear/aplicar `pos_app` en prod y verificar GRANTs.

### P-04 · Repo público + defaults / playbook
**Severidad orig.:** 🟠 ALTO  
**Qué quedó:** Placeholders `change-me-*`; `DB_HOST` genérico.  
**Residual:** Repo **PUBLIC**; `security-reports/` indexable.  
**Hacer:** Privatizar repo **o** sacar informes a privado; rotar secretos si defaults viejos se usaron.

### P-05 · Cola offline localStorage
**Severidad orig.:** 🟠 ALTO  
**Qué quedó:** Sin `cliente_id`; bloqueo stock offline; clear en logout.  
**Residual:** Cola en claro (líneas, medio de pago).  
**Hacer:** Cifrar / minimizar payload; TTL; CSP.

### P-06 · Security headers
**Severidad orig.:** 🟡 MEDIO  
**Qué quedó:** `@fastify/helmet` on.  
**Residual:** `contentSecurityPolicy: false`; frontend sin headers propios.  
**Hacer:** CSP real (API + Nitro/proxy).

### P-08 · `/health` aún informativo
**Severidad orig.:** 🟡 MEDIO  
**Qué quedó:** Sin `database_name`.  
**Residual:** Público con `database` + `schema_ready` + `service`.  
**Hacer:** Liveness mínimo público; detalle solo interno/auth.

### P-14 · PII fiscal / ARCA (acceso)
**Severidad orig.:** ⚖️  
**Qué quedó:** `/clientes` (y módulos sensibles) exigen `admin`. Emisión ARCA **no en prod**.  
**Residual:** Repo público + sesión/cola en browser + sin operadores nominados.  
**Hacer:** Completar P-01/P-04; al activar ARCA revisar retención/minimización con asesoría.

---

## PENDIENTE

### N-07 · `API_TOKEN` full admin + `===`
**Hacer:** `timingSafeEqual`; scopes; rotación; no superusuario eterno.

### N-10 · JWT en `sessionStorage`
**Hacer:** TTL más corto; HttpOnly cookie+CSRF si same-site; o revocación/`jti`; no dejar token XSS-exfiltable.

### N-11 · UPDATE dinámico clientes
**Hacer:** Whitelist explícita de columnas (no solo Zod strip).

### N-12 · Voids / refunds
**Hacer:** Si se implementan: rol admin, motivo, auditoría, asiento inverso. Si no: documentar aceptación de producto.

### N-13 · SCA / Dependabot
**Hacer:** Dependabot/Renovate + `npm audit` en CI.

---

## Prioridad sugerida

1. Rotar JWT + no default-admin legacy (P-01)  
2. Privatizar repo / mover reports (P-04)  
3. Aplicar `pos_app` en prod (P-03)  
4. `API_TOKEN` timing-safe + scopes (N-07)  
5. Sesión/cola (N-10, P-05) · CSP (P-06) · whitelist UPDATE (N-11) · SCA (N-13)
