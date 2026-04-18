---
name: docker-manager
description: Inspect and manage Docker containers and compose stacks on the host machine. Use when user asks about containers, which are stopped, or wants to restart a service.
allowed-tools: Bash(docker-manager:*)
---

# docker-manager

A CLI tool installed in the agent container that communicates with the host Docker daemon via the Docker socket. Translates Windows-style compose paths (C:\docker\...) to WSL2 paths automatically.

## Quick start

```bash
docker-manager stopped             # List stopped/exited containers
docker-manager status              # List ALL containers with status
docker-manager restart overseerr   # Restart a container's compose stack
docker-manager logs sonarr 100     # Show last 100 log lines
docker-manager compose-list        # List all detected compose projects
```

## Commands

```
docker-manager status              List all containers with their status
docker-manager stopped             List only stopped/exited containers
docker-manager restart <name>      Restart a container's compose stack (or container directly)
docker-manager logs <name> [N]     Show last N lines of logs (default: 50)
docker-manager compose-list        List all detected compose projects
```

## When to use

- User asks "which containers are down?" → `docker-manager stopped`
- User asks to restart a container → `docker-manager restart <name>`
- User asks about a container's logs → `docker-manager logs <name>`
- User asks for overall status → `docker-manager status`

## Notes

- Works on stopped containers too (uses `docker inspect` which reads metadata even when exited)
- Compose restart does a full `down` + `up -d` cycle to pick up any config changes
- Falls back to `docker start` if no compose project is detected
