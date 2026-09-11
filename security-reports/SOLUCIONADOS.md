# Solucionados — radio-colonia-pos

> Cerrados en reauditoría #2 (`ac4f80e`, 2026-09-11). **No reaplicar.**

| ID | Título | Evidencia de cierre |
|----|--------|---------------------|
| 02 | Login PIN sin rate-limit / lockout | `@fastify/rate-limit` (login 10/min) + lockout 5 fallos → 15 min |
| 09 | Upload PDF sin magic bytes | `assertPdfMagicBytes` exige `%PDF-`; max 8 MB |

Mejoras parciales (aún abiertas en README): RBAC por roles, docs least-privilege DB, placeholders, offline sin cliente_id, Helmet, health sin database_name, clientes solo admin.
