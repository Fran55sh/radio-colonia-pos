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
  estado: "pendiente" | "enviando" | "desconocido" | "emitido" | "rechazado" | "error" | "anulado";
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
  puede_reintentar?: boolean;
  puede_eliminar?: boolean;
  requiere_conciliacion?: boolean;
  imp_total_enviado?: number | null;
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
  caja_sesion_id?: number;
};

export type CreateSaleResult = {
  venta_id: number;
  total: number;
  client_sale_id?: string;
  fiscal?: FiscalResult | null;
  caja_movimiento_id?: number;
  duplicada?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const VENTA_TIMEOUT_MS = Number(import.meta.env.VITE_VENTA_TIMEOUT_MS) || 45_000;

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

export type PosRole = "caja" | "admin";

export type LoginResult = {
  token: string;
  expires_at: string;
  role: PosRole;
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
  opts?: { skipAuthRedirect?: boolean; timeoutMs?: number },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer =
    opts?.timeoutMs != null ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    const body = data as { message?: string; error?: string; details?: unknown };

    if (res.status === 401) {
      if (!opts?.skipAuthRedirect) {
        handleUnauthorized();
      }
      throw new ApiError(
        401,
        body.error ?? "UNAUTHORIZED",
        body.message ?? "Sesión expirada o no autorizada",
        body.details,
      );
    }

    if (res.status === 403) {
      throw new ApiError(
        403,
        body.error ?? "FORBIDDEN",
        body.message ?? "No tenés permiso para esta acción",
        body.details,
      );
    }

    if (!res.ok) {
      throw new ApiError(
        res.status,
        body.error ?? "HTTP_ERROR",
        body.message ?? body.error ?? `Error HTTP ${res.status}`,
        body.details,
      );
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(0, "TIMEOUT", "La solicitud tardó demasiado");
    }
    throw new ApiError(0, "NETWORK", err instanceof Error ? err.message : "Error de red");
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      const row = t as {
        minQty?: number;
        min_qty?: number;
        unitPrice?: number;
        unit_price?: number;
      };
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

export type ListClientesResponse = {
  items: Cliente[];
  total: number;
};

export async function fetchClientes(search?: string): Promise<ListClientesResponse> {
  const q = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  return apiFetch<ListClientesResponse>(`/clientes${q}`);
}

export async function createCliente(payload: CreateClientePayload): Promise<Cliente> {
  return apiFetch<Cliente>("/clientes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createVenta(payload: CreateSalePayload): Promise<CreateSaleResult> {
  return apiFetch<CreateSaleResult>(
    "/pos/ventas",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { timeoutMs: VENTA_TIMEOUT_MS },
  );
}

export async function retryFiscal(ventaId: number): Promise<{ fiscal: FiscalResult | null }> {
  return apiFetch<{ fiscal: FiscalResult | null }>(`/fiscal/ventas/${ventaId}/reintentar`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteVentaSinFactura(
  ventaId: number,
): Promise<{ ok: boolean; venta_id: number }> {
  return apiFetch<{ ok: boolean; venta_id: number }>(`/fiscal/ventas/${ventaId}/eliminar`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchFiscalPendientes(): Promise<{
  pendientes: Array<FiscalResult & { venta_id: number }>;
}> {
  return apiFetch(`/fiscal/pendientes`);
}

export type VentaResumen = {
  id: number;
  created_at: string;
  total: number;
  medio_pago: string;
  estado: string;
  cliente: string | null;
  fiscal_estado: string | null;
  comprobante: string | null;
  pdf_disponible: boolean;
};

export type VentaDetalle = {
  venta: {
    id: number;
    created_at: string;
    total: number;
    neto_gravado: number;
    iva_total: number;
    exento: number;
    medio_pago: string;
    estado: string;
    cliente: {
      id: number;
      nombre: string | null;
      razon_social: string | null;
      documento: string | null;
      domicilio_fiscal: string | null;
      email: string | null;
      telefono: string | null;
      condicion_iva_receptor_id: number | null;
    } | null;
  };
  lineas: Array<{
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    alicuota_iva: number;
    neto: number;
    iva: number;
    total: number;
  }>;
  fiscal: FiscalResult | null;
  pdf_disponible: boolean;
};

export async function fetchVentas(limit = 40): Promise<{ ventas: VentaResumen[] }> {
  return apiFetch(`/pos/ventas?limit=${limit}`);
}

export async function fetchVentaDetalle(ventaId: number): Promise<VentaDetalle> {
  return apiFetch(`/pos/ventas/${ventaId}`);
}

export async function fetchDistribucionFactura(ventaId: number): Promise<{
  pdf_disponible: boolean;
  archivo: string | null;
  email_sugerido: string | null;
  telefono: string | null;
  email_configurado: boolean;
  cae: string | null;
}> {
  return apiFetch(`/fiscal/ventas/${ventaId}/distribucion`);
}

export async function fetchFacturaPdf(ventaId: number): Promise<{ blob: Blob; filename: string }> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/fiscal/ventas/${ventaId}/pdf`, { headers });
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "UNAUTHORIZED", "Sesión expirada o no autorizada");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(
      res.status,
      data.error ?? "HTTP_ERROR",
      data.message ?? "No se pudo obtener el PDF",
    );
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return { blob, filename: match?.[1] ?? `Factura-${ventaId}.pdf` };
}

export async function enviarFacturaEmail(
  ventaId: number,
  body: { to: string; subject?: string; body?: string },
): Promise<{ ok: true; destino: string }> {
  return apiFetch(`/fiscal/ventas/${ventaId}/email`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function crearEnlaceFactura(
  ventaId: number,
): Promise<{ url: string; expires_at: string }> {
  return apiFetch(`/fiscal/ventas/${ventaId}/enlace`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function syncOfflineVentas(ventas: CreateSalePayload[]): Promise<OfflineBatchResult> {
  return apiFetch<OfflineBatchResult>("/pos/ventas/offline-batch", {
    method: "POST",
    body: JSON.stringify({ ventas }),
  });
}

/* —— Control de caja —— */

export type CajaOpeningBalance = {
  payment_method: string;
  amount: number;
};

export type CajaSesion = {
  id: number;
  puesto: string;
  estado: "abierta" | "cerrada" | "cancelada";
  opened_at: string;
  opened_by_label: string | null;
  closed_at: string | null;
  closed_by_label: string | null;
  notes: string | null;
  saldos?: CajaOpeningBalance[];
};

export type CajaResumen = {
  sesion_id: number;
  puesto: string;
  estado: string;
  expected_cash: number;
  by_payment_method: Record<
    string,
    { opening: number; ingresos: number; egresos: number; net: number }
  >;
};

export type CajaMovimiento = {
  id: number;
  sesion_id: number;
  occurred_at: string;
  tipo: string;
  direccion: string;
  amount: number;
  payment_method: string;
  description: string | null;
  source_type: string;
  source_id: string | null;
  estado: string;
  post_cierre_offline: boolean;
};

/** Returns null when no open session (404). */
export async function fetchSesionActual(puesto = "Caja 01"): Promise<CajaSesion | null> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const q = `?puesto=${encodeURIComponent(puesto)}`;
  const res = await fetch(`${API_BASE}/caja/sesiones/actual${q}`, { headers });
  if (res.status === 404) return null;
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
  return data as CajaSesion;
}

export async function abrirSesionCaja(input: {
  puesto?: string;
  saldos: CajaOpeningBalance[];
  notes?: string;
}): Promise<CajaSesion> {
  return apiFetch<CajaSesion>("/caja/sesiones/abrir", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchCajaResumen(sesionId: number): Promise<CajaResumen> {
  return apiFetch<CajaResumen>(`/caja/sesiones/${sesionId}/resumen`);
}

export async function crearMovimientoCaja(input: {
  sesion_id: number;
  tipo: "ingreso_manual" | "retiro" | "gasto";
  amount: number;
  payment_method: string;
  description?: string;
  admin_pin?: string;
}): Promise<{ movimiento: CajaMovimiento; warning?: string }> {
  return apiFetch("/caja/movimientos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cerrarSesionCaja(
  sesionId: number,
  input: {
    counted_cash: number;
    categoria?: string;
    observations?: string;
    admin_pin?: string;
  },
): Promise<{
  sesion: CajaSesion;
  diferencia: {
    expected_cash: number;
    counted_cash: number;
    difference: number;
  };
}> {
  return apiFetch(`/caja/sesiones/${sesionId}/cerrar`, {
    method: "POST",
    body: JSON.stringify(input),
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
