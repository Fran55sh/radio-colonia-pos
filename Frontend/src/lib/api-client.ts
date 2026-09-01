import { clearToken, getToken } from "./auth-session";
import { normalizeTiers } from "./quantity-pricing";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ProductoCaja = {
  variant_id?: string;
  codigo_interno: string;
  nombre: string;
  precio_venta: number;
  stock: number;
  alicuota_iva: number;
  price_tiers?: Array<{ minQty: number; unitPrice: number }>;
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
  precio_unitario?: number;
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

export type LoginResult = {
  token: string;
  expires_at: string;
};

function handleUnauthorized(): void {
  clearToken();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  opts?: { skipAuthRedirect?: boolean },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    if (!opts?.skipAuthRedirect) {
      handleUnauthorized();
    }
    const message =
      (data as { message?: string }).message ?? "Sesión expirada o no autorizada";
    throw new Error(message);
  }

  if (!res.ok) {
    const message =
      (data as { message?: string }).message ??
      (data as { error?: string }).error ??
      `Error HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export async function fetchAuthConfig(): Promise<{ auth_required: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) return { auth_required: true };
    return (await res.json()) as { auth_required: boolean };
  } catch {
    // Si no hay red, asumir auth requerida (login mostrará error de conexión)
    return { auth_required: true };
  }
}

export async function login(pin: string): Promise<LoginResult> {
  return apiFetch<LoginResult>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ pin }),
    },
    { skipAuthRedirect: true },
  );
}

function normalizeProducto(p: ProductoCaja): ProductoCaja {
  const raw = p.price_tiers ?? [];
  const tiers = normalizeTiers(
    raw.map((t) => {
      const row = t as { minQty?: number; min_qty?: number; unitPrice?: number; unit_price?: number };
      return {
        minQty: Number(row.minQty ?? row.min_qty ?? 0),
        unitPrice: Number(row.unitPrice ?? row.unit_price ?? 0),
      };
    }),
  );
  return { ...p, price_tiers: tiers };
}

export async function fetchProductos(): Promise<ProductoCaja[]> {
  const data = await apiFetch<{ productos: ProductoCaja[] }>("/pos/productos");
  return data.productos.map(normalizeProducto);
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
  // No usar /pos/productos como ping (catálogo completo).
  return { online: false };
}

/** @deprecated Usar checkApiConnection */
export async function checkApiHealth(): Promise<boolean> {
  const s = await checkApiConnection();
  return s.online;
}

/* —— Compras / importación factura PDF —— */

export type NormalizedInvoiceItem = {
  codigo_proveedor: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  importe: number;
  variant_id: string | null;
  sku: string | null;
  producto_nombre: string | null;
  encontrado: boolean;
  requiere_revision: boolean;
};

export type NormalizedInvoice = {
  proveedor: {
    cuit: string | null;
    razon_social: string | null;
    proveedor_id: string | null;
  };
  factura: {
    tipo: string | null;
    punto_venta: string | null;
    numero: string | null;
    fecha: string | null;
    condicion_iva?: string | null;
  };
  items: NormalizedInvoiceItem[];
  totales: {
    subtotal: number | null;
    iva: number | null;
    total: number | null;
  };
};

export type ImportacionValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  item_index?: number;
};

export type CompraImportacion = {
  id: number;
  estado: string;
  proveedor_id: string | null;
  proveedor_nombre?: string | null;
  pdf_original_name: string | null;
  pdf_size: number | null;
  extracted_json: NormalizedInvoice;
  review_json: NormalizedInvoice;
  warnings: unknown;
  error_message: string | null;
  orden_id: number | null;
  factura_id: number | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  executed_by: string | null;
  stats: {
    total_items: number;
    matched_items: number;
    pending_items: number;
  };
  validation: {
    can_execute: boolean;
    issues: ImportacionValidationIssue[];
  };
};

export type EjecutarImportacionResult = {
  importacion_id: number;
  orden_id: number;
  factura_id: number;
  items_procesados: number;
};

export type OrdenCompraListItem = {
  id: number;
  estado: string;
  origen: string;
  observaciones: string | null;
  created_at: string;
  recibido_at: string | null;
  proveedor_nombre: string;
  lineas_count: number;
};

async function apiFetchFormData<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error((data as { message?: string }).message ?? "Sesión expirada");
  }
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message ??
        (data as { error?: string }).error ??
        `Error HTTP ${res.status}`,
    );
  }
  return data as T;
}

export async function uploadFacturaPdf(file: File): Promise<CompraImportacion> {
  const form = new FormData();
  form.append("file", file);
  return apiFetchFormData<CompraImportacion>("/compras/importaciones", form);
}

export async function fetchImportaciones(): Promise<CompraImportacion[]> {
  const data = await apiFetch<{ importaciones: CompraImportacion[] }>(
    "/compras/importaciones",
  );
  return data.importaciones;
}

export async function fetchImportacion(id: number): Promise<CompraImportacion> {
  return apiFetch<CompraImportacion>(`/compras/importaciones/${id}`);
}

export async function patchImportacionReview(
  id: number,
  review_json: NormalizedInvoice,
): Promise<CompraImportacion> {
  return apiFetch<CompraImportacion>(`/compras/importaciones/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ review_json }),
  });
}

export async function ejecutarImportacion(
  id: number,
): Promise<EjecutarImportacionResult> {
  return apiFetch<EjecutarImportacionResult>(`/compras/importaciones/${id}/ejecutar`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelarImportacion(id: number): Promise<CompraImportacion> {
  return apiFetch<CompraImportacion>(`/compras/importaciones/${id}/cancelar`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchOrdenesCompra(): Promise<OrdenCompraListItem[]> {
  const data = await apiFetch<{ ordenes: OrdenCompraListItem[] }>("/compras/ordenes");
  return data.ordenes;
}
