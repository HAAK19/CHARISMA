import { NostrEvent, verifyEvent } from 'nostr-tools/pure';
import { Filter } from 'nostr-tools/filter';
import { RelayConfig } from '../types/charisma';

export const DEFAULT_NOSTR_RELAYS: RelayConfig[] = [
  {
    url: 'wss://nos.lol',
    read: true,
    write: true,
    isSearch: false,
    status: 'disconnected',
  },
  {
    url: 'wss://relay.primal.net',
    read: true,
    write: true,
    isSearch: false,
    status: 'disconnected',
  },
  {
    url: 'wss://relay.damus.io',
    read: true,
    write: true,
    isSearch: false,
    status: 'disconnected',
  },
  {
    url: 'wss://purplepag.es',
    read: true,
    write: false,
    isSearch: false,
    status: 'disconnected',
  },
  {
    url: 'wss://relay.nostr.band',
    read: true,
    write: false,
    isSearch: true,
    status: 'disconnected',
  },
];

export function normalizeRelayUrl(rawUrl: string): string | null {
  try {
    let trimmed = rawUrl.trim();
    if (!trimmed) return null;
    if (!trimmed.includes('://')) trimmed = `wss://${trimmed}`;
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    parsed.hash = '';
    let str = parsed.toString();
    if (str.endsWith('/') && parsed.pathname === '/') {
      str = str.slice(0, -1);
    }
    return str;
  } catch {
    return null;
  }
}

export interface Nip11Info {
  name?: string;
  description?: string;
  supported_nips?: number[];
  limitation?: {
    payment_required?: boolean;
    auth_required?: boolean;
    max_message_length?: number;
  };
}

export async function fetchRelayNip11(relayUrl: string): Promise<Nip11Info | null> {
  try {
    const httpUrl = relayUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as Nip11Info;
  } catch {
    return null;
  }
}

export interface RelayPingResult {
  url: string;
  ok: boolean;
  latencyMs: number | null;
  mode: 'eose-rtt' | 'ws-open' | 'error';
  error?: string;
  checkedAt: number;
}

export async function pingRelayUrl(rawUrl: string, timeoutMs = 4500): Promise<RelayPingResult> {
  const checkedAt = Date.now();
  const url = normalizeRelayUrl(rawUrl);
  if (!url) {
    return {
      url: rawUrl.trim(),
      ok: false,
      latencyMs: null,
      mode: 'error',
      error: 'Invalid wss:// relay URL',
      checkedAt,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let eoseFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const pingSubId = `ping_${Math.random().toString(36).slice(2, 10)}`;
    const tStart = performance.now();
    let reqStart = tStart;
    let openMs: number | null = null;

    const finish = (result: RelayPingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (eoseFallbackTimer) clearTimeout(eoseFallbackTimer);
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify(['CLOSE', pingSubId]));
          ws.close();
        } catch {
          // Ignore close errors
        }
      } else if (ws && ws.readyState === 0) {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
      resolve(result);
    };

    const overallTimer = setTimeout(() => {
      if (openMs !== null) {
        finish({
          url,
          ok: true,
          latencyMs: openMs,
          mode: 'ws-open',
          checkedAt: Date.now(),
        });
      } else {
        finish({
          url,
          ok: false,
          latencyMs: null,
          mode: 'error',
          error: `Timeout after ${timeoutMs} ms`,
          checkedAt: Date.now(),
        });
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      finish({
        url,
        ok: false,
        latencyMs: null,
        mode: 'error',
        error: err instanceof Error ? err.message : 'WebSocket failed',
        checkedAt,
      });
      return;
    }

    ws.onopen = () => {
      openMs = Math.max(1, Math.round(performance.now() - tStart));
      reqStart = performance.now();
      try {
        ws?.send(
          JSON.stringify([
            'REQ',
            pingSubId,
            { ids: ['0000000000000000000000000000000000000000000000000000000000000000'], limit: 1 },
          ]),
        );
      } catch {
        finish({
          url,
          ok: true,
          latencyMs: openMs,
          mode: 'ws-open',
          checkedAt: Date.now(),
        });
        return;
      }

      // If relay doesn't answer EOSE quickly, fall back to handshake latency cleanly
      eoseFallbackTimer = setTimeout(() => {
        if (openMs !== null) {
          finish({
            url,
            ok: true,
            latencyMs: openMs,
            mode: 'ws-open',
            checkedAt: Date.now(),
          });
        }
      }, 1800);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const frame = JSON.parse(ev.data) as unknown;
        if (!Array.isArray(frame)) return;
        if ((frame[0] === 'EOSE' || frame[0] === 'CLOSED') && frame[1] === pingSubId) {
          const rttMs = Math.max(1, Math.round(performance.now() - reqStart));
          finish({
            url,
            ok: true,
            latencyMs: rttMs,
            mode: 'eose-rtt',
            checkedAt: Date.now(),
          });
        }
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onerror = () => {
      // Do NOT call ws.close() inside onerror (Node 22 undici safety)
      if (openMs === null) {
        finish({
          url,
          ok: false,
          latencyMs: null,
          mode: 'error',
          error: 'WebSocket connection error',
          checkedAt: Date.now(),
        });
      }
    };

    ws.onclose = () => {
      if (!settled) {
        finish({
          url,
          ok: openMs !== null,
          latencyMs: openMs,
          mode: openMs !== null ? 'ws-open' : 'error',
          error: openMs === null ? 'Connection closed by relay' : undefined,
          checkedAt: Date.now(),
        });
      }
    };
  });
}

interface ActiveSub {
  subId: string;
  filters: Filter[];
  relayUrls: string[];
  onEvent: (event: NostrEvent, relayUrl: string) => void;
  onEose?: (relayUrl: string) => void;
  seenIds: Set<string>;
}

interface RelayConn {
  url: string;
  ws: WebSocket | null;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  latencyMs?: number;
  lastError?: string;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pendingAcks: Map<string, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>;
  pendingPings: Map<string, (frameType: string) => void>;
  manualClosed: boolean;
}

export class NostrRelayPool {
  private relays = new Map<string, RelayConfig>();
  private conns = new Map<string, RelayConn>();
  private subs = new Map<string, ActiveSub>();
  private statusListeners = new Set<(statuses: RelayConfig[]) => void>();
  private destroyed = false;

  constructor(initialRelays: RelayConfig[] = DEFAULT_NOSTR_RELAYS) {
    this.setRelays(initialRelays);
  }

  onStatusChange(cb: (statuses: RelayConfig[]) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.getRelays());
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private emitStatus() {
    const list = this.getRelays();
    for (const cb of this.statusListeners) {
      try {
        cb(list);
      } catch {
        // Ignore listener error
      }
    }
  }

  getRelays(): RelayConfig[] {
    return Array.from(this.relays.values()).map((cfg) => {
      const conn = this.conns.get(cfg.url);
      return {
        ...cfg,
        status: conn?.status ?? 'disconnected',
        latencyMs: conn?.latencyMs,
        lastError: conn?.lastError,
      };
    });
  }

  getConnectedUrls(mode: 'read' | 'write' | 'search' = 'read'): string[] {
    return this.getRelays()
      .filter((r) => {
        if (r.status !== 'connected') return false;
        if (mode === 'write') return r.write;
        if (mode === 'search') return Boolean(r.isSearch || r.supportedNips?.includes(50));
        return r.read;
      })
      .map((r) => r.url);
  }

  setRelays(configs: RelayConfig[]) {
    const nextUrls = new Set<string>();
    for (const cfg of configs) {
      const normalized = normalizeRelayUrl(cfg.url);
      if (!normalized) continue;
      nextUrls.add(normalized);
      const existing = this.relays.get(normalized);
      this.relays.set(normalized, {
        ...existing,
        ...cfg,
        url: normalized,
      });
      if (!this.conns.has(normalized) && !this.destroyed) {
        this.connectRelay(normalized);
      }
    }

    // Disconnect removed relays
    for (const oldUrl of Array.from(this.relays.keys())) {
      if (!nextUrls.has(oldUrl)) {
        this.disconnectRelay(oldUrl);
        this.relays.delete(oldUrl);
      }
    }
    this.emitStatus();
  }

  connectRelay(rawUrl: string) {
    const url = normalizeRelayUrl(rawUrl);
    if (!url || this.destroyed) return;
    const prev = this.conns.get(url);
    if (prev?.ws && (prev.status === 'connected' || prev.status === 'connecting')) {
      return;
    }
    if (prev?.reconnectTimer) {
      clearTimeout(prev.reconnectTimer);
    }

    const conn: RelayConn = prev ?? {
      url,
      ws: null,
      status: 'connecting',
      reconnectAttempts: 0,
      reconnectTimer: null,
      pendingAcks: new Map(),
      pendingPings: new Map(),
      manualClosed: false,
    };

    conn.manualClosed = false;
    conn.status = 'connecting';
    conn.lastError = undefined;
    this.conns.set(url, conn);
    this.emitStatus();

    const connectStarted = Date.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      conn.status = 'error';
      conn.lastError = err instanceof Error ? err.message : 'WebSocket creation failed';
      this.scheduleReconnect(conn);
      this.emitStatus();
      return;
    }

    conn.ws = ws;

    ws.onopen = () => {
      if (conn.ws !== ws || this.destroyed) return;
      conn.status = 'connected';
      conn.latencyMs = Date.now() - connectStarted;
      conn.reconnectAttempts = 0;
      conn.lastError = undefined;
      this.emitStatus();

      // Fetch NIP-11 relay capabilities in background (non-blocking)
      fetchRelayNip11(url).then((info) => {
        if (!info) return;
        const cfg = this.relays.get(url);
        if (!cfg) return;
        this.relays.set(url, {
          ...cfg,
          name: info.name || cfg.name,
          supportedNips: info.supported_nips || cfg.supportedNips,
          isSearch: cfg.isSearch || Boolean(info.supported_nips?.includes(50)),
          paymentRequired: info.limitation?.payment_required,
        });
        this.emitStatus();
      });

      // Re-send active subscriptions targeting this relay
      for (const sub of this.subs.values()) {
        if (sub.relayUrls.length === 0 || sub.relayUrls.includes(url)) {
          this.sendReq(ws, sub.subId, sub.filters);
        }
      }
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!Array.isArray(frame) || typeof frame[0] !== 'string') return;

      const type = frame[0];
      if (type === 'EVENT' && typeof frame[1] === 'string' && frame[2]) {
        const subId = frame[1];
        const event = frame[2] as NostrEvent;
        const sub = this.subs.get(subId);
        if (!sub) return;
        if (sub.seenIds.has(event.id)) return;
        if (!verifyEvent(event)) return;
        sub.seenIds.add(event.id);
        sub.onEvent(event, url);
      } else if ((type === 'EOSE' || type === 'CLOSED') && typeof frame[1] === 'string') {
        const subId = frame[1];
        const pingCb = conn.pendingPings.get(subId);
        if (pingCb) {
          conn.pendingPings.delete(subId);
          pingCb(type);
          return;
        }
        if (type === 'EOSE') {
          const sub = this.subs.get(subId);
          sub?.onEose?.(url);
        }
      } else if (type === 'OK' && typeof frame[1] === 'string') {
        const eventId = frame[1];
        const accepted = Boolean(frame[2]);
        const pending = conn.pendingAcks.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          conn.pendingAcks.delete(eventId);
          pending.resolve(accepted);
        }
      }
    };

    ws.onerror = () => {
      if (conn.ws !== ws) return;
      conn.status = 'error';
      conn.lastError = 'Relay socket error';
      this.emitStatus();
      // Do NOT call ws.close() inside onerror (prevents undici recursive loop in Node 22)
    };

    ws.onclose = () => {
      if (conn.ws !== ws) return;
      conn.ws = null;
      for (const [, p] of conn.pendingAcks) {
        clearTimeout(p.timer);
        p.resolve(false);
      }
      conn.pendingAcks.clear();
      for (const [, cb] of conn.pendingPings) {
        cb('CLOSED');
      }
      conn.pendingPings.clear();

      if (conn.manualClosed || this.destroyed) {
        conn.status = 'disconnected';
        this.emitStatus();
        return;
      }

      conn.status = 'disconnected';
      this.scheduleReconnect(conn);
      this.emitStatus();
    };
  }

  private scheduleReconnect(conn: RelayConn) {
    if (conn.manualClosed || this.destroyed) return;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.reconnectAttempts += 1;
    const delay = Math.min(30_000, 2500 * Math.pow(1.6, Math.min(conn.reconnectAttempts - 1, 5)));
    conn.reconnectTimer = setTimeout(() => {
      if (!this.destroyed && !conn.manualClosed && this.relays.has(conn.url)) {
        this.connectRelay(conn.url);
      }
    }, delay);
  }

  disconnectRelay(rawUrl: string) {
    const url = normalizeRelayUrl(rawUrl);
    if (!url) return;
    const conn = this.conns.get(url);
    if (!conn) return;
    conn.manualClosed = true;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
    try {
      if (conn.ws && (conn.ws.readyState === 0 || conn.ws.readyState === 1)) {
        conn.ws.close();
      }
    } catch {
      // Ignore close error
    }
    conn.ws = null;
    conn.status = 'disconnected';
    this.conns.delete(url);
    this.emitStatus();
  }

  private sendReq(ws: WebSocket, subId: string, filters: Filter[]) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(['REQ', subId, ...filters]));
    } catch {
      // Ignore transient send error
    }
  }

  subscribe(
    filters: Filter[],
    relayUrls: string[] | undefined,
    onEvent: (event: NostrEvent, relayUrl: string) => void,
    onEose?: (relayUrl: string) => void,
  ): () => void {
    const subId = `sub_${Math.random().toString(36).slice(2, 10)}`;
    const normalizedTargets = (relayUrls || [])
      .map((u) => normalizeRelayUrl(u))
      .filter((u): u is string => Boolean(u));

    const sub: ActiveSub = {
      subId,
      filters,
      relayUrls: normalizedTargets,
      onEvent,
      onEose,
      seenIds: new Set(),
    };
    this.subs.set(subId, sub);

    for (const [url, conn] of this.conns.entries()) {
      if (
        conn.status === 'connected' &&
        conn.ws &&
        (normalizedTargets.length === 0 || normalizedTargets.includes(url))
      ) {
        this.sendReq(conn.ws, subId, filters);
      }
    }

    return () => {
      this.subs.delete(subId);
      for (const conn of this.conns.values()) {
        if (conn.ws && conn.ws.readyState === 1) {
          try {
            conn.ws.send(JSON.stringify(['CLOSE', subId]));
          } catch {
            // Ignore
          }
        }
      }
    };
  }

  async queryOnce(
    filters: Filter[],
    relayUrls?: string[],
    timeoutMs = 3800,
  ): Promise<NostrEvent[]> {
    const targets = (relayUrls && relayUrls.length > 0
      ? relayUrls
      : this.getConnectedUrls('read')
    )
      .map((u) => normalizeRelayUrl(u))
      .filter((u): u is string => Boolean(u));

    // Ensure ad-hoc relay hints are connected if not already in pool
    for (const url of targets) {
      if (!this.conns.has(url) && !this.destroyed) {
        this.relays.set(url, { url, read: true, write: false, status: 'connecting' });
        this.connectRelay(url);
      }
    }

    const activeTargets = targets.filter((url) => this.conns.get(url)?.status === 'connected');
    if (activeTargets.length === 0 && targets.length === 0) return [];

    return new Promise((resolve) => {
      const results: NostrEvent[] = [];
      const eosedRelays = new Set<string>();
      const expectedCount = Math.max(1, activeTargets.length || targets.length);
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsub();
        resolve(results);
      };

      const unsub = this.subscribe(
        filters,
        targets,
        (ev) => results.push(ev),
        (relayUrl) => {
          eosedRelays.add(relayUrl);
          if (eosedRelays.size >= expectedCount) {
            finish();
          }
        },
      );

      const timer = setTimeout(finish, timeoutMs);
    });
  }

  async publishEvent(
    event: NostrEvent,
    explicitRelayUrls?: string[],
    timeoutMs = 4500,
  ): Promise<{ publishedRelays: string[]; failedRelays: string[] }> {
    const targets = (
      explicitRelayUrls && explicitRelayUrls.length > 0
        ? explicitRelayUrls
        : this.getRelays()
            .filter((r) => r.write)
            .map((r) => r.url)
    )
      .map((u) => normalizeRelayUrl(u))
      .filter((u): u is string => Boolean(u));

    if (targets.length === 0) {
      return { publishedRelays: [], failedRelays: [] };
    }

    const publishedRelays: string[] = [];
    const failedRelays: string[] = [];

    await Promise.all(
      targets.map(
        (url) =>
          new Promise<void>((resolve) => {
            const conn = this.conns.get(url);
            if (!conn || conn.status !== 'connected' || !conn.ws || conn.ws.readyState !== 1) {
              failedRelays.push(url);
              resolve();
              return;
            }

            const timer = setTimeout(() => {
              conn.pendingAcks.delete(event.id);
              failedRelays.push(url);
              resolve();
            }, timeoutMs);

            conn.pendingAcks.set(event.id, {
              timer,
              resolve: (ok) => {
                if (ok) publishedRelays.push(url);
                else failedRelays.push(url);
                resolve();
              },
            });

            try {
              conn.ws.send(JSON.stringify(['EVENT', event]));
            } catch {
              clearTimeout(timer);
              conn.pendingAcks.delete(event.id);
              failedRelays.push(url);
              resolve();
            }
          }),
      ),
    );

    return { publishedRelays, failedRelays };
  }

  async pingRelay(rawUrl: string, timeoutMs = 4500): Promise<RelayPingResult> {
    const url = normalizeRelayUrl(rawUrl);
    if (!url) {
      return {
        url: rawUrl.trim(),
        ok: false,
        latencyMs: null,
        mode: 'error',
        error: 'Invalid wss:// relay URL',
        checkedAt: Date.now(),
      };
    }

    const conn = this.conns.get(url);
    if (conn && conn.status === 'connected' && conn.ws && conn.ws.readyState === 1) {
      const ws = conn.ws;
      const pingSubId = `ping_${Math.random().toString(36).slice(2, 10)}`;
      const t0 = performance.now();

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: RelayPingResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          conn.pendingPings.delete(pingSubId);
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(['CLOSE', pingSubId]));
            } catch {
              // Ignore
            }
          }
          resolve(result);
        };

        const timer = setTimeout(() => {
          finish({
            url,
            ok: false,
            latencyMs: null,
            mode: 'error',
            error: `Ping timeout (${timeoutMs} ms)`,
            checkedAt: Date.now(),
          });
        }, timeoutMs);

        conn.pendingPings.set(pingSubId, () => {
          const latencyMs = Math.max(1, Math.round(performance.now() - t0));
          conn.latencyMs = latencyMs;
          this.emitStatus();
          finish({
            url,
            ok: true,
            latencyMs,
            mode: 'eose-rtt',
            checkedAt: Date.now(),
          });
        });

        try {
          ws.send(
            JSON.stringify([
              'REQ',
              pingSubId,
              { ids: ['0000000000000000000000000000000000000000000000000000000000000000'], limit: 1 },
            ]),
          );
        } catch (err) {
          finish({
            url,
            ok: false,
            latencyMs: null,
            mode: 'error',
            error: err instanceof Error ? err.message : 'Ping send failed',
            checkedAt: Date.now(),
          });
        }
      });
    }

    const result = await pingRelayUrl(url, timeoutMs);
    if (result.ok && result.latencyMs !== null && conn) {
      conn.latencyMs = result.latencyMs;
      this.emitStatus();
    }
    return result;
  }

  destroy() {
    this.destroyed = true;
    for (const url of Array.from(this.conns.keys())) {
      this.disconnectRelay(url);
    }
    this.subs.clear();
    this.statusListeners.clear();
  }
}
