import React, { useState, useRef } from "react";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ZaloSwipeableMessageItemProps {
  children: React.ReactNode;
  disabled?: boolean;
  onReply: () => void;
  className?: string;
}

export function ZaloSwipeableMessageItem({
  children,
  disabled,
  onReply,
  className,
}: ZaloSwipeableMessageItemProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    startXRef.current = e.touches[0].clientX;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || disabled) return;
    const currentX = e.touches[0].clientX;
    const diffX = currentX - startXRef.current;
    if (diffX < 0) {
      setOffsetX(Math.max(-80, diffX));
    } else {
      setOffsetX(0);
    }
  };

  const handleTouchEnd = () => {
    if (disabled) return;
    setIsSwiping(false);
    if (offsetX <= -40) {
      onReply();
    }
    setOffsetX(0);
    startXRef.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || e.button !== 0) return;
    startXRef.current = e.clientX;
    setIsSwiping(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (startXRef.current === null || !isSwiping || disabled) return;
    const diffX = e.clientX - startXRef.current;
    if (diffX < 0) {
      setOffsetX(Math.max(-80, diffX));
    } else {
      setOffsetX(0);
    }
  };

  const handleMouseUpOrLeave = () => {
    if (startXRef.current === null) return;
    setIsSwiping(false);
    if (offsetX <= -40) {
      onReply();
    }
    setOffsetX(0);
    startXRef.current = null;
  };

  const progress = Math.min(1, Math.abs(offsetX) / 45);

  return (
    <div
      className={cn("relative overflow-hidden touch-pan-y select-none", className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
    >
      <div
        className="transition-transform duration-75"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>

      {offsetX < 0 && (
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-8 w-8 rounded-full bg-red-100 text-[#E3000F] shadow-sm transition-all pointer-events-none"
          style={{
            opacity: progress,
            transform: `translateY(-50%) scale(${0.5 + progress * 0.5})`,
          }}
        >
          <MaterialIcon name="reply" className="text-base" />
        </div>
      )}
    </div>
  );
}
