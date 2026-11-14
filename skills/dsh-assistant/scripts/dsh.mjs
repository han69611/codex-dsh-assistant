/**
 * dsh.mjs �� DeepSeek Harness ��������������ⲿ�������������е� DSH��
 *
 * ԭ������ʵ�⣩��
 *  - DSH ������� 127.0.0.1:<����˿�> ��¶���� HTTP API��`POST /api/<namespace>/<method>`��
 *  - ��֤=һ�� v1 ����� cookie��ǩ����Կ�־û��� ~/.dsh/.credentials.yaml ��
 *    `client-connection/browser-session` ��¼�����ͬ�û����̿ɶ�������˿���������ǩ��
 *  - �ŷ⣺{type:'client-request', rpcId, method, payload:{args:{<������>:<ֵ>}}}
 *    ��Ӧ��{type:'server-response', rpcId, result:{ok:true, value} | {ok:false, error}}
 *
 * ������
 *  - listSessions(): �г��Ự��ֻ���������� agent��
 *  - readSessionPage(): ��ȡһ�λỰ��ʷ��ֻ����
 *  - promptSession(): ��ָ���ỰͶ��һ���û���Ϣ��������һ�֣��и����ã����Ķ�ȡ�ִ�й��ߣ�
 *
 * ��ȫ����ǩ cookie �ȼ� owner Ȩ�ޡ�Ĭ��ֻ����prompt ��Ҫ��ʽ sessionId��
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COOKIE_PREFIX = 'dsh-auth-';
const COOKIE_PAYLOAD_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 Сʱ

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// ---------------------------------------------------------------- ��Կ�� cookie

/** �� ~/.dsh/.credentials.yaml ��ȡ client-connection/browser-session ��ǩ����Կ�� */
export function loadBrowserSessionSecret() {
  if (process.env.DSH_BROWSER_SESSION_SECRET) {
    return { secret: Buffer.from(process.env.DSH_BROWSER_SESSION_SECRET, 'base64url'), source: 'env:DSH_BROWSER_SESSION_SECRET' };
  }
  const file = process.env.DSH_CREDENTIALS_FILE || path.join(dshHome(), '.credentials.yaml');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`������ DSH ƾ���ļ� ${file}: ${err.message}`);
  }

  // ���� JSON ��� YAML ���ָ�ʽ
  let secretValue = null;
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    /* ���� JSON */
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
      if (indent <= baseIndent && /^\S/.test(line)) break; // ��һ�������¼
      const match = line.match(/^\s*secret:\s*['"]?([A-Za-z0-9_\-+/=]+)['"]?\s*$/);
      if (match) {
        secretValue = match[1];
        break;
      }
    }
  }
  if (!secretValue) {
    throw new Error(`�� ${file} ���Ҳ��� client-connection/browser-session.secret`);
  }
  const secret = Buffer.from(secretValue, 'base64url');
  if (secret.byteLength !== 32) throw new Error('browser-session ��Կ���Ȳ��� 32 �ֽ�');
  return { secret, source: file };
}

/** ����һ���Ϸ��� v1 ����� cookie�� */
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

// ---------------------------------------------------------------- �˿ڷ���

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

/** �ҳ��������� HTTP API �� desktop host ���̣��ų� ego-cast-worker ��ͬ���ӽ��̣��� */
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
    /* ̽��ʧ��ʱ�˻ؾ��߼� */
  }
  hostPidCache = { at: Date.now(), pids };
  return pids;
}

/** �� DSH ����˼����ı��ض˿ڣ�ÿ����������������������֣��� */
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
  // ����ѡ desktop host �Ķ˿ڣ�ego-cast-worker ���ӽ���Ҳ���ܼ����˿ڣ���û�� /api
  const hostPids = dshDesktopHostPids();
  const preferred = listListeningPortsWithPids()
    .filter((entry) => hostPids.has(entry.pid) && (entry.address === '127.0.0.1' || entry.address === '0.0.0.0' || entry.address === '::1'))
    .map((entry) => `http://127.0.0.1:${entry.port}`);
  if (preferred.length) unique = [...new Set([...preferred, ...unique])];
  if (!unique.length) throw new Error('û���ҵ����ڼ����� DSH ����ˣ����� DSH_BASE_URL ָ����');
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
    throw new Error(`DSH ${method} ���ط� JSON: ${text.slice(0, 300)}`);
  }
  if (body?.result?.ok === false) {
    const error = body.result.error || {};
    throw new Error(`DSH ${method} ʧ��: ${error.code || 'unknown'} ${error.message || JSON.stringify(error).slice(0, 300)}`);
  }
  return body?.result?.value ?? body;
}

// ---------------------------------------------------------------- �߲�����

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

  /** �����»Ự��ÿ����ĿȺһ�����������䣩�� */
  async createSession({ cwd, sessionId = null, agentPreset = null } = {}) {
    const request = {};
    if (cwd) request.cwd = cwd;
    if (sessionId) request.sessionId = sessionId;
    if (agentPreset) request.agentPreset = agentPreset;
    const value = await dshRpc(this.base, 'session/create', { request }, { cookie: this.cookie });
    return value?.sessionId || value?.id || null;
  }

  /**
   * ��ָ�� DSH �ỰͶ��һ���û���Ϣ�����øûỰ������һ�֣���
   * @param {string} sessionId
   * @param {string} text
   * @param {{mode?:'queue'|'steer'}} options
   */
  /**
   * ���Ựѡģ�͡��ջỰû��ģ��ʱ��ע�� prompt �ᱻ DSH �� blocked �ܾ���
   * ����Ͷ��ǰҪȷ���Ự�п���ģ�͡�
   */
  async selectModel(sessionId, selection = {}) {
    return dshRpc(
      this.base,
      'session/selectModel',
      { request: { sessionId, ...selection } },
      { cookie: this.cookie },
    );
  }

  /** ���Ự��ûѡ��ģ�ͣ���ѡһ��Ĭ��ģ�ͣ�deepseek-flash���� */
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

/** �����Լ죺�˿ڡ���Կ��Դ���Ự���� */
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

/** ��ȡ�Ự���һ�� assistant �ı������ڵȻظ�ʱ�����жϣ��� */
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
