# Sesión JWT en sessionStorage + auth “required” cacheada en el cliente

**Severidad:** 🟡 MEDIO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Confirmado
**Área:** Seguridad / Privacidad
**Prioridad:** P2

## Problema

Token en `sessionStorage` (`pos-session`); XSS futuro lo exfiltra. Flag `pos-auth-required` también en sessionStorage. Duración default 12h (`POS_SESSION_HOURS`). No hay refresh token ni revocación server-side (bastaría rotar `POS_JWT_SECRET`).

## Evidencia

`Frontend/src/lib/auth-session.ts`, `Backend/src/config/env.ts`.

## Impacto

En dispositivo compartido de caja, sesión larga = ventana amplia; sin logout forzado centralizado.

## Archivos

`Frontend/src/lib/auth-session.ts`, `Backend/src/modules/auth/service.ts`

## Recomendación

Reducir TTL en producción; logout remoto por versión de secreto/jti en denylist; HttpOnly cookie con CSRF si mismo sitio; CSP estricta.

## Fuente

Código
