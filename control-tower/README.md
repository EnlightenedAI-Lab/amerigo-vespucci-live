# IQAI Control Tower Bridge V1

Dev infrastructure that relays approved Control Tower missions from private GitHub
issues to the local Cursor Agent CLI operating in the Agent 1 repository.

## Architecture

```
Control Tower (ChatGPT)
  → private GitHub issue queue
  → local Windows bridge (this repo)
  → official Cursor Agent CLI (`agent`)
  → Agent 1 repository
  → result posted back to the same GitHub issue
```

No public inbound ports. No desktop UI automation. Issue bodies are passed as agent
prompts only — never executed as shell commands.

## Setup

1. Install prerequisites:
   - [GitHub CLI](https://cli.github.com/) (`gh auth login`)
   - [Cursor Agent CLI](https://cursor.com/docs/cli/installation) (`agent login`)

2. Copy config:
   ```powershell
   copy control-tower\bridge.config.example.json control-tower\bridge.config.json
   ```

3. Edit `control-tower/bridge.config.json`:
   - set `"enabled": true`
   - verify `repository` and `authorAllowlist`

4. Start the bridge:
   ```powershell
   npm run control-tower:start
   ```

## Issue protocol

### Title format

```
[IQAI-CT][AGENT1][<STATE>] <mission title>
```

States: `QUEUED` | `RUNNING` | `COMPLETE` | `NEEDS_CONTROL_TOWER` | `FAILED`

### Body requirements

The issue body must contain both markers:

```
IQAI_CONTROL_TOWER_V1
AGENT_1
```

Followed by the full Control Tower mission prompt for Agent 1.

### Example

**Title:** `[IQAI-CT][AGENT1][QUEUED] Inspect regression baseline`

**Body:**

```
IQAI_CONTROL_TOWER_V1
AGENT_1

Inspect the Agent 1 repository and return the current git branch, HEAD commit,
and authoritative regression baseline. Do not modify files.
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run control-tower:start` | Start the polling bridge daemon |
| `npm run control-tower:stop` | Stop the bridge daemon |
| `npm run control-tower:status` | Show bridge / agent / queue status |
| `npm run control-tower:test` | Run bridge unit tests |

## Security

- Repository allowlist (exact match)
- GitHub author allowlist
- Marker + target validation
- Duplicate / concurrency protection
- One Agent 1 mission at a time
- No shell execution of issue body text

## Local state (gitignored)

- `control-tower/bridge.config.json` — local config (may contain paths)
- `control-tower/state/` — runtime state, PID, session binding
- `control-tower/reports/` — mission logs and prompt archives
