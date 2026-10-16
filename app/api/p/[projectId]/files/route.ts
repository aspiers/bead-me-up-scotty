import { z } from "zod";
import { getProject, ConfigError } from "@/lib/config";
import { crossOrigin, ok, fail } from "@/lib/api";
import { resolveRepoFile, openOnDesktop } from "@/lib/repo-files";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

/** The project's repository root; the demo project has none. */
async function projectRoot(params: Ctx["params"]): Promise<string | null> {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) throw new ConfigError(`Unknown project: ${projectId}`, "unknown_project");
  return project.path;
}

/** Which of the `path` query values name regular files inside the repository. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const root = await projectRoot(params);
    const refs = new URL(req.url).searchParams.getAll("path");
    const files = root === null ? [] : refs.filter((ref) => {
      try {
        resolveRepoFile(root, ref);
        return true;
      } catch {
        return false;
      }
    });
    return ok({ files });
  } catch (e) {
    return fail(e);
  }
}

const openInput = z.object({ path: z.string() });

/** Open a repository file with the desktop's handler. */
export async function POST(req: Request, { params }: Ctx) {
  const rejected = crossOrigin(req);
  if (rejected) return rejected;
  try {
    const root = await projectRoot(params);
    if (root === null) return ok({ error: "This project has no repository on disk" }, 404);
    const file = resolveRepoFile(root, openInput.parse(await req.json()).path);
    await openOnDesktop(file);
    return ok({ opened: file });
  } catch (e) {
    return fail(e);
  }
}
