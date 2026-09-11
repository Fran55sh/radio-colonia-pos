# Upload PDF de compras: validación por extensión/MIME, procesamiento local (OCR/poppler)

**Severidad:** 🟡 MEDIO
**Repo:** Fran55sh/radio-colonia-pos
**Fecha:** 2026-09-11
**Estado:** Probable
**Área:** Seguridad
**Prioridad:** P2

## Problema

`validatePdfUpload` valida `.pdf`, MIME y tamaño ≤10MB, pero no magic bytes `%PDF`. El pipeline usa poppler/tesseract (`Dockerfile` instala ambos). Path traversal al leer está mitigado (`resolvePdfPath`). Un PDF malicioso podría intentar DoS/crash del worker OCR.

## Evidencia

`Backend/src/modules/compras/importacion/pdf-storage.ts`, `service.ts` (`createImportacionFromPdf`), `Backend/Dockerfile` (poppler + tesseract).

## Impacto

DoS del backend POS; posible abuso de CPU en caja.

## Archivos

`pdf-storage.ts`, `importacion/service.ts`, `Backend/Dockerfile`

## Recomendación

Verificar magic bytes; sandbox/timeouts al parsear; cuotas por usuario; antivirus opcional; procesar en worker aislado.

## Fuente

Código
