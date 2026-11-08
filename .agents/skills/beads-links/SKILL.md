---
name: beads-links
description: Writes beads:// links that open a bead, a section of a bead, or a Scotty (Bead Me Up, Scotty) view such as Needs You in the user's installed Scotty app. Use when pointing the user at a Beads issue, a bead's notes, design, acceptance criteria or comments, or a project's board, list or Needs You view, in a reply, report, handoff, comment or bead description for the user.
---

# beads:// links

A `beads://` link opens in the user's Scotty app window, already scrolled to the
right place, so they can act on a bead without searching for it. Give one
whenever you name a bead or view the user may want to open.

## Link forms

| Link | Opens |
| --- | --- |
| `beads://projects/<project>/<bead-id>` | the bead |
| `beads://projects/<project>/<bead-id>#<section>` | the bead, scrolled to a section |
| `beads://projects/<project>` | the project, in the user's default view |
| `beads://projects/<project>/<view>` | one of the project's views |
| `beads://` | All Projects |
| `beads://needs-you`, `beads://settings` | the global Needs You and Settings pages |

- `<section>`: `description`, `dependencies`, `subtasks`, `design`,
  `acceptance-criteria`, `notes`, `close-reason`, `comments`. A section the
  bead lacks (no notes, say) just opens the bead.
- `<view>`: `focus`, `board`, `list`, `epics`, `graph`, `insights`,
  `activity`, `needs-you`, `achievements`, `publish`, `settings`.
- Percent-encode anything outside letters, digits, `-`, `.` and `_`.

## The project id

`<project>` is Scotty's project id, not the display name. Scotty slugs the
project folder's name, so `My App.v2/` gets `my-app-v2`, and adds a random
suffix when that id is taken, so look it up rather than derive it. Match on the
project's path, which is the main checkout, also from a linked worktree:

```bash
root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
curl -s http://localhost:19847/api/projects |
  jq -r --arg p "$root" '.projects[] | select(.path == $p) | .id'
```

If nothing matches, the project isn't registered in Scotty, or Scotty isn't
running on its default port: say so rather than guess an id.

## Writing the link

Keep the usual `<id> (<title>)` form and link the ID or add the link beside
it, never in place of the ID and title, which keep the reference readable
anywhere, including where the link doesn't open:

```markdown
[`bd-9f2a.3`](beads://projects/demo/bd-9f2a.3) (Config module: repo path,
actor, allowlist), see its [comments](beads://projects/demo/bd-9f2a.3#comments)
```

Link a section only when that section is the point, such as a comment thread
awaiting the user's answer.

## Where links work

The links open only on a machine where the Scotty handler is registered, which
`xdg-mime query default x-scheme-handler/beads` reports as
`scotty-beads-url.desktop`, and only on Linux for now. Elsewhere, or in text
for other people, such as a GitHub issue or PR, leave `beads://` links out.

To check a link, run the Scotty checkout's handler in dry-run mode, which
prints the command it would run without opening anything, or the reason it
rejects the link:

```bash
node <scotty-checkout>/bin/scotty-open-bead.mjs --dry-run 'beads://projects/demo/bd-9f2a.3#comments'
```

This skill's directory sits at `.agents/skills/beads-links/` inside that
checkout.
