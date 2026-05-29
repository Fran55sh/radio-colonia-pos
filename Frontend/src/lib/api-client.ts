const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ProductoCaja = {
  codigo_interno: string;
  nombre: string;
  precio_venta: number;
  stock: number;
  alicuota_iva: number;
};

export type SaleLine = {
  codigo_interno: string;
  cantidad: number;
};

export type CreateSalePayload = {
  client_sale_id?: string;
  medio_pago: string;
  lineas: SaleLine[];
  sincronizada_offline?: boolean;
};

export type CreateSaleResult = {
  venta_id: number;
  total: number;
  client_sale_id?: string;
};

export type OfflineBatchResult = {
  procesadas: number;
  duplicadas: number;
  errores: Array<{ client_sale_id: string; error: string }>;
  resultados: Array<{ client_sale_id: string; venta_id: number; total: number }>;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      (data as { message?: string }).message ??
      (data as { error?: string }).error ??
      `Error HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export async function fetchProductos(): Promise<ProductoCaja[]> {
  const data = await apiFetch<{ productos: ProductoCaja[] }>("/pos/productos");
  return data.productos;
}

export async function createVenta(payload: CreateSalePayload): Promise<CreateSaleResult> {
  return apiFetch<CreateSaleResult>("/pos/ventas", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncOfflineVentas(
  ventas: CreateSalePayload[],
): Promise<OfflineBatchResult> {
  return apiFetch<OfflineBatchResult>("/pos/ventas/offline-batch", {
    method: "POST",
    body: JSON.stringify({ ventas }),
  });
}

export type ApiConnectionStatus = {
  /** API alcanzable (red / proxy OK). */
  online: boolean;
  /** Tablas pos_* listas para registrar ventas. */
  salesReady: boolean;
};

type HealthBody = {
  status?: string;
  database?: string;
  pos_schema?: string;
};

async function fetchHealth(): Promise<HealthBody | null> {
  try {
    const base = API_BASE.replace(/\/api\/v1\/?$/, "");
    const res = await fetch(`${base}/health`);
    return (await res.json()) as HealthBody;
  } catch {
    return null;
  }
}

export async function checkApiConnection(): Promise<ApiConnectionStatus> {
  const health = await fetchHealth();
  if (health) {
    const dbUp = health.database === "connected";
    const apiUp = health.status === "ok" || health.status === "degraded";
    return {
      online: apiUp && dbUp,
      // "ok" o "degraded" con DB: el aviso falso salía cuando /health cacheaba "missing" bajo carga.
      salesReady:
        dbUp &&
        (health.pos_schema === "ready" ||
          health.status === "ok" ||
          (health.status === "degraded" && health.database === "connected")),
    };
  }

  try {
    const res = await fetch(`${API_BASE}/pos/productos`);
    if (res.ok) {
      return { online: true, salesReady: true };
    }
  } catch {
    /* red caída */
  }

  return { online: false, salesReady: false };
}

/** @deprecated Usar checkApiConnection */
export async function checkApiHealth(): Promise<boolean> {
  const s = await checkApiConnection();
  return s.online;
}
