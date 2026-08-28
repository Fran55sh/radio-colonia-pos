import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { fetchAuthConfig, login } from "@/lib/api-client";
import {
  getAuthRequired,
  isAuthenticated,
  setAuthRequired,
  setToken,
} from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    let authRequired = getAuthRequired();
    if (authRequired === null) {
      try {
        const cfg = await fetchAuthConfig();
        setAuthRequired(cfg.auth_required);
        authRequired = cfg.auth_required;
      } catch {
        // sin red: mostrar login
        return;
      }
    }

    if (authRequired === false) {
      throw redirect({ to: "/" });
    }
    if (isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
  head: () => ({
    meta: [{ title: "Acceso — Radio Colonia Caja" }],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.trim().length < 4) {
      setError("Ingresá el PIN del local (mín. 4 caracteres)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await login(pin.trim());
      setAuthRequired(true);
      setToken(result.token, result.expires_at);
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg space-y-4"
      >
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Radio Colonia — Caja
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingresá el PIN compartido del local
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="pin" className="text-sm font-medium text-foreground">
            PIN
          </label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="text-center text-lg tracking-widest"
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive text-center" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
