"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import type { Parent, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { api } from "@/lib/api-client";
import { toastError } from "@/components/error-toast";
import { useApp } from "@/components/app-context";
import { BeadLink, splitBeadRefs } from "@/components/bead-link";

/**
 * Renders a bead description as GitHub-flavored markdown (headings, lists,
 * tables, code blocks, links, and task lists) via react-markdown + remark-gfm.
 *
 * Bead-specific behaviors layered on top:
 *  - Image refs `![alt](attachment://<beadId>/<file>)` resolve to the
 *    attachments API; external `http(s)` images pass through.
 *  - Task-list checkboxes (`- [ ]` / `- [x]`) are interactive when `onToggleTask`
 *    is provided; toggling reports the checkbox's document-order index so the
 *    caller can rewrite the source markdown (see lib/beads-view toggleTask).
 *  - Inline code naming a file in the project's repository (optionally with a
 *    `:line` or `:line:col` suffix) opens that file with the desktop handler.
 *  - IDs of beads in this project, in text or inline code but not in fenced
 *    blocks or existing links, open that bead in the drawer's trail.
 */
const IMG_PATTERN = "!\\[([^\\]]*)\\]\\((attachment:\\/\\/[^)\\s]+|https?:\\/\\/[^)\\s]+)\\)";
const SAFE_URL_PATTERN = /^(https?:|mailto:|attachment:\/\/)/i;
// Inline code that could be a path: no spaces or URL scheme, with a dot or slash.
const PATH_CANDIDATE = /`([^`\s]*[./][^`\s]*)`/g;

// Wraps matched IDs in a custom node that renders as `<a data-bead-id>`;
// fenced `code` nodes have no children to visit, and links keep their target.
function remarkBeadRefs(has: (id: string) => boolean) {
  const visit = (node: Parent) => {
    if (node.type === "link" || node.type === "linkReference") return;
    node.children = node.children.flatMap((child): RootContent[] => {
      if (child.type !== "text" && child.type !== "inlineCode") {
        if ("children" in child) visit(child);
        return [child];
      }
      return splitBeadRefs(child.value, has).map((part) =>
        typeof part === "string"
          ? { ...child, value: part }
          : ({
              type: "beadRef",
              data: { hName: "a", hProperties: { dataBeadId: part.id } },
              children: [{ ...child, value: part.id }],
            } as unknown as RootContent),
      );
    }) as typeof node.children;
  };
  return () => (tree: Root) => visit(tree);
}

function pathCandidates(text: string): string[] {
  const refs = [...text.matchAll(PATH_CANDIDATE)].map((m) => m[1]);
  return [...new Set(refs.filter((r) => !r.includes("://")))].sort();
}

function safeUrlTransform(url: string): string {
  return SAFE_URL_PATTERN.test(url) ? url : "";
}

export function DescriptionContent({
  text,
  projectId,
  className,
  onToggleTask,
}: {
  text: string;
  projectId: string;
  className?: string;
  onToggleTask?: (index: number) => void;
}) {
  // Fresh per render; react-markdown renders checkboxes in document order, so
  // this counter assigns each the index of its source task marker.
  const counter = { i: 0 };
  const candidates = pathCandidates(text);
  const { data: repoFiles } = useQuery({
    queryKey: ["repo-files", projectId, candidates],
    queryFn: () => api.files.existing(projectId, candidates),
    enabled: candidates.length > 0,
    staleTime: 30_000,
  });
  const fileSet = new Set(repoFiles?.files);
  const { index } = useApp();

  const components: Components = {
    a: ({ node, children, ...props }) => {
      const beadId = node?.properties?.dataBeadId;
      if (typeof beadId === "string") return <BeadLink id={beadId}>{children}</BeadLink>;
      return (
        <a {...props} target="_blank" rel="noopener noreferrer" className="text-[var(--brand)] underline">
          {children}
        </a>
      );
    },
    // Fenced blocks arrive with a trailing newline or highlighted spans, so
    // only inline code can match a file name exactly.
    code: ({ children, className }) =>
      typeof children === "string" && fileSet.has(children) ? (
        <button
          type="button"
          title="Open with the desktop's default app"
          onClick={() => api.files.open(projectId, children).catch(toastError)}
          className="cursor-pointer text-[var(--brand)] underline"
        >
          <code>{children}</code>
        </button>
      ) : (
        <code className={className}>{children}</code>
      ),
    img: ({ src, alt }) => {
      const raw = typeof src === "string" ? src : "";
      const resolved = raw.startsWith("attachment://") ? api.attachments.urlFor(projectId, raw) : raw;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved}
          alt={alt ?? ""}
          className="my-2 block max-h-[320px] max-w-full rounded-[8px] border border-border"
        />
      );
    },
    input: ({ type, checked }) => {
      if (type !== "checkbox") return null;
      const idx = counter.i++;
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled={!onToggleTask}
          onChange={() => onToggleTask?.(idx)}
          className="mr-[6px] translate-y-[2px] cursor-pointer disabled:cursor-default"
          style={{ accentColor: "var(--brand)" }}
        />
      );
    },
  };

  return (
    <div className={className}>
      <div className="bd-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBeadRefs((id) => index.has(id))]}
          // Colorize fenced code blocks; `ignoreMissing` keeps unknown languages
          // from throwing (they fall back to plain text). Themed via .hljs CSS.
          rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
          // Preserve attachment:// refs for local images, but reject executable
          // or local-file schemes when comments/descriptions render user text.
          // NB: the syntax-highlighting branch had swapped this for a pass-through
          // `(url) => url` so that attachment:// would resolve — but
          // safeUrlTransform already allows attachment://, so the swap bought
          // nothing and silently re-opened javascript:/file: URLs in rendered
          // user text. Keep the guard.
          urlTransform={safeUrlTransform}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Whether a description contains at least one renderable image ref. */
export function hasImageRef(text: string): boolean {
  return new RegExp(IMG_PATTERN).test(text);
}
