# Mesh

**The living layer over your codebase — tickets in, production-ready PRs out.**

Mesh turns an organization's entire codebase into a living entity that a workforce of agents operates on. Tickets and product-value proposals go in; engineering gets production-ready PRs across the whole system that they only have to review — not rewrite.

## Status

Work in progress. Hackathon build on **Claude Opus 4.7**, shipping April 2026.

This repository currently contains only the README. Code and demo arrive throughout the week.

## Why

Most companies don't have *one* repository. They have 4, 12, 47 — web, api, analytics, content, design system, infra. A simple business change like *"20% off first payment for enterprise referrals"* can touch four of them. Today only someone with deep context can execute that without breaking something. That person is the bottleneck.

Mesh makes the whole codebase addressable as one surface, governs the changes against the organization's invariants, and hands engineering PRs that are ready to review.

## Built on Claude Opus 4.7

Mesh requires Opus 4.7 specifically:

- **1M token context** — the entire organization's codebase fits in one window, not just one repo.
- **Visible extended thinking** — the reasoning is the product, not a black box.
- **Long agentic loops** — generation stays coherent across minutes-long, multi-repo executions.

Swap the model for Haiku or GPT-4 and the product breaks.

## Two engine modes

- **Claude Code mode (recommended)** — uses `@anthropic-ai/claude-agent-sdk`. Auto-discovers your `~/.claude/skills/`, agents, and MCP servers.
- **Drop-in API key mode** — paste an `ANTHROPIC_API_KEY` and run on the raw Anthropic SDK.

## License

MIT — see [LICENSE](./LICENSE).

---

*Built for the Anthropic Claude Hackathon — Problem Statement #2 ("Build For What's Next").*
