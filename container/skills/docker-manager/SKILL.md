---
name: docker-manager
description: Inspect and manage Docker containers and compose stacks on the host machine.
---

# docker-manager

A CLI tool installed in the agent container that communicates with the host Docker daemon via the Docker socket. Translates Windows-style compose paths (C:\docker\...) to WSL2 paths automatically.

## Commands

```
docker-manager status              List all containers with their status
docker-manager stopped             List only stopped/exited containers
docker-manager restart <name>      Restart a container's compose stack (or container directly)
docker-manager logs <name> [N]     Show last N lines of logs (default: 50)
docker-manager compose-list        List all detected compose projects
```

## When to use

- User asks "which containers are down?" → run `docker-manager stopped`
- User asks to restart a container → run `docker-manager restart <name>`
- User asks about a container's logs → run `docker-manager logs <name>`
- User asks for overall status → run `docker-manager status`

## Notes

- Works on stopped containers too (uses `docker inspect` which reads metadata even when exited)
- Compose restart does a full `down` + `up -d` cycle to pick up any config changes
- Falls back to `docker start` if no compose project is detected
