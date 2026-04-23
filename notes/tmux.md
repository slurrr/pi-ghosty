# tmux: running pi-ghosty + vLLM + Hindsight

This is a minimal, copy/paste workflow.

## Key bindings (default tmux)
- Detach: `Ctrl-b d`
- New window: `Ctrl-b c`
- Next window: `Ctrl-b n`
- Previous window: `Ctrl-b p`
- Split pane (vertical): `Ctrl-b %`
- Split pane (horizontal): `Ctrl-b "`
- Switch panes: `Ctrl-b` then arrow keys
- Kill pane: `Ctrl-b x`
- Kill window: `Ctrl-b &`

## Recommended layout
One tmux session with 3 windows:
- window 0: vLLM server
- window 1: Hindsight server
- window 2: pi-ghosty TUI

## Create session

```bash
cd ~/code/dev/pi-ghosty

tmux new -s ghosty
```

### Window 0: vLLM
Run your existing vLLM command here (example placeholder):

```bash
# example only
# vllm serve ... --host 127.0.0.1 --port 8002
```

### Window 1: Hindsight
Create a new window:

```bash
# inside tmux
Ctrl-b c
```

Run your existing Hindsight launch here.

### Window 2: pi-ghosty
Create another window:

```bash
Ctrl-b c
```

Run:

```bash
cd ~/code/dev/pi-ghosty
npm run dev
```

## Reattach later

```bash
tmux attach -t ghosty
```

## Kill pi-ghosty quickly (kill switch)
pi-ghosty writes a pidfile to its runDir: `~/runs/pi-ghosty/ghosty.pid`.

From any shell:

```bash
cd ~/code/dev/pi-ghosty
npm run kill
```

If you override `GHOSTY_PI_RUN_DIR`, export it before `npm run kill`.
