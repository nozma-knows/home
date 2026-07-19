import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-zinc-900/60 shadow-2xl shadow-black/20 backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
