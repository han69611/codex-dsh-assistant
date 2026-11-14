/**
 * dsh.mjs — DeepSeek Harness 桌面端适配器（外部进程驱动运行中的 DSH）
 *
 * 原理（已实测）：
 *  - DSH 桌面端在 127.0.0.1:<随机端口> 暴露宿主 HTTP API：`POST /api/<namespace>/<method>`。
 *  - 认证=一个 v1 浏览器 cookie，签名密钥持久化在 ~/.dsh/.credentials.yaml 的
 *    `client-connection/browser-session` 记录里（本机同用户进程可读），因此可以离线自签。
 *  - 信封：{type:'client-request', rpcId, method, payload:{args:{<参数名>:<值>}}}
 *    响应：{type:'server-response', rpcId, result:{ok:true, value} | {ok:false, error}}
 *
 * 能力：
 *  - listSessions(): 列出会话（只读，不唤醒 agent）
 *  - readSessionPage(): 读取一段会话历史（只读）
 *  - promptSession(): 向指定会话投递一条用户消息并让它跑一轮（有副作用：消耗额度、执行工具）
 *
 * 安全：自签 cookie 等价 owner 权限。默认只读；prompt 需要显式 sessionId。
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COOKIE_PREFIX = 'dsh-auth-';
const COOKIE_PAYLOAD_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 小时

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// ---------------------------------------------------------------- 密钥与 cookie

/** 从 ~/.dsh/.credentials.yaml 读取 client-connection/browser-session 的签名密钥。 */
export function loadBrowserSessionSecret() {
  if (process.env.DSH_BROWSER_SESSION_SECRET) {
    return { secret: Buffer.from(process.env.DSH_BROWSER_SESSION_SECRET, 'base64url'), source: 'env:DSH_BROWSER_SESSION_SECRET' };
  }
  const file = process.env.DSH_CREDENTIALS_FILE || path.join(dshHome(), '.credentials.yaml');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`读不到 DSH 凭据文件 ${file}: ${err.message}`);
  }

  // 兼容 JSON 与简单 YAML 两种格式
  let secretValue = null;
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    /* 不是 JSON */
  }
  if (parsedJson) {
    const record = parsedJson.records?.['client-connection/browser-session'];
    secretValue = record?.payload?.secret || null;
  } else {
    const lines = text.split(/\r?\n/);
    let baseIndent = -1;
    let inRecord = false;
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      if (/^\s*client-connection\/browser-session:\s*$/.test(line)) {
        inRecord = true;
        baseIndent = indent;
        continue;
      }
      if (!inRecord) continue;
      if (indent <= baseIndent && /^\S/.test(line)) break; // 下一个顶层记录
      const match = line.match(/^\s*secret:\s*['"]?([A-Za-z0-9_\-+/=]+)['"]?\s*$/);
      if (match) {
        secretValue = match[1];
        break;
      }
    }
  }
  if (!secretValue) {
    throw new Error(`在 ${file} 里找不到 client-connection/browser-session.secret`);
  }
  const secret = Buffer.from(secretValue, 'base64url');
  if (secret.byteLength !== 32) throw new Error('browser-session 密钥长度不是 32 字节');
  return { secret, source: file };
}

/** 构造一个合法的 v1 浏览器 cookie。 */
export function buildAuthCookie({ authority, secret, maxAgeMs = DEFAULT_MAX_AGE_MS }) {
  const now = Date.now();
  const payload = {
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt: now,
    expiresAt: now + maxAgeMs,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const name = COOKIE_PREFIX + crypto.createHash('sha256').update(authority).digest('base64url');
  return { name, value: `v${COOKIE_PAYLOAD_VERSION}.${body}.${signature}`, payload, header: `${name}=v${COOKIE_PAYLOAD_VERSION}.${body}.${signature}` };
}

// ---------------------------------------------------------------- 端口发现

function listListeningPortsWithPids() {
  if (process.platform === 'win32') {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    const entries = [];
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!match) continue;
      entries.push({ address: match[1], port: Number(match[2]), pid: Number(match[3]) });
    }
    return entries;
  }
  const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
  const entries = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const pid = Number(parts[1]);
    const local = parts.slice(8).join(' ');
    const match = local.match(/(\S+):(\d+)/);
    if (match) entries.push({ address: match[1], port: Number(match[2]), pid });
  }
  return entries;
}

function processImageNames() {
  if (process.platform !== 'win32') return new Map();
  const out = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const map = new Map();
  for (const line of out.split(/\r?\n/)) {
    const parts = line.split('","').map((s) => s.replace(/^"|"$/g, ''));
    const pid = Number(parts[1]);
    if (pid) map.set(pid, parts[0]);
  }
  return map;
}

/** 找出真正承载 HTTP API 的 desktop host 进程（排除 ego-cast-worker 等同名子进程）。 */
let hostPidCache = { at: 0, pids: new Set() };
function dshDesktopHostPids() {
  if (process.platform !== 'win32') return new Set();
  if (Date.now() - hostPidCache.at < 15000) return hostPidCache.pids;
  const pids = new Set();
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    const parsed = JSON.parse(out.trim() || '[]');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of list) {
      if (/dsh-desktop-host/i.test(entry.CommandLine || '')) pids.add(entry.ProcessId);
    }
  } catch {
    /* 探测失败时退回旧逻辑 */
  }
  hostPidCache = { at: Date.now(), pids };
  return pids;
}

/** 找 DSH 桌面端监听的本地端口（每次启动随机，按进程名发现）。 */
export function discoverDshBase() {
  if (process.env.DSH_BASE_URL) return process.env.DSH_BASE_URL.replace(/\/+$/, '');
  if (process.env.DSH_WEB_URL) return process.env.DSH_WEB_URL.replace(/\/+$/, '');

  const names = processImageNames();
  const dshPids = new Set(
    [...names.entries()].filter(([, name]) => /deepseek harness/i.test(name)).map(([pid]) => pid),
  );
  const candidates = listListeningPortsWithPids()
    .filter((entry) => dshPids.has(entry.pid) && (entry.address === '127.0.0.1' || entry.address === '0.0.0.0' || entry.address === '::1'))
    .map((entry) => `http://127.0.0.1:${entry.port}`);
  let unique = [...new Set(candidates)];
  // 优先选 desktop host 的端口；ego-cast-worker 等子进程也可能监听端口，但没有 /api
  const hostPids = dshDesktopHostPids();
  const preferred = listListeningPortsWithPids()
    .filter((entry) => hostPids.has(entry.pid) && (entry.address === '127.0.0.1' || entry.address === '0.0.0.0' || entry.address === '::1'))
    .map((entry) => `http://127.0.0.1:${entry.port}`);
  if (preferred.length) unique = [...new Set([...preferred, ...unique])];
  if (!unique.length) throw new Error('没有找到正在监听的 DSH 桌面端（可用 DSH_BASE_URL 指定）');
  return unique[0];
}

// ---------------------------------------------------------------- RPC

function normalizeBase(base) {
  return new URL(base);
}

export async function dshRpc(base, method, args, { cookie, timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const url = `${String(base).replace(/\/+$/, '')}/api/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie: cookie.header || `${cookie.name}=${cookie.value}` } : {}),
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method,
        payload: { args },
      }),
      signal: controller.signal,
    });
    responseText = await response.text();
  } finally {
    clearTimeout(timer);
  }
  const text = responseText;
  if (!response.ok) {
    throw new Error(`DSH ${method} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`DSH ${method} 返回非 JSON: ${text.slice(0, 300)}`);
  }
  if (body?.result?.ok === false) {
    const error = body.result.error || {};
    throw new Error(`DSH ${method} 失败: ${error.code || 'unknown'} ${error.message || JSON.stringify(error).slice(0, 300)}`);
  }
  return body?.result?.value ?? body;
}

// ---------------------------------------------------------------- 高层能力

export class DshClient {
  constructor({ base, cookie, secretSource }) {
    this.base = base;
    this.cookie = cookie;
    this.secretSource = secretSource;
  }

  static async open(options = {}) {
    const base = options.base || discoverDshBase();
    const authority = new URL(base).host;
    const { secret, source } = options.secret ? { secret: options.secret, source: 'options' } : loadBrowserSessionSecret();
    const cookie = buildAuthCookie({ authority, secret, maxAgeMs: options.maxAgeMs });
    return { client: new DshClient({ base, cookie, secretSource: source }), authority };
  }

  async listSessions() {
    const value = await dshRpc(this.base, 'session/list', { _request: {} }, { cookie: this.cookie });
    const items = Array.isArray(value?.items) ? value.items : [];
    return items;
  }

  async readSessionPage(sessionId, { maxMessages = 30, beforeSeq, throughSeq } = {}) {
    const value = await dshRpc(
      this.base,
      'session/page',
      {
        request: {
          address: { kind: 'session', sessionId },
          maxMessages,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          ...(throughSeq === undefined ? {} : { throughSeq }),
        },
      },
      { cookie: this.cookie },
    );
    return value;
  }

  /** 创建新会话（每个项目群一个，独立记忆）。 */
  async createSession({ cwd, sessionId = null, agentPreset = null } = {}) {
    const request = {};
    if (cwd) request.cwd = cwd;
    if (sessionId) request.sessionId = sessionId;
    if (agentPreset) request.agentPreset = agentPreset;
    const value = await dshRpc(this.base, 'session/create', { request }, { cookie: this.cookie });
    return value?.sessionId || value?.id || null;
  }

  /**
   * 向指定 DSH 会话投递一条用户消息（会让该会话真正跑一轮）。
   * @param {string} sessionId
   * @param {string} text
   * @param {{mode?:'queue'|'steer'}} options
   */
  /**
   * 给会话选模型。空会话没有模型时，注入 prompt 会被 DSH 以 blocked 拒绝，
   * 所以投递前要确保会话有可用模型。
   */
  async selectModel(sessionId, selection = {}) {
    return dshRpc(
      this.base,
      'session/selectModel',
      { request: { sessionId, ...selection } },
      { cookie: this.cookie },
    );
  }

  /** 若会话还没选过模型，则选一个默认模型（deepseek-flash）。 */
  async ensureModel(sessionId, fallback = { provider: 'deepseek-official', model: 'deepseek-flash' }) {
    const sessions = await this.listSessions();
    const target = sessions.find((session) => (session.sessionId || session.id) === sessionId);
    const values = target?.projections?.values || {};
    const selected = values.modelSelection?.next || values.modelSelection?.lastUsed;
    if (selected?.provider && selected?.model) return selected;
    const result = await this.selectModel(sessionId, fallback);
    return result?.selected || fallback;
  }

  async promptSession(sessionId, text, { mode = 'queue' } = {}) {
    const value = await dshRpc(
      this.base,
      'session/prompt',
      {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode,
          content: [{ type: 'text', text: String(text) }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
      { cookie: this.cookie },
    );
    return value;
  }
}

/** 环境自检：端口、密钥来源、会话数。 */
export async function dshDoctor() {
  const result = {
    dsh_home: dshHome(),
    base: null,
    authority: null,
    secret_source: null,
    session_count: null,
    sessions: [],
    error: null,
  };
  try {
    const { client } = await DshClient.open();
    result.base = client.base;
    result.authority = new URL(client.base).host;
    result.secret_source = client.secretSource;
    const sessions = await client.listSessions();
    result.session_count = sessions.length;
    result.sessions = sessions.slice(0, 10).map((session) => ({
      id: session.id || session.sessionId,
      title: session.title || session.name || null,
      updated_at: session.updatedAt || session.updated_at || null,
    }));
  } catch (err) {
    result.error = `${err.message}`;
  }
  return result;
}

/** 读取会话最近一条 assistant 文本（用于等回复时做简单判断）。 */
export async function latestAssistantText(client, sessionId, maxMessages = 40) {
  const page = await client.readSessionPage(sessionId, { maxMessages });
  const records = Array.isArray(page?.records) ? page.records : [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    const event = record?.event || record?.data || record;
    const type = String(event?.type || record?.type || '');
    if (!type.includes('assistant/message')) continue;
    const message = event?.data?.message || event?.message || event?.data || event;
    const content = message?.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part && (part.type === 'text' || part.type === 'output_text'))
        .map((part) => part.text || part.output_text || '')
        .filter(Boolean)
        .join('\n');
      if (text) return { text, seq: event?.seq ?? record?.seq ?? null };
    }
    if (typeof message?.text === 'string' && message.text) return { text: message.text, seq: event?.seq ?? null };
  }
  return null;
}
