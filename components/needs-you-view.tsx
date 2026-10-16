"use client";
import * as React from "react";
import { GateApproval } from "@/components/gate-approval";
import { useApp } from "@/components/app-context";
import { useRespondHuman, useDismissHuman } from "@/hooks/use-beads";
import { Icon, typeIconName } from "@/components/icons";
import { OriginBadge, PriorityChip } from "@/components/board/bead-card";
import { beadOrigin } from "@/lib/attribution";
import {
  needsHuman,
  readyHumanGate,
  gateBlocks,
  typeColor,
  relTime,
  fmtDateTime,
} from "@/lib/beads-view";
import { reviewLinks } from "@/lib/review-links";
import { api } from "@/lib/api-client";
import { DescriptionContent } from "@/components/description-content";
import type { Bead } from "@/lib/schema";

/**
 * Mission Control — "Needs You" decision inbox. Surfaces two kinds of items
 * waiting on a person:
 *   1. Beads an agent flagged for a decision (the `human` label, via `bd human`)
 *      — answered inline (comment + clear the flag) or dismissed.
 *   2. Human-approval gates (`bd gate create --type human`) whose blockers are
 *      resolved — approved (closed, which unblocks dependents) from here so they
 *      don't sit invisibly waiting on the board (bead 8qc / gh-6).
 */
export function NeedsYouView() {
  const { beads, index, selectedBeadId } = useApp();
  const expansion = useCardExpansion(true);
  const inbox = React.useMemo(() => beads.filter(needsHuman), [beads]);
  const gates = React.useMemo(
    () => beads.filter((b) => readyHumanGate(b, index)),
    [beads, index],
  );
  const total = inbox.length + gates.length;
  // Answering removes a card, so the drawer moves on to the card after it (or
  // before it, if it was last), in display order.
  const order = [...gates, ...inbox].map((b) => b.id);
  const nextAfter = (id: string) => {
    const i = order.indexOf(id);
    return order[i + 1] ?? order[i - 1] ?? null;
  };

  return (
    <div className="flex h-full flex-col">
      <NeedsYouHeader title="Needs You" total={total}>
        <span className="flex-1" />
        {total > 0 && <ExpandCollapseAll onChange={expansion.setAll} />}
      </NeedsYouHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {total === 0 ? (
          <NeedsYouEmpty />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {gates.map((g) => (
              <NeedsYouItem key={g.id} bead={g} gate
                open={expansion.isOpen(g.id, selectedBeadId === g.id)}
                onOpenChange={(o) => expansion.setOpen(g.id, o)} />
            ))}
            {inbox.map((b) => (
              <NeedsYouItem key={b.id} bead={b} nextId={nextAfter(b.id)}
                open={expansion.isOpen(b.id, selectedBeadId === b.id)}
                onOpenChange={(o) => expansion.setOpen(b.id, o)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The full description, rendered as markdown like the detail drawer: the
 * person is deciding from this card, so a clamped plain-text excerpt hides
 * the context they need.
 */
function CardDescription({ bead }: { bead: Bead }) {
  const { projectId } = useApp();
  if (!bead.description) return null;
  return (
    <DescriptionContent
      text={bead.description}
      projectId={projectId}
      className="mb-3 text-[12.5px] leading-[1.5] text-[var(--text-2)]"
    />
  );
}

function ReviewLinks({ bead }: { bead: Bead }) {
  const { projectId } = useApp();
  const links = reviewLinks(bead);
  if (!links.length) return (
    <p className="mb-3 text-[12px] text-[var(--text-3)]">
      No supporting links found. Review the bead details before deciding.
    </p>
  );
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-semibold text-[var(--text-3)]">Links &amp; attachments</div>
      <div data-review-links className="flex flex-wrap gap-[6px]">
        {links.map(link => {
          const attachment = link.startsWith("attachment://");
          const href = attachment ? api.attachments.urlFor(projectId, link) : link;
          const label = attachment || link.startsWith("/api/p/")
            ? `Attachment: ${link.split("/").at(-1)}` : link.replace(/^https?:\/\//i, "");
          return (
            <a key={link} href={href} target="_blank" rel="noopener noreferrer" title={href}
              className="flex h-8 max-w-[300px] items-center gap-[6px] rounded-[9px] border border-border bg-[var(--surface-2)] px-[11px] text-[12px] text-[var(--brand)] hover:underline">
              <Icon name="link" size={13} className="flex-shrink-0" />
              <span className="truncate">{label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A ready human-approval gate. "Approve" closes the gate (via `bd close`), which
 * resolves it and unblocks every bead depending on it.
 */
function GateCard({ gate }: { gate: Bead }) {
  const { beads, openDetail, selectedBeadId } = useApp();
  const peek = useCardPeek(gate.id);
  const blocks = React.useMemo(() => gateBlocks(gate.id, beads), [gate.id, beads]);

  return (
    <div
      role="button"
      tabIndex={0}
      data-keyboard-bead-id={gate.id}
      aria-current={selectedBeadId === gate.id ? "true" : undefined}
      {...peek}
      className={`rounded-[12px] border bg-[var(--surface)] p-4 focus-visible:outline-none ${
        selectedBeadId === gate.id
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/30"
          : "border-border"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon name="gate" size={15} style={{ color: "var(--brand)" }} />
        <button
          onClick={() => openDetail(gate.id)}
          className="font-mono text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
        >
          {gate.id}
        </button>
        <span className="rounded-full border border-border bg-[var(--surface-2)] px-2 py-[1px] text-[10px] font-[650] uppercase tracking-wide text-[var(--text-2)]">
          Approval gate
        </span>
        <span className="flex-1" />
        <span title={fmtDateTime(gate.updated_at)} className="text-[11px] text-[var(--text-3)]">
          {relTime(gate.updated_at)}
        </span>
      </div>
      <button
        onClick={() => openDetail(gate.id)}
        className="mb-2 block text-left text-[14px] font-[600] leading-snug text-[var(--text)] hover:underline"
      >
        {gate.title}
      </button>
      <CardDescription bead={gate} />
      <ReviewLinks bead={gate} />
      {blocks.length > 0 && (
        <p className="mb-3 text-[12px] leading-[1.5] text-[var(--text-2)]">
          Approving unblocks{" "}
          {blocks.map((b, i) => (
            <React.Fragment key={b.id}>
              {i > 0 && ", "}
              <button
                onClick={() => openDetail(b.id)}
                className="font-mono text-[var(--text)] hover:underline"
              >
                {b.id}
              </button>
            </React.Fragment>
          ))}
          .
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <GateApproval id={gate.id} />
      </div>
    </div>
  );
}

function NeedsYouCard({ bead, nextId }: { bead: Bead; nextId: string | null }) {
  const { humanAllowlist, openDetail, readOnly, replaceDetail, selectedBeadId } = useApp();
  const peek = useCardPeek(bead.id);
  const respond = useRespondHuman((id) => replaceDetail(id, nextId));
  const dismiss = useDismissHuman();
  const [text, setText] = React.useState("");
  const o = beadOrigin(bead, humanAllowlist);
  const busy = respond.isPending || dismiss.isPending;

  return (
    <div
      role="button"
      tabIndex={0}
      data-keyboard-bead-id={bead.id}
      aria-current={selectedBeadId === bead.id ? "true" : undefined}
      {...peek}
      className={`rounded-[12px] border bg-[var(--surface)] p-4 focus-visible:outline-none ${
        selectedBeadId === bead.id
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/30"
          : "border-border"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon name={typeIconName(bead.issue_type)} size={14} style={{ color: typeColor(bead.issue_type) }} />
        <button
          onClick={() => openDetail(bead.id)}
          className="font-mono text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
        >
          {bead.id}
        </button>
        <OriginBadge origin={o} title={o === "human" ? "Human" : "Agent"} />
        <span className="flex-1" />
        <span title={fmtDateTime(bead.updated_at)} className="text-[11px] text-[var(--text-3)]">
          {relTime(bead.updated_at)}
        </span>
      </div>
      <button
        onClick={() => openDetail(bead.id)}
        className="mb-2 block text-left text-[14px] font-[600] leading-snug text-[var(--text)] hover:underline"
      >
        {bead.title}
      </button>
      <CardDescription bead={bead} />
      <ReviewLinks bead={bead} />
      <textarea
        disabled={readOnly}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Answer the agent's question… (posts a comment; the bead stays open)"
        className="mb-2 w-full resize-y rounded-[9px] border border-border bg-[var(--surface-2)] p-[9px_11px] text-[13px] leading-[1.5] text-[var(--text)] outline-none focus:border-[var(--brand)]"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          disabled={readOnly || busy}
          onClick={() => dismiss.mutate({ id: bead.id })}
          className="h-8 rounded-lg border border-border bg-[var(--surface-2)] px-3 text-[12.5px] font-[550] text-[var(--text-2)] hover:bg-[var(--surface-3)] disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          disabled={readOnly || busy || !text.trim()}
          onClick={() => respond.mutate({ id: bead.id, text: text.trim() })}
          className="flex h-8 items-center gap-[6px] rounded-lg px-3 text-[12.5px] font-[550] text-white disabled:opacity-50"
          style={{ background: "var(--brand)" }}
        >
          <Icon name="check" size={14} /> Respond
        </button>
      </div>
    </div>
  );
}

/**
 * Show a card's bead beside the list while the drawer can dock: on a click
 * anywhere but the card's own controls, and on focusing a text field in it.
 */
function useCardPeek(id: string) {
  const { peekDetail, selectBead } = useApp();
  return {
    onClick: (e: React.MouseEvent) => {
      if (!(e.target as Element).closest("a, button, input, textarea, select")) peekDetail(id);
    },
    onFocus: (e: React.FocusEvent) => {
      selectBead(id);
      if ((e.target as Element).matches("input, textarea")) peekDetail(id);
    },
  };
}

// The all-projects page renders these same pieces, one AppProvider per project.
export { GateCard, NeedsYouCard };

export function NeedsYouHeader({ title, total, children }: {
  title: string;
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-6 py-4">
      <Icon name="user" size={18} className="text-[var(--text-2)]" />
      <h1 className="text-[15px] font-[650]">{title}</h1>
      <span className="text-[12px] text-[var(--text-3)]">
        · {total === 0 ? "nothing waiting" : `${total} waiting on you`}
      </span>
      {children}
    </div>
  );
}

export function NeedsYouEmpty() {
  return (
    <div className="p-10 text-center text-[13px] text-[var(--text-3)]">
      🎉 Nothing needs you right now. Agents flag beads here with{" "}
      <span className="font-mono">bd human</span>, and human-approval gates
      (<span className="font-mono">bd gate create --type human</span>) show
      up once their blockers clear.
    </div>
  );
}

/**
 * Which cards are open. "selected" opens only the selected card; Expand all /
 * Collapse all replace that default, and a card's own toggle overrides it.
 */
export function useCardExpansion(initial: boolean | "selected") {
  const [state, setState] = React.useState({ all: initial, overrides: new Map<string, boolean>() });
  const isOpen = (key: string, selected: boolean) =>
    state.overrides.get(key) ?? (state.all === "selected" ? selected : state.all);
  const setOpen = (key: string, open: boolean) =>
    setState((s) => ({ ...s, overrides: new Map(s.overrides).set(key, open) }));
  const setAll = (all: boolean) => setState({ all, overrides: new Map() });
  return { isOpen, setOpen, setAll };
}

export function ExpandCollapseAll({ onChange }: { onChange: (open: boolean) => void }) {
  const cls = "h-8 rounded-[8px] border border-border bg-[var(--surface-2)] px-3 text-[12px] text-[var(--text-2)] hover:bg-[var(--surface-3)]";
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(true)} className={cls}>Expand all</button>
      <button type="button" onClick={() => onChange(false)} className={cls}>Collapse all</button>
    </div>
  );
}

/** A Needs You card, or its one-row summary while collapsed. */
export function NeedsYouItem({ bead, gate = false, nextId = null, open, onOpenChange, project }: {
  bead: Bead;
  gate?: boolean;
  nextId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown on the summary row when the list mixes projects. */
  project?: React.ReactNode;
}) {
  const { selectedBeadId, selectBead } = useApp();
  const selected = selectedBeadId === bead.id;
  return (
    <div className="flex items-start gap-1">
      <button
        type="button"
        aria-label={`${open ? "Collapse" : "Expand"} ${bead.id}`}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] ${open ? "mt-4" : "mt-[7px]"}`}
      >
        <Icon name="chevron" size={15} className={open ? "" : "-rotate-90"} />
      </button>
      <div className="min-w-0 flex-1">
        {open ? (
          gate ? <GateCard gate={bead} /> : <NeedsYouCard bead={bead} nextId={nextId} />
        ) : (
          <button
            type="button"
            data-keyboard-bead-id={bead.id}
            aria-current={selected ? "true" : undefined}
            onFocus={() => selectBead(bead.id)}
            onClick={() => onOpenChange(true)}
            title={bead.title}
            className={`flex w-full items-center gap-2 rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-left hover:bg-[var(--surface-2)] focus-visible:outline-none ${
              selected ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/30" : "border-border"
            }`}
          >
            {gate ? (
              <Icon name="gate" size={14} style={{ color: "var(--brand)" }} />
            ) : (
              <Icon name={typeIconName(bead.issue_type)} size={14} style={{ color: typeColor(bead.issue_type) }} />
            )}
            <span className="font-mono text-[11px] text-[var(--text-3)]">{bead.id}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-[550] text-[var(--text)]">{bead.title}</span>
            {project && <span className="max-w-[160px] truncate text-[11.5px] text-[var(--text-2)]">{project}</span>}
            <PriorityChip p={bead.priority} />
            <span title={fmtDateTime(bead.updated_at)} className="w-[52px] flex-shrink-0 text-right text-[11px] text-[var(--text-3)]">
              {relTime(bead.updated_at)}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
