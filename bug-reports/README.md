# Bug reports — radio-colonia-pos

Hallazgos de la auditoría QA / seguridad del **2026-09-11**.
Solo documentación; no incluyen fixes de código.

| Severidad | Archivo | Estado |
|-----------|---------|--------|
| 🔴 CRÍTICO | [critico-sincronizada-offline-salta-arca.md](./critico-sincronizada-offline-salta-arca.md) | Confirmado |
| 🔴 CRÍTICO | [critico-api-abierta-sin-node-env-production.md](./critico-api-abierta-sin-node-env-production.md) | Confirmado |
| 🟠 ALTO | [alto-login-pin-sin-rate-limit.md](./alto-login-pin-sin-rate-limit.md) | Confirmado |
| 🟠 ALTO | [alto-jwt-api-token-privilegio-total.md](./alto-jwt-api-token-privilegio-total.md) | Confirmado |
| 🟠 ALTO | [alto-client-sale-id-toctou-idempotencia.md](./alto-client-sale-id-toctou-idempotencia.md) | Probable |
| 🟠 ALTO | [alto-jwt-secret-debil-y-fallback-dev.md](./alto-jwt-secret-debil-y-fallback-dev.md) | Confirmado |
| 🟡 MEDIO | [medio-api-token-comparacion-no-timing-safe.md](./medio-api-token-comparacion-no-timing-safe.md) | Confirmado |
| 🟡 MEDIO | [medio-pdf-ocr-dos-post-auth.md](./medio-pdf-ocr-dos-post-auth.md) | Confirmado |
| 🟡 MEDIO | [medio-resolve-pdf-path-traversal-latente.md](./medio-resolve-pdf-path-traversal-latente.md) | Potencial |
| 🟡 MEDIO | [medio-race-emision-arca-misma-venta.md](./medio-race-emision-arca-misma-venta.md) | Probable |
| 🟡 MEDIO | [medio-health-filtra-nombre-db.md](./medio-health-filtra-nombre-db.md) | Confirmado |
| 🔵 BAJO | [bajo-cors-env-sin-validacion.md](./bajo-cors-env-sin-validacion.md) | Potencial |
| 🔵 BAJO | [bajo-pin-sha256-sin-kdf.md](./bajo-pin-sha256-sin-kdf.md) | Confirmado |
| 🔵 BAJO | [bajo-fiscal-config-ambiente-hardcode.md](./bajo-fiscal-config-ambiente-hardcode.md) | Confirmado |
