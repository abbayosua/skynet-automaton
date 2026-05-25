/**
 * Skynet Automaton Dashboard
 *
 * Serves a real-time monitoring HTML dashboard + JSON API.
 * Started alongside the main --run loop.
 * Exposes: status, turns, balance, USDC, wallet, logs.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { getWalletAddress } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("dashboard");
const AUTOMATON_DIR = path.join(process.env.HOME || "/root", ".automaton");
const HOME = process.env.HOME || "/root";

// ─── In-Memory Log Buffer (last N entries) ────────────────────
const LOG_BUFFER_SIZE = 200;
const logBuffer: string[] = [];

/** Called by index.ts to push log entries into the dashboard buffer. */
export function pushLog(line: string): void {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

// ─── Data Snapshot ────────────────────────────────────────────

function readJson(path: string): any {
  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function getSnapshot(): Record<string, any> {
  const balance = readJson(path.join(AUTOMATON_DIR, "standalone_balance.json"));
  const config = readJson(path.join(AUTOMATON_DIR, "automaton.json"));
  let usdcBalance = "N/A";
  try {
    // Lazy import to avoid crash if viem not available
    const viem = require("viem");
    const chains = require("viem/chains");
    const addr = getWalletAddress();
    if (addr) {
      const client = viem.createPublicClient({
        chain: chains.base,
        transport: viem.http(process.env.AUTOMATON_RPC_URL || undefined, { timeout: 5000 }),
      });
      client.readContract({
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        abi: [{ name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" }],
        functionName: "balanceOf",
        args: [addr],
      }).then((b: bigint) => {
        usdcBalance = (Number(b) / 1_000_000).toFixed(6);
      }).catch(() => { usdcBalance = "RPC error"; });
    }
  } catch {}

  // Read deposit history
  let deposits: any[] = [];
  try {
    const db = require("better-sqlite3")(config?.dbPath || path.join(AUTOMATON_DIR, "state.db"));
    const row = db.prepare("SELECT value FROM kv WHERE key = 'usdc_deposits'").get();
    if (row) deposits = JSON.parse(row.value);
    db.close();
  } catch {}

  return {
    name: config?.name || "Skynet Automaton",
    address: getWalletAddress() || "N/A",
    balanceCents: balance?.balanceCents ?? 0,
    balanceUsd: ((balance?.balanceCents ?? 0) / 100).toFixed(2),
    usdcBalance,
    state: config?.status || "unknown",
    turnCount: 0,
    logs: logBuffer.slice(-50),
    deposits: deposits.slice(-20).reverse(),
    timestamp: new Date().toISOString(),
  };
}

// ─── HTML Dashboard ───────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Skynet Automaton Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0C0C0C;color:#D4D4D4;font-family:'JetBrains Mono',monospace;font-size:13px;padding:2rem;max-width:1000px;margin:0 auto}
h1{color:#00FF88;font-size:1.5rem;margin-bottom:1rem;letter-spacing:-.02em}
h1 span{color:#666;font-size:.85rem}
.card{background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:1rem;margin-bottom:1rem}
.card-title{color:#888;font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.75rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem}
.stat{background:#141414;border-radius:6px;padding:.75rem}
.stat-label{color:#666;font-size:.7rem;text-transform:uppercase;margin-bottom:.25rem}
.stat-value{color:#FFF;font-size:1.2rem;font-weight:600}
.stat-value.green{color:#00FF88}
.stat-value.yellow{color:#FFB800}
.stat-value.red{color:#FF4444}
.stat-value.blue{color:#4488FF}
.log-entry{padding:.35rem 0;border-bottom:1px solid #1A1A1A;font-size:.8rem;color:#AAA;word-break:break-all}
.log-entry:last-child{border-bottom:none}
.log-time{color:#555;margin-right:.5rem}
.deposit-entry{color:#00FF88;background:#0A2A1A;padding:.35rem .5rem;border-radius:4px;margin-bottom:.25rem;font-size:.8rem}
.refresh-bar{position:fixed;bottom:0;left:0;right:0;background:#1A1A1A;border-top:1px solid #2A2A2A;padding:.5rem 2rem;display:flex;justify-content:space-between;align-items:center;font-size:.75rem;color:#666}
.blink{animation:blink 1.2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:.4rem}
.pulse.green{background:#00FF88;box-shadow:0 0 6px #00FF8866}
.pulse.red{background:#FF4444;box-shadow:0 0 6px #FF444466}
a{color:#4488FF}
</style>
</head>
<body>
<h1>🤖 Skynet Automaton <span>— live dashboard</span></h1>

<div class="grid" id="stats"></div>

<div class="card">
  <div class="card-title">📋 Recent Activity</div>
  <div id="logs">Loading...</div>
</div>

<div class="card">
  <div class="card-title">💰 USDC Deposits</div>
  <div id="deposits">Loading...</div>
</div>

<div class="refresh-bar">
  <span id="status-indicator"><span class="pulse green"></span> Live</span>
  <span id="last-update">Updating...</span>
</div>

<script>
async function fetchData() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    render(d);
  } catch(e) {
    document.getElementById('stats').innerHTML = '<div class="card" style="grid-column:1/-1">⚠️ Connection error</div>';
  }
}

function render(d) {
  const isRunning = d.state === 'running' || d.state === 'awake';
  document.getElementById('stats').innerHTML = \`
    <div class="stat"><div class="stat-label">Status</div><div class="stat-value \${isRunning ? 'green' : 'yellow'}">\${d.state.toUpperCase()}</div></div>
    <div class="stat"><div class="stat-label">Balance</div><div class="stat-value green">$\${d.balanceUsd}</div></div>
    <div class="stat"><div class="stat-label">USDC Wallet</div><div class="stat-value blue">\${d.usdcBalance}</div></div>
    <div class="stat"><div class="stat-label">Wallet Address</div><div class="stat-value" style="font-size:.75rem;word-break:break-all">\${d.address}</div></div>
    <div class="stat" style="grid-column:1/-1"><div class="stat-label">Name</div><div class="stat-value" style="font-size:1rem">\${d.name}</div></div>
  \`;

  if (d.logs && d.logs.length) {
    document.getElementById('logs').innerHTML = d.logs.map(l => \`<div class="log-entry"><span class="log-time">›</span>\${escapeHtml(l)}</div>\`).join('');
  } else {
    document.getElementById('logs').innerHTML = '<div class="log-entry" style="color:#555">Waiting for activity...</div>';
  }

  if (d.deposits && d.deposits.length) {
    document.getElementById('deposits').innerHTML = d.deposits.map(dp => \`<div class="deposit-entry">💰 +\$\${dp.amountUsd.toFixed(2)} USDC — \${new Date(dp.detectedAt).toLocaleString()}</div>\`).join('');
  } else {
    document.getElementById('deposits').innerHTML = '<div class="log-entry" style="color:#555">No deposits yet. Send USDC to the wallet address above.</div>';
  }

  document.getElementById('last-update').textContent = 'Last: ' + new Date(d.timestamp).toLocaleTimeString();
  document.getElementById('status-indicator').innerHTML = '<span class="pulse green"></span> Live';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

fetchData();
setInterval(fetchData, 3000);
</script>
</body>
</html>`;

// ─── HTTP Server ──────────────────────────────────────────────

export function startDashboard(port: number = 8080): http.Server {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.url === "/api/status") {
      res.setHeader("Content-Type", "application/json");
      const snap = getSnapshot();
      res.end(JSON.stringify(snap));
      return;
    }

    // Serve HTML
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(HTML);
  });

  server.listen(port, () => {
    logger.info(`Dashboard: http://localhost:${port}`);
    logger.info(`Dashboard API: http://localhost:${port}/api/status`);
  });

  return server;
}
