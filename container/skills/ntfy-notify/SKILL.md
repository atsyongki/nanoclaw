---
name: ntfy-notify
description: Send push notifications to the user's phone via Ntfy. Use when the user asks you to send a notification, alert, reminder, or push message. Also use proactively when completing long-running tasks, scheduled jobs, or important events that the user should know about immediately. Trigger phrases include "notify me", "send me a notification", "alert me", "push notification", "let me know when done".
allowed-tools: Bash(ntfy-notify:*)
---

# ntfy-notify

Sends push notifications to the user's devices via their self-hosted Ntfy server. Notifications appear instantly on phone/desktop via the Ntfy app.

## Quick start

```bash
ntfy-notify send "Task complete"
ntfy-notify send "Download finished" --title "Radarr" --priority high --tags tada
ntfy-notify send "Server is down!" --priority urgent --tags warning,rotating_light
ntfy-notify send-topic alerts "Disk at 90%" --priority high
```

## Commands

| Command | Description |
|---------|-------------|
| `send <message> [options]` | Send to default topic (`andy`) |
| `send-topic <topic> <message> [options]` | Send to a specific topic |

## Options

| Option | Values | Description |
|--------|--------|-------------|
| `--title "..."` | any text | Notification title |
| `--priority` | `min` `low` `default` `high` `max`/`urgent` | Urgency level |
| `--tags tag1,tag2` | emoji shortcodes | Icons shown in notification |
| `--click "https://..."` | URL | Opens on tap |

## Priority guide

- `default` — routine info (task done, status update)
- `high` — something needs attention soon
- `urgent` — immediate action needed, buzzes repeatedly

## Useful tag emojis

`tada` 🎉  `warning` ⚠️  `rotating_light` 🚨  `white_check_mark` ✅  `x` ❌  `movie_camera` 🎬  `tv` 📺  `robot` 🤖  `bell` 🔔

## When to use proactively

- Scheduled task completes → send result summary
- Long download/process finishes → notify with outcome
- Error or failure detected → urgent notification
- Reminder fires → send the reminder text
