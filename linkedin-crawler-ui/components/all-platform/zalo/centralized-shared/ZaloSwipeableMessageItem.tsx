import React, { useState, useRef } from "react";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ZaloSwipeableMessageItemProps {
  children: React.ReactNode;
  disabled?: boolean;
  onReply: () => void;
  className?: string;
  direction?: "left" | "right";
}

export function ZaloSwipeableMessageItem({
  children,
  disabled = false,
  onReply,
  className,
  direction = "left",
}: ZaloSwipeableMessageItemProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef<number | null>(null);

  const applyDragOffset = (diffX: number) => {
    const allowedDiff = direction === "right" ? Math.max(diffX, 0) : Math.min(diffX, 0);
    setOffsetX(direction === "right" ? Math.min(allowedDiff, 80) : Math.max(allowedDiff, -80));
  };

  const finishSwipe = () => {
    if (startXRef.current === null) return;
    setIsSwiping(false);
    const shouldReply = direction === "right" ? offsetX >= 40 : offsetX <= -40;
    if (shouldReply) onReply();
    setOffsetX(0);
    startXRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    startXRef.current = e.touches[0].clientX;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || disabled) return;
    applyDragOffset(e.touches[0].clientX - startXRef.current);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled || e.button !== 0) return;
    startXRef.current = e.clientX;
    setIsSwiping(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (startXRef.current === null || !isSwiping || disabled) return;
    applyDragOffset(e.clientX - startXRef.current);
  };

  const progress = Math.min(1, Math.abs(offsetX) / 45);

  return (
    <div
      className={cn("relative overflow-hidden touch-pan-y select-none", className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishSwipe}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={finishSwipe}
      onMouseLeave={finishSwipe}
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

      {offsetX !== 0 && (
        <div
          className={cn(
            "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-red-100 text-[#E3000F] shadow-sm transition-all pointer-events-none",
            direction === "right" ? "left-2" : "right-2",
          )}
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
