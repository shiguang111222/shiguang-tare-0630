import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function InkInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full bg-ink-soft/70 border border-gold-soft/30 text-paper font-sub tracking-wider",
        "px-3 py-2.5 rounded-sm outline-none focus:border-cinnabar/60 focus:bg-ink-soft",
        "placeholder:text-paper/30 text-center transition-colors",
        className,
      )}
      {...props}
    />
  );
}
