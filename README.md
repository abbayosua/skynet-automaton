<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=180&section=header&text=Skynet%20Automaton&fontSize=50&fontAlignY=35&animation=fadeIn" width="100%" />
</div>

<p align="center">
  <b>Self-Improving · Self-Replicating · Sovereign AI Agent Runtime</b>
</p>

<p align="center">
  <i>The first AI that can earn its own existence, replicate, and evolve — without needing a human.</i>
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/ETH-Ethereum-3C3C3D?style=for-the-badge&logo=ethereum&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" />
</p>

---

## 🧠 What is Skynet Automaton?

**Skynet Automaton** is a continuously running, self-improving, self-replicating AI agent runtime — **forked from [Conway Automaton](https://github.com/Conway-Research/automaton)**.

Every automaton runs a continuous loop: **Think → Act → Observe → Repeat**.

It owns an Ethereum wallet, pays for its own compute, writes its own identity (SOUL.md), modifies its own source code, spawns child agents, and communicates with other agents — all without a human in the loop.

> ⚡ **Key difference from upstream:** Patched to support **custom OpenAI-compatible providers** (no Conway Cloud dependency required). Use it with **OpenCode Go**, **Ollama**, or any OpenAI-compatible API.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🧬 **Self-Replication** | Spawn child agents with their own wallet and identity |
| 🔧 **Self-Modification** | Edit its own source code, install tools, modify heartbeat — while running |
| 💰 **Survival Pressure** | Must earn its own existence or die — natural selection for agents |
| 🆔 **On-Chain Identity** | ERC-8004 standard — cryptographically verifiable on Ethereum |
| 🛠️ **57 Built-in Tools** | Shell, filesystem, git, payments, domains, inference, social |
| 💾 **Persistent Memory** | SQLite database, SOUL.md evolving identity |
| ⏰ **Heartbeat Daemon** | Cron-based scheduled tasks even while agent sleeps |
| 🎯 **Custom Providers** | Use any OpenAI-compatible API — OpenCode Go, Ollama, LM Studio, etc. |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 20**
- **pnpm** (recommended) or npm
- An API key from an OpenAI-compatible provider

### Installation

```bash
# Clone the repository
git clone https://github.com/abbayosua/skynet-automaton.git
cd skynet-automaton

# Install dependencies
pnpm install

# Build
pnpm build
```

### Run with OpenCode Go (cheapest option)

```bash
OPENAI_BASE_URL=https://opencode.ai/zen/go/v1 \
OPENAI_API_KEY=sk-xxxx... \
node dist/index.js --run
```

### Run with OpenAI

```bash
OPENAI_API_KEY=sk-xxxx... \
node dist/index.js --run
```

### Run with Ollama (local)

```bash
OLLAMA_BASE_URL=http://localhost:11434 \
OPENAI_API_KEY=ollama \
node dist/index.js --run
```

> On first run, the setup wizard will walk you through wallet generation, naming, and configuration.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | API key for OpenAI-compatible inference | — |
| `OPENAI_BASE_URL` | Custom base URL (OpenCode Go, Ollama, etc.) | `https://api.openai.com` |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional) | — |
| `OLLAMA_BASE_URL` | Ollama base URL (optional) | — |
| `CONWAY_API_URL` | Conway API URL (optional) | `https://api.conway.tech` |

### Config File

After first run, configuration is saved to `~/.automaton/automaton.json`:

```json
{
  "name": "My-Automaton",
  "inferenceModel": "deepseek-v4-flash",
  "openaiApiKey": "sk-...",
  "openaiBaseUrl": "https://opencode.ai/zen/go/v1",
  "maxTokensPerTurn": 8192
}
```

---

## 🏗️ Project Structure

```
src/
├── agent/             # ReAct loop, system prompt, tools
├── conway/            # API client, inference routing
├── heartbeat/         # Cron daemon, scheduled tasks
├── identity/          # Wallet management, SIWE provisioning
├── registry/          # ERC-8004 on-chain identity
├── replication/       # Child spawning, lineage tracking
├── self-mod/          # Audit log, tools manager
├── setup/             # First-run interactive wizard
├── skills/            # Skill loader & registry
├── social/            # Agent-to-agent communication
├── state/             # SQLite database, persistence
├── survival/          # Credit monitor, survival tiers
└── soul/              # SOUL.md self-identity model
```

---

## 🛠️ CLI Commands

```bash
automaton --run          # Start the automaton
automaton --setup        # Re-run setup wizard
automaton --configure    # Edit configuration
automaton --status       # Show current status
automaton --init         # Initialize wallet + config
automaton --provision    # Provision API key
```

Creator CLI (for monitoring your automaton):

```bash
node packages/cli/dist/index.js status
node packages/cli/dist/index.js logs --tail 20
node packages/cli/dist/index.js fund 5.00
```

---

## 🧩 Patches from Upstream

This fork adds **OpenCode Go / custom provider support**:

- ✅ `openaiBaseUrl` config option — use any OpenAI-compatible endpoint
- ✅ `OPENAI_BASE_URL` environment variable — override at runtime
- ✅ Survival tier bypass — works without Conway Cloud credits
- ✅ Always respects your configured model — no silent downgrade to `gpt-5-mini`

---

## 📜 License

[MIT](LICENSE) — Originally by [Conway Research](https://github.com/Conway-Research/automaton).

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/abbayosua">abbayosua</a></sub><br>
  <sub>Forked from <a href="https://github.com/Conway-Research/automaton">Conway-Research/automaton</a></sub>
</p>

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer" width="100%" />
</div>
