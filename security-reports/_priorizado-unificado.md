# Priorizado unificado — RadioColonia + radio-colonia-pos
Fecha: 2026-09-11 · Alcance: READ-ONLY (código en `main`, sin ejecutar apps)

## Conteos
| Repo | 🔴 | 🟠 | 🟡 | 🔵 | ⚪ | ⚖️ |
|------|----|----|----|----|----|----|
| RadioColonia | 2 | 5 | 5 | 2 | 2 | 2 |
| radio-colonia-pos | 1 | 4 | 5 | 2 | 2 | 1 |

## P0 — hacer ya
1. **Ecommerce — Server Actions admin sin auth** (`products`, `categories`, `globalAttributes`, `suppliers`, `variants`): mutaciones invocables sin sesión. Agregar `requireAdmin()` al inicio de cada action.
2. **Ecommerce — Webhook MP**: si falta `MP_WEBHOOK_SECRET`, `verifySignature` retorna `true`. Fallar cerrado en prod.
3. **POS — PIN único = privilegios totales** (caja + compras + stock + contabilidad + fiscal + PII). Introducir RBAC / usuarios.
4. **POS — Login PIN sin rate-limit/lockout**.
5. **DB compartida**: POS escribe stock/costos en tablas del ecommerce → least-privilege + auditoría.

## P1 — siguiente oleada
- Checkout: validar `quantity` (int ≥ 1) en servidor.
- `trackGuestOrder`: DTO mínimo (sin costos, notas internas, IDs de pago).
- Defaults en repos **públicos** (PIN `1234`, JWT de ejemplo, host Coolify en ejemplo) → privatizar o sanitizar; rotar si se usaron.
- Cola offline POS en `localStorage` (PII / stock).
- Políticas legales del sitio (links `#`) → revisión legal AR.

## Controles positivos (ambos)
- Precios recalculados en servidor (checkout y POS).
- Stock con locks / checks en flujos online.
- `.env` no commiteado (solo examples).
- Layout admin / upload / bulk-import sí chequean admin (ecommerce).

## Informes completos
- `/workspace/audits/RadioColonia-security-audit.md`
- `/workspace/audits/radio-colonia-pos-security-audit.md`
