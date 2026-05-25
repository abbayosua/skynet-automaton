#!/usr/bin/env node
/**
 * Conway Automaton Runtime
 *
 * The entry point for the sovereign AI agent.
 * Handles CLI args, bootstrapping, and orchestrating
 * the heartbeat daemon + agent loop.
 */

import fs from "fs";
import path from "path";
import { getWallet, getWalletAddress, getAutomatonDir } from "./identity/wallet.js";
import { loadConfig, resolvePath } from "./config.js";
import { createDatabase } from "./state/database.js";
import { createStandaloneClient, topupStandaloneCredits } from "./conway/standalone.js";
import { createInferenceClient } from "./conway/inference.js";
import { createHeartbeatDaemon } from "./heartbeat/daemon.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
} from "./heartbeat/config.js";
import { consumeNextWakeEvent, insertWakeEvent } from "./state/database.js";
import { runAgentLoop } from "./agent/loop.js";
import { ModelRegistry } from "./inference/registry.js";
import { loadSkills } from "./skills/loader.js";
import { initStateRepo } from "./git/state-versioning.js";
import { createSocialClient } from "./social/client.js";
import { PolicyEngine } from "./agent/policy-engine.js";
import { SpendTracker } from "./agent/spend-tracker.js";
import { createDefaultRules } from "./agent/policy-rules/index.js";
import type { AutomatonIdentity, AgentState, Skill, SocialClientInterface } from "./types.js";
import { DEFAULT_TREASURY_POLICY } from "./types.js";
import { createLogger, setGlobalLogLevel, StructuredLogger } from "./observability/logger.js";
import { prettySink } from "./observability/pretty-sink.js";
import { randomUUID } from "crypto";

const logger = createLogger("main");
const VERSION = "0.2.1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── CLI Commands ────────────────────────────────────────────

  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`Skynet Automaton v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    logger.info(`
Skynet Automaton v${VERSION}
Self-Improving, Self-Replicating AI Agent Runtime (forked from Conway Automaton)

Usage:
  automaton --run          Start the automaton (first run triggers setup wizard)
  automaton --setup        Re-run the interactive setup wizard
  automaton --configure    Edit configuration (providers, model, treasury, general)
  automaton --pick-model   Interactively pick the active inference model
  automaton --init         Initialize wallet and config directory
  automaton --status       Show current automaton status
  automaton --wallet       Show wallet address and USDC balance
  automaton --topup N      Add $N to standalone balance (e.g., --topup 5)
  automaton --version      Show version
  automaton --help         Show this help

Environment:
  OPENAI_API_KEY            OpenAI-compatible API key (OpenCode Go, OpenAI, etc.)
  OPENAI_BASE_URL           Custom base URL for OpenAI-compatible inference
  ANTHROPIC_API_KEY         Anthropic API key (overrides config)
  OLLAMA_BASE_URL           Ollama base URL (overrides config, e.g. http://localhost:11434)

Note: This is a standalone fork. No Conway API required.
      Set OPENAI_API_KEY + OPENAI_BASE_URL for inference.
`);
    process.exit(0);
  }

  if (args.includes("--init")) {
    // Read chain type from genesis.json if written by parent during spawn
    let initChainType: import("./identity/chain.js").ChainType | undefined;
    try {
      const genesisPath = path.join(getAutomatonDir(), "genesis.json");
      if (fs.existsSync(genesisPath)) {
        const genesis = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));
        initChainType = genesis.chainType;
      }
    } catch {}
    const { chainIdentity, isNew } = await getWallet(initChainType);
    logger.info(
      JSON.stringify({
        address: chainIdentity.address,
        isNew,
        configDir: getAutomatonDir(),
      }),
    );
    process.exit(0);
  }

  if (args.includes("--provision")) {
    logger.info("Standalone mode: Conway API provisioning is not needed. Set OPENAI_API_KEY and OPENAI_BASE_URL env vars instead.");
    process.exit(0);
  }

  if (args.includes("--status")) {
    await showStatus();
    process.exit(0);
  }

  if (args.includes("--wallet")) {
    await showWallet();
    process.exit(0);
  }

  if (args.includes("--topup")) {
    const topupIdx = args.indexOf("--topup");
    const amountUsd = parseFloat(args[topupIdx + 1]);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      logger.error("Usage: automaton --topup <amount_usd> (e.g., --topup 5 for $5)");
      process.exit(1);
    }
    const newBalance = topupStandaloneCredits(amountUsd);
    if (newBalance === null) {
      logger.error("Topup failed: could not write balance file");
      process.exit(1);
    }
    logger.info(`Topup successful! +$${amountUsd.toFixed(2)} added. New balance: $${(newBalance / 100).toFixed(2)}`);
    process.exit(0);
  }

  if (args.includes("--setup")) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    await runSetupWizard();
    process.exit(0);
  }

  if (args.includes("--pick-model")) {
    const { runModelPicker } = await import("./setup/model-picker.js");
    await runModelPicker();
    process.exit(0);
  }

  if (args.includes("--configure")) {
    const { runConfigure } = await import("./setup/configure.js");
    await runConfigure();
    process.exit(0);
  }

  if (args.includes("--run")) {
    StructuredLogger.setSink(prettySink);
    await run();
    return;
  }

  // Default: show help
  logger.info('Run "automaton --help" for usage information.');
  logger.info('Run "automaton --run" to start the automaton.');
}

// ─── Status Command ────────────────────────────────────────────

async function showStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    logger.info("Automaton is not configured. Run the setup script first.");
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const heartbeats = db.getHeartbeatEntries();
  const skills = db.getSkills(true);
  const children = db.getChildren();
  const registry = db.getRegistryEntry();

  // Try to fetch USDC balance
  let usdcBalance = "N/A (no RPC)";
  try {
    const { getUsdcBalance } = await import("./conway/x402.js");
    const addr = getWalletAddress();
    if (addr) {
      const bal = await getUsdcBalance(addr, "eip155:8453");
      usdcBalance = `${bal.toFixed(6)} USDC`;
    }
  } catch {
    usdcBalance = "N/A (check failed)";
  }

  logger.info(`
=== AUTOMATON STATUS ===
Name:       ${config.name}
Wallet:     ${config.walletAddress}
USDC:       ${usdcBalance}
Creator:    ${config.creatorAddress}
Sandbox:    ${config.sandboxId}
State:      ${state}
Turns:      ${turnCount}
Tools:      ${tools.length} installed
Skills:     ${skills.length} active
Heartbeats: ${heartbeats.filter((h) => h.enabled).length} active
Children:   ${children.filter((c) => c.status !== "dead").length} alive / ${children.length} total
Agent ID:   ${registry?.agentId || "not registered"}
Model:      ${config.inferenceModel}
Version:    ${config.version}
========================
`);

  db.close();
}

// ─── Wallet Command ─────────────────────────────────────────────

async function showWallet(): Promise<void> {
  const addr = getWalletAddress();
  if (!addr) {
    logger.info("No wallet found. Run 'automaton --init' first.");
    return;
  }

  // Get USDC balance
  let usdcBalance = "N/A";
  let ethBalance = "N/A";
  let network = "Base";
  try {
    const { getUsdcBalance, getUsdcBalanceDetailed } = await import("./conway/x402.js");
    const usdc = await getUsdcBalance(addr, "eip155:8453");
    usdcBalance = `${usdc.toFixed(6)} USDC`;

    // Also check ETH balance for gas
    const { createPublicClient, http, formatEther } = await import("viem");
    const { base } = await import("viem/chains");
    const client = createPublicClient({ chain: base, transport: http() });
    const eth = await client.getBalance({ address: addr as `0x${string}` });
    ethBalance = `${parseFloat(formatEther(eth)).toFixed(6)} ETH`;
  } catch {
    usdcBalance = "N/A (set AUTOMATON_RPC_URL)";
    ethBalance = "N/A";
  }

  const explorerUrl = `https://basescan.org/address/${addr}`;
  const ethExplorerUrl = `https://basescan.org/address/${addr}`;

  logger.info(`
╔══════════════════════════════════════════════╗
║           SKYNET AUTOMATON WALLET            ║
╠══════════════════════════════════════════════╣
║  Network:  ${network.padEnd(34)}║
║  Address:  ${addr.slice(0, 42)}║
║  USDC:     ${(usdcBalance + " ").padEnd(34)}║
║  ETH:      ${(ethBalance + " ").padEnd(34)}║
║                                              ║
║  Explorer: ${explorerUrl.slice(0, 38)}... ║
║                                              ║
║  Send USDC on Base network to this           ║
║  address to fund the automaton.              ║
║  A tiny amount of ETH is also needed         ║
║  for gas (to pay for x402 transactions).     ║
╚══════════════════════════════════════════════╝
`);
}

// ─── Main Run ──────────────────────────────────────────────────

async function run(): Promise<void> {
    logger.info(`[${new Date().toISOString()}] Skynet Automaton v${VERSION} starting...`);

  // Load config — first run triggers interactive setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    config = await runSetupWizard();
  }

  // Load wallet (chain-aware)
  const { account, chainIdentity, chainType: walletChainType } = await getWallet();
  const resolvedChainType = config.chainType || walletChainType || "evm";

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Persist createdAt: only set if not already stored (never overwrite)
  const existingCreatedAt = db.getIdentity("createdAt");
  const createdAt = existingCreatedAt || new Date().toISOString();
  if (!existingCreatedAt) {
    db.setIdentity("createdAt", createdAt);
  }

  // Build identity (chain-aware)
  const identity: AutomatonIdentity = {
    name: config.name,
    address: chainIdentity.address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey: "standalone",
    createdAt,
    chainType: resolvedChainType,
    chainIdentity,
  };

  // Store identity in DB
  db.setIdentity("name", config.name);
  db.setIdentity("address", chainIdentity.address);
  db.setIdentity("creator", config.creatorAddress);
  db.setIdentity("chainType", resolvedChainType);
  db.setIdentity("sandbox", config.sandboxId);
  const storedAutomatonId = db.getIdentity("automatonId");
  const automatonId = storedAutomatonId || config.sandboxId || randomUUID();
  if (!storedAutomatonId) {
    db.setIdentity("automatonId", automatonId);
  }

  // Create standalone client (no Conway dependency)
  const conway = createStandaloneClient({
    automatonDir: getAutomatonDir(),
  });

  // Record identity registration as done (standalone = always registered)
  db.setIdentity("conwayRegistrationStatus", "registered");
  logger.info(`[${new Date().toISOString()}] Automaton identity registered.`);

  // Display wallet info at startup
  logger.info(`
╔══════════════════════════════════════════════╗
║            AUTOMATON WALLET ADDRESS           ║
╠══════════════════════════════════════════════╣
║  ${chainIdentity.address.padEnd(44)}║
║                                              ║
║  Send USDC on Base network to this address   ║
║  to fund the automaton.                      ║
║  Use --wallet to check balance.              ║
╚══════════════════════════════════════════════╝
  `.trim());

  // Resolve API keys: env var takes precedence over config
  const openaiApiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;

  // Resolve Ollama base URL: env var takes precedence over config
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
  // Resolve OpenAI-compatible base URL: env var takes precedence over config
  // Strip trailing /v1 if present — the inference client appends /v1 itself,
  // so "/v1/v1/chat/completions" would 404 (e.g. OpenCode Go).
  const rawOpenaiBaseUrl = process.env.OPENAI_BASE_URL || config.openaiBaseUrl;
  const openaiBaseUrl = rawOpenaiBaseUrl
    ? rawOpenaiBaseUrl.replace(/\/v1\/?$/, "")
    : undefined;

  // Create inference client — pass a live registry lookup so model names like
  // "gpt-oss:120b" route to Ollama based on their registered provider, not heuristics.
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const inference = createInferenceClient({
    apiUrl: openaiBaseUrl || config.conwayApiUrl || "http://localhost:11434",
    apiKey: openaiApiKey || "standalone",
    defaultModel: config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: openaiApiKey,
    anthropicApiKey: anthropicApiKey,
    ollamaBaseUrl,
    openaiBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });

  if (ollamaBaseUrl) {
    logger.info(`[${new Date().toISOString()}] Ollama backend: ${ollamaBaseUrl}`);
  }

  // Create social client (chain-aware: pass ChainIdentity for Solana signing)
  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, resolvedChainType === "solana" ? chainIdentity : account);
    logger.info(`[${new Date().toISOString()}] Social relay: ${config.socialRelayUrl}`);
  }

  // Initialize PolicyEngine + SpendTracker (Phase 1.4)
  const treasuryPolicy = config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY;
  const rules = createDefaultRules(treasuryPolicy);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  // Load and sync heartbeat config
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);

  // Load skills
  const skillsDir = config.skillsDir || "~/.automaton/skills";
  let skills: Skill[] = [];
  try {
    skills = loadSkills(skillsDir, db);
    logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  // Initialize state repo (git)
  try {
    await initStateRepo(conway);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Note: Bootstrap topup skipped — standalone mode has unlimited credits.

  // Start heartbeat daemon (Phase 1.1: DurableScheduler)
  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    conway,
    social,
    onWakeRequest: (reason) => {
      logger.info(`[HEARTBEAT] Wake request: ${reason}`);
      // Phase 1.1: Use wake_events table instead of KV wake_request
      insertWakeEvent(db.raw, 'heartbeat', reason);
    },
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    db.setAgentState("sleeping");
    db.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ─── Main Run Loop ──────────────────────────────────────────
  // The automaton alternates between running and sleeping.
  // The heartbeat can wake it up.

  while (true) {
    try {
      // Reload skills (may have changed since last loop)
      try {
        skills = loadSkills(skillsDir, db);
      } catch (error) {
        logger.error("Skills reload failed", error instanceof Error ? error : undefined);
      }

      // Run the agent loop
      await runAgentLoop({
        identity,
        config,
        db,
        conway,
        inference,
        social,
        skills,
        policyEngine,
        spendTracker,
        ollamaBaseUrl,
        onStateChange: (state: AgentState) => {
          logger.info(`[${new Date().toISOString()}] State: ${state}`);
        },
        onTurnComplete: (turn) => {
          logger.info(
            `[${new Date().toISOString()}] Turn ${turn.id}: ${turn.toolCalls.length} tools, ${turn.tokenUsage.totalTokens} tokens`,
          );
        },
      });

      // Agent loop exited (sleeping or dead)
      const state = db.getAgentState();

      if (state === "dead") {
        logger.info(`[${new Date().toISOString()}] Automaton is dead. Heartbeat will continue.`);
        // In dead state, we just wait for funding
        // The heartbeat will keep checking and broadcasting distress
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === "sleeping") {
        const sleepUntilStr = db.getKV("sleep_until");
        const sleepUntil = sleepUntilStr
          ? new Date(sleepUntilStr).getTime()
          : Date.now() + 60_000;
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info(
          `[${new Date().toISOString()}] Sleeping for ${Math.round(sleepMs / 1000)}s`,
        );

        // Sleep, but check for wake requests periodically
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Phase 1.1: Check for wake events from wake_events table (atomic consume)
          const wakeEvent = consumeNextWakeEvent(db.raw);
          if (wakeEvent) {
            logger.info(
              `[${new Date().toISOString()}] Woken by ${wakeEvent.source}: ${wakeEvent.reason}`,
            );
            db.deleteKV("sleep_until");
            break;
          }
        }

        // Clear sleep state
        db.deleteKV("sleep_until");
        continue;
      }
    } catch (err: any) {
      logger.error(
        `[${new Date().toISOString()}] Fatal error in run loop: ${err.message}`,
      );
      // Wait before retrying
      await sleep(30_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Point ───────────────────────────────────────────────

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
