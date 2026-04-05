# Agents

pi-ghosty runs one visible user-facing agent (**coordinator**) and several specialist peers. Prompt parts for each agent live in `peers/<agent>/*.md` and are appended in lexicographic order.

Canonical tool allowlists live in `pi-agent.json`.

## Agents
- `coordinator`: talks to the user; delegates to peers via the `delegate` tool.
- `coder`: edits code and runs commands; reports via `peer_report`.
- `researcher`: reads/searches locally; reports via `peer_report`.
- `reviewer`: reviews for correctness/safety; reports via `peer_report`.
- `memory`: memory tuning/debug; reports via `peer_report`.

