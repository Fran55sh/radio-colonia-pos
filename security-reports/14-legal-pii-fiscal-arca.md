# PII fiscal de clientes y datos AFIP/ARCA

**Severidad:** ⚖️ REVISIÓN LEGAL
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Revisión legal
**Área:** Legal / Privacidad
**Prioridad:** P1 (compliance)

## Problema

Se almacenan y exponen vía API (con solo PIN) nombre, documento (CUIT/DNI), condición IVA, razón social, domicilio fiscal, email, teléfono e historial de compras. Emisión ARCA implica tratamiento de datos fiscales. Dispositivos de caja compartidos + `localStorage`/`sessionStorage` aumentan riesgo de acceso no autorizado. Repo público describe el tratamiento.

## Evidencia

`Backend/src/modules/clientes/*`, fiscal/ARCA, offline queue, visibilidad pública del repo.

## Impacto

Posible incumplimiento de principios de Ley 25.326 (AR) / deberes de seguridad y minimización; obligaciones AFIP por comprobantes.

## Archivos

módulos `clientes`, `fiscal`, frontend auth/offline

## Recomendación

Minimizar PII en cliente; acceso por rol; registro de accesos; política de retención; evaluación con asesor legal; privacidad del repo de ops.

## Fuente

Código + marco AR (revisión no constituye dictamen legal)
