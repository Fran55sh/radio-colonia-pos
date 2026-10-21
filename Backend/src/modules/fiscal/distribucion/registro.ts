import { pool } from "../../../config/db.js";

export type DistribucionRegistro = {
  ventaId: number;
  canal: "email" | "enlace";
  resultado: "enviado" | "error" | "generado";
  destino: string;
  detalle?: string | null;
};

/** Log estructurado sin secretos. La tabla es opcional hasta aplicar la migración del ecommerce. */
export async function registrarDistribucion(entry: DistribucionRegistro): Promise<void> {
  const safe = {
    event: "factura_distribucion",
    venta_id: entry.ventaId,
    canal: entry.canal,
    resultado: entry.resultado,
    destino: entry.destino,
    detalle: entry.detalle ?? null,
  };
  console.info(JSON.stringify(safe));
  try {
    await pool.query(
      `INSERT INTO pos_comprobante_envios (venta_id, canal, resultado, destino, detalle)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.ventaId, entry.canal, entry.resultado, entry.destino, entry.detalle ?? null],
    );
  } catch {
    console.info(JSON.stringify({ event: "factura_distribucion_db", resultado: "omitido", venta_id: entry.ventaId }));
  }
}
