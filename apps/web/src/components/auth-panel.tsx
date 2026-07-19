"use client";

import { Button, Card } from "@home/ui";
import { ArrowLeft, ArrowRight, LoaderCircle, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

type PendingAction = "google" | "send-otp" | "verify-otp";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.39 13.86a6.02 6.02 0 0 1 0-3.72V7.52H3.04a10 10 0 0 0 0 8.96l3.35-2.62Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.01c1.47 0 2.79.5 3.82 1.49l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<PendingAction>();

  async function signInWithGoogle() {
    setError(undefined);
    setPending("google");

    const result = await authClient.signIn.social({
      callbackURL: window.location.origin,
      provider: "google",
    });

    if (result.error) {
      setError(result.error.message ?? "Google sign-in failed");
      setPending(undefined);
    }
  }

  async function sendCode(nextEmail: string) {
    setError(undefined);
    setPending("send-otp");

    const result = await authClient.emailOtp.sendVerificationOtp({
      email: nextEmail,
      type: "sign-in",
    });

    if (result.error) {
      setError(result.error.message ?? "We could not send a sign-in code");
      setPending(undefined);
      return;
    }

    setEmail(nextEmail);
    setCodeSent(true);
    setPending(undefined);
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await sendCode(String(form.get("email") ?? "").trim());
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending("verify-otp");

    const form = new FormData(event.currentTarget);
    const otp = String(form.get("otp") ?? "").trim();
    const result = await authClient.signIn.emailOtp({
      email,
      name: email.split("@")[0] || "Home user",
      otp,
    });

    if (result.error) {
      setError(result.error.message ?? "That code is invalid or has expired");
      setPending(undefined);
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
          {codeSent ? "Check your email" : "Welcome home"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {codeSent
            ? `Enter the six-digit code sent to ${email}.`
            : "Sign in with Google or receive a one-time code by email."}
        </p>
      </div>

      {!codeSent ? (
        <>
          <Button
            className="w-full gap-2"
            disabled={pending !== undefined}
            onClick={() => void signInWithGoogle()}
            variant="secondary"
          >
            {pending === "google" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            Continue with Google
          </Button>

          <div aria-hidden="true" className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs uppercase tracking-[0.16em] text-zinc-600">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form className="space-y-4" onSubmit={requestCode}>
            <label className="block space-y-2">
              <span className="text-xs font-medium text-zinc-400">Email</span>
              <input
                autoComplete="email"
                className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
                defaultValue={email}
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>

            {error ? <AuthError message={error} /> : null}

            <Button className="w-full gap-2" disabled={pending !== undefined} type="submit">
              {pending === "send-otp" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              Email me a code
              {pending !== "send-otp" ? <ArrowRight className="size-4" /> : null}
            </Button>
          </form>
        </>
      ) : (
        <form className="space-y-4" onSubmit={verifyCode}>
          <label className="block space-y-2">
            <span className="text-xs font-medium text-zinc-400">Verification code</span>
            <input
              autoComplete="one-time-code"
              className="h-12 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-center font-mono text-xl tracking-[0.35em] text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
              inputMode="numeric"
              maxLength={6}
              name="otp"
              pattern="[0-9]{6}"
              placeholder="000000"
              required
            />
          </label>

          {error ? <AuthError message={error} /> : null}

          <Button className="w-full gap-2" disabled={pending !== undefined} type="submit">
            {pending === "verify-otp" ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Verify and sign in
            {pending !== "verify-otp" ? <ArrowRight className="size-4" /> : null}
          </Button>

          <div className="flex items-center justify-between gap-3">
            <button
              className="inline-flex items-center gap-1 text-xs text-zinc-500 transition hover:text-zinc-300"
              disabled={pending !== undefined}
              onClick={() => {
                setCodeSent(false);
                setError(undefined);
              }}
              type="button"
            >
              <ArrowLeft className="size-3" />
              Change email
            </button>
            <button
              className="text-xs text-zinc-500 transition hover:text-zinc-300"
              disabled={pending !== undefined}
              onClick={() => void sendCode(email)}
              type="button"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function AuthError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
      {message}
    </p>
  );
}
