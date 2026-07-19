import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

const variants = {
  primary: "bg-zinc-100 text-zinc-950 hover:bg-white disabled:bg-zinc-700 disabled:text-zinc-400",
  secondary:
    "border border-white/10 bg-white/[0.04] text-zinc-100 hover:border-white/20 hover:bg-white/[0.08]",
  ghost: "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
} as const;

export function Button({ className, type = "button", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
