# Informes de seguridad — radio-colonia-pos

**Repo:** Fran55sh/radio-colonia-pos  
**Fecha:** 2026-09-11  
**Alcance:** solo documentación bajo `security-reports/` (sin cambios de código de aplicación)

## Índice de hallazgos accionables

| # | Severidad | Archivo | Prioridad |
|---|-----------|---------|-----------|
| 01 | 🔴 CRÍTICO | [01-critico-pin-privilegios-totales.md](./01-critico-pin-privilegios-totales.md) | P0 |
| 02 | 🟠 ALTO | [02-alto-login-sin-rate-limit.md](./02-alto-login-sin-rate-limit.md) | P0 |
| 03 | 🟠 ALTO | [03-alto-db-compartida-ecommerce.md](./03-alto-db-compartida-ecommerce.md) | P0 |
| 04 | 🟠 ALTO | [04-alto-repo-publico-defaults.md](./04-alto-repo-publico-defaults.md) | P1 |
| 05 | 🟠 ALTO | [05-alto-cola-offline-localstorage.md](./05-alto-cola-offline-localstorage.md) | P1 |
| 06 | 🟡 MEDIO | [06-medio-security-headers.md](./06-medio-security-headers.md) | P2 |
| 07 | 🟡 MEDIO | [07-medio-api-token-acceso-total.md](./07-medio-api-token-acceso-total.md) | P2 |
| 08 | 🟡 MEDIO | [08-medio-health-publico.md](./08-medio-health-publico.md) | P2 |
| 09 | 🟡 MEDIO | [09-medio-upload-pdf-compras.md](./09-medio-upload-pdf-compras.md) | P2 |
| 10 | 🟡 MEDIO | [10-medio-jwt-sessionstorage.md](./10-medio-jwt-sessionstorage.md) | P2 |
| 11 | 🔵 BAJO | [11-bajo-update-dinamico-clientes.md](./11-bajo-update-dinamico-clientes.md) | P3 |
| 12 | 🔵 BAJO | [12-bajo-sin-voids-refunds.md](./12-bajo-sin-voids-refunds.md) | P3 |
| 13 | ⚪ INFO | [13-info-dependencias-sca.md](./13-info-dependencias-sca.md) | P2 |
| 14 | ⚖️ LEGAL | [14-legal-pii-fiscal-arca.md](./14-legal-pii-fiscal-arca.md) | P1 |

**Total hallazgos accionables:** 14  
(Se omitió el INFO de “controles positivos”; se incluyó el INFO de dependencias por tener recomendación.)

## Documentos de soporte

- [`_audit-full.md`](./_audit-full.md) — copia del informe completo POS
- [`_priorizado-unificado.md`](./_priorizado-unificado.md) — priorizado unificado RadioColonia + POS

## Notas

- No se modificó código ni configuración de la aplicación en este cambio.
- Clasificación sugerida: uso interno.
