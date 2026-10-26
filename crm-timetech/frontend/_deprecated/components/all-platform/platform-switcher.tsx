"use client";

import { useState } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { cn } from "@/lib/utils";
import type { FeedPlatform } from "@/types/unified.types";

interface PlatformSwitcherProps {
  value: FeedPlatform;
  onChange: (platform: FeedPlatform) => void;
}

export function PlatformSwitcher({ value, onChange }: PlatformSwitcherProps) {
  const platforms: { value: FeedPlatform; label: string; icon: React.ReactNode }[] = [
    {
      value: "facebook",
      label: "Facebook",
      icon: <FaFacebook className={cn("text-[13px] transition-colors", value === "facebook" ? "text-white" : "text-[#1877F2]")} />,
    },
    {
      value: "linkedin",
      label: "LinkedIn",
      icon: <FaLinkedin className={cn("text-[13px] transition-colors", value === "linkedin" ? "text-white" : "text-[#0077B5]")} />,
    },
  ];

  return (
    <div className="mb-4 flex gap-2">
      {platforms.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors cursor-pointer",
            value === p.value
              ? "border-primary bg-primary text-white"
              : "border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
          )}
        >
          {p.icon}
          {p.label}
        </button>
      ))}
    </div>
  );
}
