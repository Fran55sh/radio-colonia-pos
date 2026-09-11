# [🟡 MEDIO] PDF upload / OCR puede DoS CPU tras autenticación

**Repo:** Fran55sh/radio-colonia-pos  
**Estado:** Confirmado  
**Fecha auditoría:** 2026-09-11

## Problema
Upload autenticado dispara extract multi-estrategia (`pdftoppm`, Tesseract). Solo hay gate de tamaño/MIME/magic `%PDF`, sin cuota de concurrencia.

## Evidencia
Módulos `compras/importacion` (`pdf-ocr.ts`, `pdf-text-extractor.ts`, routes multipart ~10MB).

## Reproducción
Subir PDFs pesados/imagen repetidamente a `/compras/importaciones`.

## Causa
Pipelines nativos costosos sin límites de concurrencia/timeouts/páginas.

## Impacto
Agotamiento de CPU/host; puede afectar la caja.

## Archivos afectados
- `Backend/src/modules/compras/importacion/*`
- `Backend/src/app.ts`

## Solución propuesta
Límite global de uploads concurrentes, timeouts, tope de páginas, worker en cola.

## Tests recomendados
Uploads concurrentes respetan límite; timeout sin crash.
