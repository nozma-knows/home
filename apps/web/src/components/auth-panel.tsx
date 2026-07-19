"use client";

import { Button, Card } from "@home/ui";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function AuthPanel() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? email.split("@")[0] ?? "Home user");

    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, name, password })
        : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      setPending(false);
      return;
    }

    window.location.reload();
  }

  return (
    <Card className="w-full max-w-md p-6 sm:p-8">
      <div className="mb-8">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-emerald-400">
          Private workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          {mode === "sign-in" ? "Welcome home" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Your work graph, agent sessions, and automations will live here.
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        {mode === "sign-up" ? (
          <label className="block space-y-2">
            <span className="text-xs font-medium text-zinc-400">Name</span>
            <input
              autoComplete="name"
              className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
              name="name"
              required
            />
          </label>
        ) : null}
        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-400">Email</span>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
            name="email"
            required
            type="email"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-xs font-medium text-zinc-400">Password</span>
          <input
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>

        {error ? (
          <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <Button className="w-full gap-2" disabled={pending} type="submit">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {mode === "sign-in" ? "Sign in" : "Create account"}
          {!pending ? <ArrowRight className="size-4" /> : null}
        </Button>
      </form>

      <button
        className="mt-5 w-full text-center text-sm text-zinc-500 transition hover:text-zinc-300"
        onClick={() => {
          setError(undefined);
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
        }}
        type="button"
      >
        {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </Card>
  );
}
