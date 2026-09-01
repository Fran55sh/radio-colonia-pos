import type { NormalizedInvoice, NormalizedInvoiceItem } from "@/lib/api-client";
import { formatARS } from "@/lib/format-money";
import { IVA_OPTIONS, previewInvoiceTotals, roundCents } from "@/lib/invoice-math";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

function createEmptyItem(): NormalizedInvoiceItem {
  return {
    codigo_proveedor: null,
    descripcion: "",
    cantidad: 1,
    precio_unitario: 0,
    descuento: 0,
    descuento_porcentaje: 0,
    alicuota_iva: 21,
    importe: 0,
    neto_linea: 0,
    iva_linea: 0,
    total_linea: 0,
    variant_id: null,
    sku: null,
    producto_nombre: null,
    encontrado: false,
    requiere_revision: true,
    confirmar_cambio_mapeo: false,
  };
}

type Props = {
  invoice: NormalizedInvoice;
  onChange: (next: NormalizedInvoice) => void;
  onPickProduct: (index: number) => void;
  /** En modo manual: descripción solo lectura desde catálogo; proveedor editable. */
  mode?: "import" | "manual";
};

function withRecalc(invoice: NormalizedInvoice): NormalizedInvoice {
  const preview = previewInvoiceTotals(
    invoice.items.map((i) => ({
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      descuento_porcentaje: i.descuento_porcentaje ?? 0,
      alicuota_iva: i.alicuota_iva ?? 21,
    })),
    invoice.totales.descuento_total ?? 0,
  );
  return {
    ...invoice,
    items: invoice.items.map((item, i) => {
      const p = preview.lines[i]!;
      return {
        ...item,
        descuento_porcentaje: p.descuento_porcentaje,
        descuento: p.descuento,
        alicuota_iva: p.alicuota_iva,
        importe: p.importe,
        neto_linea: p.neto_linea,
        iva_linea: p.iva_linea,
        total_linea: p.total_linea,
      };
    }),
    totales: {
      ...invoice.totales,
      descuento_total: preview.descuento_total,
      subtotal: preview.subtotal,
      iva: preview.iva,
      total: preview.total,
    },
  };
}

function updateItem(
  invoice: NormalizedInvoice,
  index: number,
  patch: Partial<NormalizedInvoiceItem>,
): NormalizedInvoice {
  const items = invoice.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
  return withRecalc({ ...invoice, items });
}

export function InvoiceReviewTable({
  invoice,
  onChange,
  onPickProduct,
  mode = "import",
}: Props) {
  const isManual = mode === "manual";
  const proveedorStatus = invoice.proveedor.proveedor_id
    ? "Vinculado"
    : invoice.proveedor.se_creara ||
        (invoice.proveedor.cuit && invoice.proveedor.razon_social)
      ? "Se creará al confirmar"
      : "Incompleto";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm rounded-lg border border-border bg-charcoal/40 p-4">
        {isManual ? (
          <>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-silver font-bold">
                CUIT proveedor
              </label>
              <Input
                value={invoice.proveedor.cuit ?? ""}
                onChange={(e) =>
                  onChange(
                    withRecalc({
                      ...invoice,
                      proveedor: {
                        ...invoice.proveedor,
                        cuit: e.target.value || null,
                        proveedor_id: null,
                        se_creara: false,
                      },
                    }),
                  )
                }
                placeholder="30-XXXXXXXX-X"
                className="h-9 bg-midnight border-border font-mono"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-silver font-bold">
                Razón social
              </label>
              <Input
                value={invoice.proveedor.razon_social ?? ""}
                onChange={(e) =>
                  onChange(
                    withRecalc({
                      ...invoice,
                      proveedor: {
                        ...invoice.proveedor,
                        razon_social: e.target.value || null,
                        proveedor_id: null,
                        se_creara: false,
                      },
                    }),
                  )
                }
                placeholder="Proveedor S.A."
                className="h-9 bg-midnight border-border"
              />
            </div>
            <div className="col-span-2 sm:col-span-3 text-[11px] text-silver">
              Proveedor:{" "}
              <span
                className={
                  proveedorStatus === "Vinculado"
                    ? "text-online"
                    : proveedorStatus.startsWith("Se creará")
                      ? "text-amber-400"
                      : "text-offline"
                }
              >
                {proveedorStatus}
              </span>
            </div>
          </>
        ) : (
          <>
            <Field label="Proveedor" value={invoice.proveedor.razon_social ?? "—"} />
            <Field label="CUIT" value={invoice.proveedor.cuit ?? "—"} />
          </>
        )}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold">Tipo</label>
          <Input
            value={invoice.factura.tipo ?? ""}
            onChange={(e) =>
              onChange({
                ...invoice,
                factura: { ...invoice.factura, tipo: e.target.value.toUpperCase() || null },
              })
            }
            className="h-9 bg-midnight border-border"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold">
            Pto. Venta
          </label>
          <Input
            value={invoice.factura.punto_venta ?? ""}
            onChange={(e) =>
              onChange({
                ...invoice,
                factura: { ...invoice.factura, punto_venta: e.target.value || null },
              })
            }
            className="h-9 bg-midnight border-border font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold">Número</label>
          <Input
            value={invoice.factura.numero ?? ""}
            onChange={(e) =>
              onChange({
                ...invoice,
                factura: { ...invoice.factura, numero: e.target.value || null },
              })
            }
            className="h-9 bg-midnight border-border font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold">Fecha</label>
          <Input
            type="date"
            value={invoice.factura.fecha ?? ""}
            onChange={(e) =>
              onChange({
                ...invoice,
                factura: { ...invoice.factura, fecha: e.target.value || null },
              })
            }
            className="h-9 bg-midnight border-border"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="bg-charcoal text-[11px] uppercase tracking-wider text-silver">
            <tr>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Cód. prov.</th>
              <th className="px-3 py-2 text-left">Producto (SKU)</th>
              {!isManual && <th className="px-3 py-2 text-left">Desc. factura</th>}
              <th className="px-3 py-2 text-right">Cant.</th>
              <th className="px-3 py-2 text-right">P. unit.</th>
              <th className="px-3 py-2 text-right">Dto %</th>
              <th className="px-3 py-2 text-right">IVA %</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.length === 0 && (
              <tr>
                <td
                  colSpan={isManual ? 9 : 10}
                  className="px-4 py-8 text-center text-sm text-silver"
                >
                  {isManual
                    ? "Agregá productos y vinculá cada código de proveedor a un SKU interno."
                    : "No se detectaron líneas. Agregá cada producto manualmente."}
                </td>
              </tr>
            )}
            {invoice.items.map((item, idx) => {
              const ok = Boolean(item.variant_id);
              return (
                <tr key={idx} className="border-t border-border/50 hover:bg-charcoal/30">
                  <td className="px-3 py-2">
                    <span className={ok ? "text-online" : "text-offline"}>●</span>
                    <span className="ml-1 text-[10px] text-silver">
                      {ok ? "OK" : "Revisar"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={item.codigo_proveedor ?? ""}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            codigo_proveedor: e.target.value || null,
                          }),
                        )
                      }
                      className="h-8 w-24 bg-midnight border-border font-mono text-xs"
                    />
                  </td>
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="text-xs text-silver-light truncate">
                      {item.producto_nombre ?? "NO ENCONTRADO"}
                    </div>
                    {item.sku && (
                      <div className="text-[10px] text-primary font-mono">{item.sku}</div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-primary text-xs"
                      onClick={() => onPickProduct(idx)}
                    >
                      {ok ? "Cambiar" : "Vincular SKU"}
                    </Button>
                  </td>
                  {!isManual && (
                    <td className="px-3 py-2 text-xs text-silver max-w-[180px]">
                      <Input
                        value={item.descripcion}
                        onChange={(e) =>
                          onChange(
                            updateItem(invoice, idx, {
                              descripcion: e.target.value,
                            }),
                          )
                        }
                        placeholder="Descripción de la factura"
                        className="h-8 bg-midnight border-border text-xs"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      value={item.cantidad}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            cantidad: Number(e.target.value) || 0,
                          }),
                        )
                      }
                      className="h-8 w-20 bg-midnight border-border text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.precio_unitario}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            precio_unitario: Number(e.target.value) || 0,
                          }),
                        )
                      }
                      className="h-8 w-28 bg-midnight border-border text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={item.descuento_porcentaje ?? 0}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            descuento_porcentaje: Number(e.target.value) || 0,
                          }),
                        )
                      }
                      className="h-8 w-20 bg-midnight border-border text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={item.alicuota_iva ?? 21}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            alicuota_iva: Number(e.target.value),
                          }),
                        )
                      }
                      className="h-8 w-20 rounded-md border border-border bg-midnight text-xs text-right"
                    >
                      {IVA_OPTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-silver">
                    {formatARS(item.neto_linea ?? item.importe)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-silver-light font-semibold">
                    <div className="flex items-center justify-end gap-2">
                      <span>{formatARS(item.total_linea ?? item.importe)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-offline hover:text-offline"
                        onClick={() =>
                          onChange(
                            withRecalc({
                              ...invoice,
                              items: invoice.items.filter((_, i) => i !== idx),
                            }),
                          )
                        }
                        title="Quitar línea"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-start">
        <Button
          type="button"
          variant="outline"
          className="border-border text-silver-light gap-2"
          onClick={() =>
            onChange(
              withRecalc({
                ...invoice,
                items: [...invoice.items, createEmptyItem()],
              }),
            )
          }
        >
          <Plus className="size-4" />
          Agregar línea
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4 justify-end text-sm">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold block">
            Descuento total ($)
          </label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={invoice.totales.descuento_total ?? 0}
            onChange={(e) =>
              onChange(
                withRecalc({
                  ...invoice,
                  totales: {
                    ...invoice.totales,
                    descuento_total: roundCents(Number(e.target.value) || 0),
                  },
                }),
              )
            }
            className="h-9 w-36 bg-midnight border-border text-right tabular-nums"
          />
        </div>
        <span className="text-silver pb-2">
          Subtotal:{" "}
          <strong className="text-silver-light">
            {invoice.totales.subtotal != null ? formatARS(invoice.totales.subtotal) : "—"}
          </strong>
        </span>
        <span className="text-silver pb-2">
          IVA:{" "}
          <strong className="text-silver-light">
            {invoice.totales.iva != null ? formatARS(invoice.totales.iva) : "—"}
          </strong>
        </span>
        <span className="text-silver pb-2">
          Total:{" "}
          <strong className="text-primary">
            {invoice.totales.total != null ? formatARS(invoice.totales.total) : "—"}
          </strong>
        </span>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-silver font-bold">{label}</div>
      <div className="text-silver-light truncate">{value}</div>
    </div>
  );
}
