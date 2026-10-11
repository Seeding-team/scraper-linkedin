"use client";

import { formatThousands, parseThousands } from "@/lib/format-thousands";

/** Input so tien co dau cham ngan cach hang nghin trong luc go (20000 -> "20.000"). */
export function ThousandsInput({
  value,
  onChange,
  min = 0,
  className,
  placeholder,
  required,
}: {
  value: number | string | null | undefined;
  onChange: (n: number) => void;
  min?: number;
  className?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      required={required}
      value={formatThousands(value)}
      onChange={(e) => {
        const n = parseThousands(e.target.value);
        onChange(min != null ? Math.max(min, n) : n);
      }}
      className={className}
      placeholder={placeholder}
    />
  );
}
