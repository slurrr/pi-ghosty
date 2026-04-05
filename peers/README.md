# Peer prompt parts

Each agent session gets additional prompt parts from `peers/<agent>/*.md`.

Rules:
- Only `*.md` files are loaded.
- Files are appended in lexicographic order.
- Keep parts small and role-specific.

Naming:
- Use `00-...`, `01-...`, `02-...` numbering for stable ordering.

