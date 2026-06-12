const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ProductoCaja = {
  codigo_interno: string;
  nombre: string;
  precio_venta: number;
  stock: number;
  alicuota_iva: number;
};

export type Cliente = {
  id: number;
  nombre: string;
  documento: string | null;
  documento_tipo_afip: string | null;
  condicion_iva_receptor_id: number | null;
  razon_social: string | null;
  domicilio_fiscal: string | null;
  email: string | null;
  telefono: string | null;
  created_at?: string;
};

export type CreateClientePayload = {
  nombre: string;
  documento?: string;
  documento_tipo_afip?: "CUIT" | "DNI" | "CF";
  condicion_iva_receptor_id?: number;
  razon_social?: string;
  domicilio_fiscal?: string;
  email?: string;
  telefono?: string;
};

export type FiscalResult = {
  estado: "pendiente" | "emitido" | "error" | "anulado";
  comprobante: string | null;
  cbte_tipo: number;
  cbte_tipo_label: string;
  cbte_nro: number | null;
  punto_venta: number;
  cae: string | null;
  cae_vencimiento: string | null;
  qr_url: string | null;
  error_message: string | null;
  ambiente: string;
};

export type SaleLine = {
  codigo_interno: string;
  cantidad: number;
};

export type CreateSalePayload = {
  client_sale_id?: string;
  cliente_id?: number;
  medio_pago: string;
  lineas: SaleLine[];
  sincronizada_offline?: boolean;
};

export type CreateSaleResult = {
  venta_id: number;
  total: number;
  client_sale_id?: string;
  fiscal?: FiscalResult | null;
};

export type OfflineBatchResult = {
  procesadas: number;
  duplicadas: number;
  errores: Array<{ client_sale_id: string; error: string }>;
  resultados: Array<{
    client_sale_id: string;
    venta_id: number;
    total: number;
    fiscal?: FiscalResult | null;
  }>;
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

export async function fetchClientes(search?: string): Promise<Cliente[]> {
  const q = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  const data = await apiFetch<{ clientes: Cliente[] }>(`/clientes${q}`);
  return data.clientes;
}

export async function createCliente(payload: CreateClientePayload): Promise<Cliente> {
  return apiFetch<Cliente>("/clientes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
  online: boolean;
};

type HealthBody = {
  status?: string;
  database?: string;
};

async function fetchHealth(): Promise<HealthBody | null> {
  try {
    const base = API_BASE.replace(/\/api\/v1\/?$/, "");
    const res = await fetch(`${base}/health`);
    if (!res.ok) return null;
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
    return { online: apiUp && dbUp };
  }

  try {
    const res = await fetch(`${API_BASE}/pos/productos`);
    if (res.ok) {
      return { online: true };
    }
  } catch {
    /* red caída */
  }

  return { online: false };
}

/** @deprecated Usar checkApiConnection */
export async function checkApiHealth(): Promise<boolean> {
  const s = await checkApiConnection();
  return s.online;
}
