"use client";

import { Sprout } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Notice, Spinner } from "@/components/ui/controls";
import { ApiError, login, register } from "@/lib/api";

/** Only allow in-app redirects after sign-in. */
function safeNext(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/farms";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
      router.push(next);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(err.status === 401 ? "That email and password don't match. Try again." : err.message);
      } else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const fe = (k: string) =>
    fieldErrors[k]?.[0] && (
      <p role="alert" className="mt-1 text-sm text-red-700">
        {fieldErrors[k][0]}
      </p>
    );

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="card p-6 sm:p-8">
        <Sprout className="size-9 text-leaf-600" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-slate-600">
          {mode === "login" ? "Welcome back. Your saved fields are waiting." : "Save your fields and come back to your plans any time."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-semibold text-slate-800">
                Your name
              </label>
              <input id="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="input" placeholder="Sunil Perera" />
              {fe("name")}
            </div>
          )}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Email
            </label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" className="input" placeholder="name@gmail.com" />
            {fe("email")}
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="input"
              placeholder={mode === "register" ? "At least 8 characters" : ""}
            />
            {fe("password")}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Spinner /> : null}
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
            setFieldErrors({});
          }}
          className="mt-5 text-sm font-medium text-leaf-700 hover:underline"
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-slate-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
