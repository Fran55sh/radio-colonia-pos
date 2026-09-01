import type { NormalizedInvoice, NormalizedInvoiceItem } from "@/lib/api-client";
import { formatARS } from "@/lib/format-money";
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
    importe: 0,
    variant_id: null,
    sku: null,
    producto_nombre: null,
    encontrado: false,
    requiere_revision: true,
  };
}

type Props = {
  invoice: NormalizedInvoice;
  onChange: (next: NormalizedInvoice) => void;
  onPickProduct: (index: number) => void;
};

function updateItem(
  invoice: NormalizedInvoice,
  index: number,
  patch: Partial<NormalizedInvoiceItem>,
): NormalizedInvoice {
  const items = invoice.items.map((item, i) => {
    if (i !== index) return item;
    const next = { ...item, ...patch };
    const expected = next.cantidad * next.precio_unitario - (next.descuento || 0);
    if (patch.cantidad != null || patch.precio_unitario != null || patch.descuento != null) {
      next.importe = Math.round(expected * 100) / 100;
    }
    return next;
  });
  return { ...invoice, items };
}

export function InvoiceReviewTable({ invoice, onChange, onPickProduct }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm rounded-lg border border-border bg-charcoal/40 p-4">
        <Field
          label="Proveedor"
          value={invoice.proveedor.razon_social ?? "—"}
        />
        <Field label="CUIT" value={invoice.proveedor.cuit ?? "—"} />
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
          <label className="text-[10px] uppercase tracking-wider text-silver font-bold">Pto. Venta</label>
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
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-charcoal text-[11px] uppercase tracking-wider text-silver">
            <tr>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-left">Desc. factura</th>
              <th className="px-3 py-2 text-right">Cant.</th>
              <th className="px-3 py-2 text-right">P. unit.</th>
              <th className="px-3 py-2 text-right">Dto.</th>
              <th className="px-3 py-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-silver">
                  No se detectaron líneas en el PDF. Agregá cada producto manualmente.
                </td>
              </tr>
            )}
            {invoice.items.map((item, idx) => {
              const ok = Boolean(item.variant_id);
              return (
                <tr key={idx} className="border-t border-border/50 hover:bg-charcoal/30">
                  <td className="px-3 py-2">
                    <span className={ok ? "text-online" : "text-offline"}>
                      {ok ? "●" : "●"}
                    </span>
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
                  <td className="px-3 py-2 min-w-[160px]">
                    <div className="text-xs text-silver-light truncate">
                      {item.producto_nombre ?? "NO ENCONTRADO"}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-primary text-xs"
                      onClick={() => onPickProduct(idx)}
                    >
                      {ok ? "Cambiar" : "Vincular"}
                    </Button>
                  </td>
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
                      step="0.01"
                      value={item.descuento}
                      onChange={(e) =>
                        onChange(
                          updateItem(invoice, idx, {
                            descuento: Number(e.target.value) || 0,
                          }),
                        )
                      }
                      className="h-8 w-20 bg-midnight border-border text-right tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-silver-light font-semibold">
                    <div className="flex items-center justify-end gap-2">
                      <span>{formatARS(item.importe)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-offline hover:text-offline"
                        onClick={() =>
                          onChange({
                            ...invoice,
                            items: invoice.items.filter((_, i) => i !== idx),
                          })
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
            onChange({
              ...invoice,
              items: [...invoice.items, createEmptyItem()],
            })
          }
        >
          <Plus className="size-4" />
          Agregar línea
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 justify-end text-sm">
        <span className="text-silver">
          Subtotal:{" "}
          <strong className="text-silver-light">
            {invoice.totales.subtotal != null ? formatARS(invoice.totales.subtotal) : "—"}
          </strong>
        </span>
        <span className="text-silver">
          IVA:{" "}
          <strong className="text-silver-light">
            {invoice.totales.iva != null ? formatARS(invoice.totales.iva) : "—"}
          </strong>
        </span>
        <span className="text-silver">
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
