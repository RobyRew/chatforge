# ChatForge documentation

Start here. Each page answers one kind of question.

| I want to… | Read |
|---|---|
| Understand how the whole thing fits together | [architecture.md](architecture.md) |
| Know what every environment variable does, and where to set it | [configuration.md](configuration.md) |
| Understand attachments, avatars and MinIO — including backups | [storage.md](storage.md) |
| Understand sign-in, sessions and roles | [auth-logto.md](auth-logto.md) |
| Deploy or redeploy to the VPS | [../infra/dokploy/DEPLOY.md](../infra/dokploy/DEPLOY.md) |
| Fix something that's broken in production | [operations.md](operations.md) |
| Know *why* a technical decision was made | [../agents.md](../agents.md) — the ADR log |

## The two-file rule

There are two documents that must stay true, and they have different jobs:

- **`agents.md`** is the **decision log** (ADRs). It records *why* — the context, the alternatives,
  the trade-off accepted. Append to it; don't rewrite history. It is also the file an AI agent working
  in this repo is expected to read first.
- **`docs/*.md`** is the **description of what exists now**. When behaviour changes, these get edited
  in place. If a doc and the code disagree, the code wins and the doc is a bug.

## Quick orientation

ChatForge is two products sharing one codebase:

1. **A chat converter** — import your own WhatsApp/Telegram export, edit it, export it to another
   format. Runs entirely in your browser; nothing is uploaded.
2. **An end-to-end encrypted chat platform** — real-time messaging where the server stores ciphertext
   it cannot read, plus a "Vault" for saving imported conversations.

The privacy claim is load-bearing and is the reason for most of the architecture. See
[architecture.md](architecture.md#what-the-server-can-and-cannot-see) for exactly what the server can
and cannot see — that table is the honest version, including the deliberate exceptions.
