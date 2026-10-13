import { describe, expect, it, vi } from "vitest";
import { AppError } from "../middleware/errors.js";
import { lockAndDecrementForSale } from "./catalog.js";

type QueryResult<T> = { rows: T[] };

function mockClient(handlers: Array<(sql: string, params: unknown[]) => QueryResult<unknown>>) {
  let call = 0;
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const handler = handlers[call];
      call += 1;
      if (!handler) {
        throw new Error(`Unexpected query #${call}: ${sql}`);
      }
      return handler(sql, params);
    }),
  };
}

describe("lockAndDecrementForSale", () => {
  it("descuenta aunque el stock quede negativo", async () => {
    const client = mockClient([
      (sql, params) => {
        expect(sql).toContain("UPDATE product_variants");
        expect(sql).not.toContain("pv.stock >= $1");
        expect(params).toEqual([2, "sku-1"]);
        return {
          rows: [
            {
              variant_id: "v1",
              product_id: "p1",
              sku: "sku-1",
              product_name: "Cable",
              attributes: {},
              precio_venta: 100,
              stock: -1,
              alicuota_iva: 21,
              offer: null,
              qty_discount_scope: "per_variant",
              product_price_tiers: null,
              variant_price_tiers: null,
            },
          ],
        };
      },
    ]);

    const result = await lockAndDecrementForSale(client, "SKU-1", 2);
    expect(result.stock_before).toBe(1);
    expect(result.stock_after).toBe(-1);
    expect(result.stock).toBe(-1);
    expect(result.sku).toBe("sku-1");
  });

  it("descuenta desde stock 0", async () => {
    const client = mockClient([
      () => ({
        rows: [
          {
            variant_id: "v1",
            product_id: "p1",
            sku: "sku-zero",
            product_name: "Mouse",
            attributes: {},
            precio_venta: 50,
            stock: -3,
            alicuota_iva: 21,
            offer: null,
            qty_discount_scope: "per_variant",
            product_price_tiers: null,
            variant_price_tiers: null,
          },
        ],
      }),
    ]);

    const result = await lockAndDecrementForSale(client, "sku-zero", 3);
    expect(result.stock_before).toBe(0);
    expect(result.stock_after).toBe(-3);
  });

  it("falla con PRODUCT_NOT_FOUND si el SKU no existe o está inactivo", async () => {
    const client = mockClient([
      () => ({ rows: [] }),
    ]);

    try {
      await lockAndDecrementForSale(client, "missing", 1);
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 404,
        code: "PRODUCT_NOT_FOUND",
      });
    }
  });
});
