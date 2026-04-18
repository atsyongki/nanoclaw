---
name: docker-manager
description: Inspect and manage Docker containers and compose stacks on the host machine. Use when user asks about containers, which are stopped, wants to list services, or wants to restart a specific service.
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
docker-manager restart overseerr sonarr       # Restart only the 'sonarr' service
docker-manager restart-project home-media     # Restart a whole stack by project name (fuzzy)
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
docker-manager logs <name> [N]                 Show last N lines of logs (default: 50)
docker-manager compose-list                    List all detected compose projects
```

## Restart behaviour

- `restart <container/service>` — looks up compose file from that container's labels
- `restart-project <name>` — searches all containers for a matching project name (fuzzy/case-insensitive); use this when the user refers to a stack by name (e.g. "home-media", "arr stack", "media")
- Running stack → uses `docker compose restart` (graceful)
- Stopped stack → uses `docker compose down` + `up -d` (full recreation)
- Falls back to individual `docker start` if compose file path isn't accessible

## When to use

- User asks "which containers are down?" → `docker-manager stopped`
- User asks "what services are in the X stack?" → `docker-manager services X`
- User asks to restart a whole stack by project name → `docker-manager restart-project <name>`
- User asks to restart a container by name → `docker-manager restart <name>`
- User asks to restart a specific service → `docker-manager restart <name> <service>`
- User asks about a container's logs → `docker-manager logs <name>`
- User asks for overall status → `docker-manager status`

## Notes

- Works on stopped containers too (uses `docker inspect` which reads metadata even when exited)
- Resolves container names by both container name AND compose service name label
- Falls back to `docker start` if no compose project is detected
