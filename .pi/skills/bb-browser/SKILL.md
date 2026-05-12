# bb-browser (native tools in pi-ghosty)

Do not call `bb-browser` through `bash` in this project.
Use the gated native tools instead:

- `browser_open(url)` to navigate
- `browser_snapshot(selector?)` to capture page content
- `browser_eval(script)` for privileged JS evaluation (corroborator only)

Notes:
- Prefer `browser_snapshot` first for data acquisition.
- Use `browser_eval` only when snapshot/open are insufficient.
- If selector snapshots fail, the tool records a trace event and falls back to full-page snapshot automatically.
