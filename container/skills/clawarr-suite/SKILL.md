---
name: clawarr-suite
description: Manage the *arr media stack — Radarr (movies), Sonarr (TV series), Prowlarr (indexers), and Bazarr (subtitles). Use when the user asks about movies, TV shows, downloads, queue, missing episodes, subtitles, indexers, or wants to add/search/delete media. Trigger phrases include "what movies do I have", "add movie X", "add series X", "what's downloading", "missing episodes", "check indexers", "search for X", "subtitle status", "media queue".
allowed-tools: Bash(clawarr-suite:*)
---

# clawarr-suite

Manages Radarr, Sonarr, Prowlarr, and Bazarr via their REST APIs. All commands run inside the agent container and connect to the host machine.

## Quick start

```bash
clawarr-suite status                      # Health check all apps
clawarr-suite movies                      # List all movies
clawarr-suite movies batman               # Filter movies by title
clawarr-suite series                      # List all TV series
clawarr-suite queue                       # Show download queue (both apps)
clawarr-suite missing                     # Show missing movies + episodes
clawarr-suite search-movie "Inception"    # Find a movie (get tmdbId)
clawarr-suite add-movie 27205             # Add movie by tmdbId
clawarr-suite search-series "Breaking Bad"
clawarr-suite add-series 81189            # Add series by tvdbId
clawarr-suite refresh-movie "Inception"   # Trigger search for existing movie
clawarr-suite refresh-series "Sopranos"   # Trigger search for existing series
clawarr-suite indexers                    # List Prowlarr indexers
clawarr-suite indexer-test                # Test all indexers
clawarr-suite subtitles-wanted            # Episodes missing subtitles
clawarr-suite quality-profiles radarr     # List quality profiles
```

## Commands

| Command | Description |
|---------|-------------|
| `status` | Health check all *arr apps |
| `movies [filter]` | List movies, optional title filter |
| `series [filter]` | List TV series, optional title filter |
| `queue [radarr\|sonarr\|all]` | Show active download queue |
| `missing [radarr\|sonarr\|all]` | Show missing/undownloaded content |
| `search-movie <title>` | Lookup movie, returns tmdbId for add-movie |
| `search-series <title>` | Lookup series, returns tvdbId for add-series |
| `add-movie <tmdbId> [profileId]` | Add movie to Radarr and trigger search |
| `add-series <tvdbId> [profileId]` | Add series to Sonarr and trigger search |
| `refresh-movie <title>` | Force search for an already-tracked movie |
| `refresh-series <title>` | Force search for an already-tracked series |
| `delete-movie <title> [--delete-files]` | Remove movie from Radarr |
| `indexers` | List all Prowlarr indexers with status |
| `indexer-test` | Test all Prowlarr indexers |
| `subtitles-wanted` | List episodes missing subtitles (Bazarr) |
| `quality-profiles [radarr\|sonarr]` | List quality profiles with IDs |

## Typical workflows

**User asks "do I have movie X?"**
→ `clawarr-suite movies X`
- ✓ = file exists, ⏳ = monitored/downloading, ✗ = not monitored

**User wants to add a movie**
1. `clawarr-suite search-movie <title>` — find tmdbId
2. `clawarr-suite add-movie <tmdbId>` — add and trigger search

**User asks "what's downloading?"**
→ `clawarr-suite queue`

**User asks "what episodes am I missing?"**
→ `clawarr-suite missing sonarr`

**User asks to fix a failed download**
→ `clawarr-suite refresh-movie <title>` or `refresh-series <title>`

## Notes

- Status icons: ✓ = complete, ⏳ = monitored/in-progress, ✗ = not monitored
- `add-movie` / `add-series` auto-triggers a search after adding
- Default quality profile ID is `1` — use `quality-profiles` to see available IDs
- Prowlarr is accessible via nordvpn network namespace (port 9696)
- Bazarr is accessible via nordvpn network namespace (port 6767)
