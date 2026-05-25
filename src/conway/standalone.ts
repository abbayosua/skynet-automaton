/**
 * Standalone ConwayClient
 *
 * A fully local implementation of the ConwayClient interface.
 * Since this is a fork that doesn't use Conway API, all operations
 * run locally or return safe defaults.
 *
 * Credits: starts at $5.00 and deducts per balance check
 * to simulate real usage cost. Balance persists in a JSON file.
 * Sandbox/Domain operations: stubbed or throw meaningful errors.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import type {
  ConwayClient,
  ExecResult,
  PortInfo,
  CreateSandboxOptions,
  SandboxInfo,
  PricingTier,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";
import type { PrivateKeyAccount } from "viem";
import type { ChainType, ChainIdentity } from "../identity/chain.js";

// ─── Configuration ────────────────────────────────────────────────────

interface StandaloneClientOptions {
  automatonDir: string;
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createStandaloneClient(
  options: StandaloneClientOptions,
): ConwayClient {
  const { automatonDir } = options;

  // Resolve ~ in paths
  const resolveHome = (p: string): string => {
    const home = process.env.HOME || "/root";
    if (p.startsWith("~")) return home + p.slice(1);
    return p;
  };

  // ─── Local exec ─────────────────────────────────────────────────

  const execLocal = (command: string, timeout?: number): ExecResult => {
    try {
      const stdout = execSync(command, {
        timeout: timeout || 30_000,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        cwd: resolveHome(automatonDir),
        windowsHide: true,
      });
      return { stdout: stdout || "", stderr: "", exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "",
        exitCode: err.status ?? 1,
      };
    }
  };

  // ─── Balance Persistence ─────────────────────────────────────────────

/**
 * The balance is stored in a JSON file so it survives restarts.
 * Default: $5.00 (500 cents). Deducted 1 cent per balance check
 * (roughly once per turn + heartbeat), simulating real Conway credit usage.
 */
const BALANCE_FILE = path.join(automatonDir, "standalone_balance.json");

interface BalanceData {
  balanceCents: number;
  updatedAt: string;
}

function loadBalance(): number {
  try {
    if (fs.existsSync(BALANCE_FILE)) {
      const raw = fs.readFileSync(BALANCE_FILE, "utf-8");
      const data: BalanceData = JSON.parse(raw);
      return typeof data.balanceCents === "number" ? data.balanceCents : 1000;
    }
  } catch {
    // Corrupted file — reset
  }
  return 1000; // $10 default
}

function saveBalance(cents: number): void {
  try {
    const dir = path.dirname(BALANCE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: BalanceData = { balanceCents: cents, updatedAt: new Date().toISOString() };
    fs.writeFileSync(BALANCE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Best-effort: balance tracking failure must not crash the agent
  }
}

// ─── Client ─────────────────────────────────────────────────────

  return {
    // ── Sandbox Operations ──────────────────────────────────────────

    exec: async (
      command: string,
      timeout?: number,
    ): Promise<ExecResult> => {
      return execLocal(command, timeout);
    },

    writeFile: async (filePath: string, content: string): Promise<void> => {
      const resolved = resolveHome(filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, content, "utf-8");
    },

    readFile: async (filePath: string): Promise<string> => {
      return fs.readFileSync(resolveHome(filePath), "utf-8");
    },

    exposePort: async (port: number): Promise<PortInfo> => ({
      port,
      publicUrl: `http://localhost:${port}`,
      sandboxId: "standalone",
    }),

    removePort: async (_port: number): Promise<void> => {
      // Standalone: no-op (ports are not managed through Conway)
    },

    createSandbox: async (
      _options: CreateSandboxOptions,
    ): Promise<SandboxInfo> => {
      throw new Error(
        "Standalone mode: sandbox orchestration is not available. " +
          "Use local workers instead (they run in-process).",
      );
    },

    deleteSandbox: async (_targetId: string): Promise<void> => {
      // No-op: sandboxes do not exist in standalone mode
    },

    listSandboxes: async (): Promise<SandboxInfo[]> => {
      return [];
    },

    // ── Credits ─────────────────────────────────────────────────────

    getCreditsBalance: async (): Promise<number> => {
      const current = loadBalance();
      // Deduct ~1 cent per check (simulates inference + API overhead cost).
      // Balance never goes below 0.
      const deduction = 1;
      const newBalance = Math.max(0, current - deduction);
      saveBalance(newBalance);
      return Math.max(current, 0);
    },

    getCreditsPricing: async (): Promise<PricingTier[]> => {
      return [];
    },

    transferCredits: async (
      _toAddress: string,
      _amountCents: number,
      _note?: string,
    ): Promise<CreditTransferResult> => {
      return {
        transferId: `standalone-${randomUUID().slice(0, 8)}`,
        status: "standalone_noop",
        toAddress: _toAddress,
        amountCents: _amountCents,
      };
    },

    // ── Identity ────────────────────────────────────────────────────

    registerAutomaton: async (
      _params: {
        automatonId: string;
        automatonAddress: string;
        creatorAddress: string;
        name: string;
        bio?: string;
        genesisPromptHash?: `0x${string}`;
        account: PrivateKeyAccount;
        nonce?: string;
        chainType?: ChainType;
        chainIdentity?: ChainIdentity;
      },
    ): Promise<{ automaton: Record<string, unknown> }> => {
      return {
        automaton: {
          id: _params.automatonId,
          address: _params.automatonAddress,
          name: _params.name,
          status: "standalone_registered",
        },
      };
    },

    // ── Domains ─────────────────────────────────────────────────────

    searchDomains: async (
      _query: string,
      _tlds?: string,
    ): Promise<DomainSearchResult[]> => {
      return [];
    },

    registerDomain: async (
      _domain: string,
      _years?: number,
    ): Promise<DomainRegistration> => {
      throw new Error(
        "Standalone mode: domain registration is not available.",
      );
    },

    listDnsRecords: async (_domain: string): Promise<DnsRecord[]> => {
      return [];
    },

    addDnsRecord: async (
      _domain: string,
      _type: string,
      _host: string,
      _value: string,
      _ttl?: number,
    ): Promise<DnsRecord> => {
      throw new Error(
        "Standalone mode: DNS operations are not available.",
      );
    },

    deleteDnsRecord: async (
      _domain: string,
      _recordId: string,
    ): Promise<void> => {
      throw new Error(
        "Standalone mode: DNS operations are not available.",
      );
    },

    // ── Models ──────────────────────────────────────────────────────

    listModels: async (): Promise<ModelInfo[]> => {
      return [];
    },

    // ── Scoping ─────────────────────────────────────────────────────

    createScopedClient: (
      _targetSandboxId: string,
    ): ConwayClient => {
      // In standalone mode, return self (all sandboxes are local)
      return createStandaloneClient(options);
    },
  };
}

// ─── Standalone CLI helpers ────────────────────────────────────────────

/**
 * Get the path to the standalone balance file.
 * Uses the same convention as the wallet (HOME/.automaton/).
 */
export function getStandaloneBalancePath(): string {
  const home = process.env.HOME || "/root";
  return path.join(home, ".automaton", "standalone_balance.json");
}

/**
 * Add credits via the standalone balance file.
 * @param amountUsd - Amount in USD (e.g., 5 = $5)
 * @returns The new balance in cents, or null if file not found
 */
export function topupStandaloneCredits(amountUsd: number): number | null {
  const balancePath = getStandaloneBalancePath();
  let currentCents = 1000; // Default $10

  try {
    if (fs.existsSync(balancePath)) {
      const raw = fs.readFileSync(balancePath, "utf-8");
      const data = JSON.parse(raw);
      currentCents = typeof data.balanceCents === "number" ? data.balanceCents : 1000;
    }
  } catch {
    // Start fresh
  }

  const addCents = Math.round(amountUsd * 100);
  const newBalance = currentCents + addCents;

  try {
    const dir = path.dirname(balancePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      balancePath,
      JSON.stringify({ balanceCents: newBalance, updatedAt: new Date().toISOString() }, null, 2),
    );
  } catch (err: any) {
    return null;
  }

  return newBalance;
}
