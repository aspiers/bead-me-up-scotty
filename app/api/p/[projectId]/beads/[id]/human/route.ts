import { getStore } from "@/lib/store";
import { closeActor, getConfig } from "@/lib/config";
import { ok, fail } from "@/lib/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string; id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("respond"), text: z.string().min(1) }),
  z.object({ action: z.literal("dismiss") }),
]);

/**
 * Act on a "Needs You" (human-labelled) bead. By default this matches
 * `bd human respond`/`dismiss`: close the bead with reason "Responded" or
 * "Dismissed" and keep the `human` label, so dependent work reaches `bd ready`
 * and `bd human stats` still counts the answer.
 *
 * With `keepAnsweredOpen` set, the bead stays open for an agent that asked on
 * its own work bead (bead 0p0): respond posts the comment and removes the
 * label, dismiss only removes the label.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId, id } = await params;
    const store = await getStore(projectId);
    const cfg = getConfig();
    const body = bodySchema.parse(await req.json());

    if (body.action === "respond") await store.addComment(id, body.text, cfg.humanActor);
    const bead = cfg.keepAnsweredOpen
      ? await store.removeLabel(id, "human", cfg.humanActor)
      : await store.setStatus(
          id,
          "closed",
          // bd only lets a claimed bead's assignee close it; see closeActor.
          closeActor((await store.get(id))?.assignee),
          body.action === "respond" ? "Responded" : "Dismissed",
        );
    return ok(bead);
  } catch (e) {
    return fail(e);
  }
}
