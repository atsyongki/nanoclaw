---
name: docker-manager
description: Inspect and manage Docker containers and compose stacks on the host machine. Use when the user asks about Docker containers (which are stopped, running, status), wants to restart, stop, or remove a container/stack/project, list services, or check logs. Trigger phrases include "restart X stack", "stop X stack", "remove X stack", "down X stack", "restart X docker stack", "which containers are down", "start X service", "container status".
allowed-tools: Bash(docker-manager:*)
---

# docker-manager

A CLI tool installed in the agent container that communicates with the host Docker daemon via the Docker socket. Translates Windows-style compose paths (C:\docker\...) to WSL2 paths automatically.

## Quick start

```bash
docker-manager stopped                        # List stopped/exited containers
docker-manager status                         # List ALL containers with status
docker-manager services overseerr             # List services in a container's compose project
docker-manager restart overseerr              # Restart the entire compose stack (by container name)
docker-manager restart-project home-media     # Restart a whole stack by project name (fuzzy)
docker-manager stop-project home-media        # Stop (keep) all containers in a project
docker-manager down-project home-media        # Stop and remove all containers in a project
docker-manager logs sonarr 100                # Show last 100 log lines
docker-manager compose-list                   # List all detected compose projects
```

## Commands

```
docker-manager status                          List all containers with their status
docker-manager stopped                         List only stopped/exited containers
docker-manager services <name>                 List all services in a container's compose project
docker-manager restart <name> [service]        Restart a service or entire stack (by container/service name)
docker-manager restart-project <name>          Restart a whole compose project by project name (fuzzy match)
docker-manager stop-project <name>             Stop (keep) all containers in a compose project
docker-manager down-project <name>             Stop and remove all containers in a compose project
docker-manager logs <name> [N]                 Show last N lines of logs (default: 50)
docker-manager compose-list                    List all detected compose projects
```

## When to use

- User asks "which containers are down?" → `docker-manager stopped`
- User asks "what services are in the X stack?" → `docker-manager services X`
- User asks to restart a whole stack by project name → `docker-manager restart-project <name>`
- User asks to restart a container by name → `docker-manager restart <name>`
- User asks to restart a specific service → `docker-manager restart <name> <service>`
- User asks to stop a stack (keep containers) → `docker-manager stop-project <name>`
- User asks to remove/down a stack → `docker-manager down-project <name>`
- User asks about a container's logs → `docker-manager logs <name>`
- User asks for overall status → `docker-manager status`

## Notes

- Works on stopped containers too (uses `docker inspect` which reads metadata even when exited)
- Resolves container names by both container name AND compose service name label
- All project commands use fuzzy/case-insensitive name matching
- Uses `docker compose` with correct working directory for proper dependency ordering
- Falls back to per-container operations if compose file is not accessible
