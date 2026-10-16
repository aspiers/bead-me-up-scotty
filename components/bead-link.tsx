"use client";
import type * as React from "react";
import { useApp } from "@/components/app-context";

// Hyphenated IDs with optional `.N` child suffixes, not inside a path or word.
const BEAD_ID = /(?<![\w./-])[A-Za-z][\w]*(?:-[\w]+)+(?:\.\d+)*(?![\w-]|\.\w)/g;

/** Splits text into plain runs and `{ id }` for each ID `has` accepts. */
export function splitBeadRefs(text: string, has: (id: string) => boolean): (string | { id: string })[] {
  const parts: (string | { id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(BEAD_ID)) {
    if (!has(m[0])) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ id: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Opens the bead in the drawer's trail; modified clicks keep the browser's behaviour. */
export function BeadLink({ id, children }: { id: string; children: React.ReactNode }) {
  const { projectId, index, pushDetail } = useApp();
  return (
    <a
      href={`/p/${encodeURIComponent(projectId)}?bead=${encodeURIComponent(id)}`}
      title={index.get(id)?.title}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        pushDetail(id);
      }}
      className="text-[var(--brand)] underline"
    >
      {children}
    </a>
  );
}

/** Plain text, such as a title, with bead IDs linked. */
export function BeadText({ text }: { text: string }) {
  const { index } = useApp();
  return splitBeadRefs(text, (id) => index.has(id)).map((part, i) =>
    typeof part === "string" ? part : <BeadLink key={i} id={part.id}>{part.id}</BeadLink>,
  );
}
