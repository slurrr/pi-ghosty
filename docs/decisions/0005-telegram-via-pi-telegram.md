# 0005: Telegram via `pi-telegram` Extension (No Custom Gateway)

## Status
Approved

## Context
pi-ghosty needs to be usable locally (TUI) and remotely (Telegram). A custom Telegram gateway duplicates IO, streaming,
queueing, and attachment behavior that already exists in upstream pi extensions.

We want to focus this repo on the multi-peer orchestrator and keep Telegram as an optional capability enabled in-session.

## Decision
Use upstream `badlogic/pi-telegram` as a pi extension for Telegram DM bridging.

- Debug and develop primarily in the pi TUI.
- Enable Telegram by installing and connecting the extension in the corroborator session.
- Retire the custom Telegram gateway code in `src/telegram/*`.

## Consequences
- Less custom IO code to maintain in this repo.
- Telegram behavior stays aligned with upstream pi practices (setup/connect/status/streaming/queueing/attachments).
- Telegram remains session-local; connect it only in the corroborator session that should own the bot.
