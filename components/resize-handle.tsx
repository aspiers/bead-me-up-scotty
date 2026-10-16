"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** A drag strip on a column's edge, like the drawer's. */
export function ResizeHandle({ label, onPointerDown, className }: {
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  className: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      className={cn("absolute top-0 z-20 h-full w-1.5 cursor-ew-resize hover:bg-[var(--brand)]/40", className)}
    />
  );
}
