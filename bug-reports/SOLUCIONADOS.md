# Solucionados — radio-colonia-pos

**No re-aplicar.** Historial post `ac4f80e` (2026-09-11).

| Severidad | Título | Evidencia del fix |
|-----------|--------|-------------------|
| 🟠 | Login PIN sin rate limit / brute force | `@fastify/rate-limit` en login + lockout 5/15min (`auth/routes.ts`, `auth/service.ts`) |
| 🟠 | Un solo rol = privilegio total | Roles `caja` / `compras` / `admin`; `requireRole` en fiscal/compras/contabilidad/clientes/analytics; PINs `POS_ADMIN_PIN` / `POS_COMPRAS_PIN` |
| 🟡 | Health público filtraba `database_name` | `/health` ya no expone nombre de DB |
| 🟡 | PDF upload sin límites básicos | 8 MB, MIME, magic `%PDF`, multipart limits |
| — | Hardening extra | Helmet; rate limit global 200/min; examples `change-me-*`; frontend role-aware |

### Parcialmente mitigado (detalle en ABIERTOS)
- Auth abierta solo fuera de production (prod exige PIN) — footgun NODE_ENV sigue en ABIERTOS.
- JWT secret / API_TOKEN timing / resolvePdfPath / CORS / PIN KDF — ver ABIERTOS.

## Homologación ARCA go-live (2026-09-17)

Resueltos los diferidos de activación fiscal:

- `sincronizada_offline` en venta online ya no saltea ARCA (solo batch offline interno).
- Lock advisory por `venta_id` + `ON CONFLICT (venta_id)` para evitar doble emisión.
- `GET /fiscal/config` reporta `ambiente` (`dev`/`prod`) y `production` reales.
- Reintento fiscal disponible para rol ≥ caja (botón en diálogo de caja).

