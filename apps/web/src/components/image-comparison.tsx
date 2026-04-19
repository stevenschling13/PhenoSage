/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";
import { GripVertical } from "lucide-react";

interface ImageComparisonProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

export function ImageComparison({
  beforeImage,
  afterImage,
  beforeLabel = "Previous",
  afterLabel = "Current",
  className,
}: ImageComparisonProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;

    setSliderPosition(percentage);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      setIsDragging(true);
      handleMove(e.touches[0].clientX);
    }
  };

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) handleMove(e.clientX);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging && e.touches[0]) handleMove(e.touches[0].clientX);
    };

    if (isDragging) {
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("touchend", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove);
    }

    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full overflow-hidden rounded-[1rem] border border-border bg-background-subtle select-none",
        className,
      )}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      style={{ aspectRatio: "16/9" }}
    >
      <div className="absolute inset-0 select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterImage}
          alt={afterLabel}
          className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none"
          draggable="false"
        />
        <div className="absolute top-4 right-4 rounded-full bg-surface/80 backdrop-blur-sm px-3 py-1 text-xs font-semibold shadow-sm z-10 text-foreground">
          {afterLabel}
        </div>
      </div>

      <div
        className="absolute inset-0 select-none overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img
          src={beforeImage}
          alt={beforeLabel}
          className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none"
          draggable="false"
        />
        <div className="absolute top-4 left-4 rounded-full bg-surface/80 backdrop-blur-sm px-3 py-1 text-xs font-semibold shadow-sm z-10 text-foreground">
          {beforeLabel}
        </div>
      </div>

      <div
        className="absolute top-0 bottom-0 w-1 bg-surface cursor-ew-resize flex items-center justify-center shadow-[0_0_10px_rgba(0,0,0,0.5)] z-20 transition-transform duration-75"
        style={{ left: `${sliderPosition}%`, transform: "translateX(-50%)" }}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface border border-border shadow-md text-accent cursor-ew-resize hover:scale-110 active:scale-95 transition-transform">
          <GripVertical className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
