# pi default system prompt (reference)

pi-ghosty currently uses pi’s built-in default system prompt (from `@mariozechner/pi-coding-agent`) plus the project
append file `.pi/APPEND_SYSTEM.md`.

Why this file exists:
- keep the pi default prompt wording visible in-repo
- make upstream prompt changes easy to spot during dependency updates

Source (versioned in `package.json`):
- `node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js` (`buildSystemPrompt()`)

Core default wording (template excerpt):

```
You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
...
Current date: ${date}
Current working directory: ${promptCwd}
```

Notes:
- The real prompt is generated dynamically (tool list, doc paths, date, cwd).
- If we add `.pi/SYSTEM.md`, pi treats it as a full override and stops using the upstream default prompt generator.
