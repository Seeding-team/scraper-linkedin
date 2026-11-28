#!/usr/bin/env node
/**
 * SLA Alert & Multi-Channel Zalo Group Forward Persistent Engine (NDJSON)
 * ───────────────────────────────────────────────────────────────────────────
 * Persistent Node.js subprocess communicating via JSON-Lines over stdin/stdout.
 * Reuses `zca-js` session-cache pattern from `scripts/zca_api_server.js` (lazy
 * require so `--self-test`, dry-run, and unit tests run in 0ms with zero extra
 * npm packages).
 *
 * Commands (stdin -> stdout response matching `id`):
 *   - ping            : health & live stats
 *   - stats           : counters & queue gauges
 *   - enqueue-alert   : Anti-Loop -> Cooldown -> Debounce -> Rate-Limit Queue
 *                       (emits async `{"type":"delivery_result",...}` events)
 *   - send-immediate  : immediate render & send (Test Ping), returns result directly
 *   - flush-all       : flush all pending debounce buffers & drain send queues
 *   - shutdown        : flush all & exit 0
 */

"use strict";

const readline = require("readline");
const crypto = require("crypto");

const SESSION_TTL_MS = 25 * 60 * 1000; // 25 minutes
const DEFAULT_MIN_INTERVAL_MS = parseInt(process.env.SLA_ALERT_MIN_INTERVAL_MS || "2500", 10);
const DEFAULT_MAX_PER_MIN = parseInt(process.env.SLA_ALERT_MAX_PER_MIN || "20", 10);
const DEFAULT_WINDOW_MS = 60 * 1000;

const ANTI_LOOP_MARKERS = [
  "[TIN MỚI -",
  "[QUÁ HẠN SLA",
  "[SẮP QUÁ HẠN SLA",
  "[TEST THÔNG BÁO SLA",
];

const CHANNEL_LABELS = {
  zalo: "ZALO",
  messenger: "MESSENGER",
  telegram: "TELEGRAM",
  whatsapp: "WHATSAPP",
  email: "EMAIL",
};

const DEFAULT_TEMPLATES = {
  new_message: [
    "📩 [TIN MỚI - {{channel}}]{{extra_count_text}}",
    "👤 Khách: {{customer_name}} ({{customer_phone}})",
    "📱 Tài khoản: {{account_name}}",
    "💬 Nội dung: {{content}}",
    "⏰ Lúc: {{time_vn}} | Hạn SLA ({{sla_minutes}}p): {{deadline_vn}}",
    "🔗 {{open_url}}",
  ].join("\n"),
  sla_warning: [
    "⚠️ [SẮP QUÁ HẠN SLA - {{channel}}]",
    "👤 Khách: {{customer_name}} ({{customer_phone}})",
    "📱 Tài khoản: {{account_name}}",
    "⏱️ Đã chờ: {{wait_text}} / Mục tiêu {{sla_minutes}} phút",
    "💬 Tin cuối: {{content}}",
    "🔗 {{open_url}}",
  ].join("\n"),
  sla_breach: [
    "🚨 [QUÁ HẠN SLA - {{channel}}]",
    "👤 Khách: {{customer_name}} ({{customer_phone}})",
    "📱 Tài khoản: {{account_name}}",
    "⏱️ Đã chờ quá hạn: {{wait_text}} (Mục tiêu: {{sla_minutes}} phút)",
    "💬 Tin cuối: {{content}}",
    "👤 Phụ trách: {{staff_name}}",
    "🔗 {{open_url}}",
  ].join("\n"),
  test: [
    "✅ [TEST THÔNG BÁO SLA - {{channel}}]",
    "📱 Tài khoản gửi: {{account_name}}",
    "💬 Nội dung: {{content}}",
    "⏰ Lúc: {{time_vn}}",
    "🔗 {{open_url}}",
  ].join("\n"),
};

// ── Utilities ────────────────────────────────────────────────────────────────

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function serializeError(error) {
  if (!error) return { message: "Unknown error" };
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      code: error.code ?? null,
    };
  }
  if (typeof error === "object") {
    return {
      name: error.name || "NonError",
      message: error.message || safeJson(error),
      code: error.code ?? null,
    };
  }
  return { message: String(error) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function normalizeCookieJar(cookies) {
  if (!cookies) return null;
  let parsed = typeof cookies === "string" ? JSON.parse(cookies) : cookies;
  if (Array.isArray(parsed)) {
    return parsed.map((c) => {
      const copy = { ...c };
      const e = copy.expires || copy.expirationDate;
      if (typeof e === "number") copy.expires = new Date(e * 1000).toISOString();
      return copy;
    });
  }
  if (parsed && Array.isArray(parsed.cookies)) {
    return {
      ...parsed,
      cookies: parsed.cookies.map((c) => {
        const copy = { ...c };
        const e = copy.expires || copy.expirationDate;
        if (typeof e === "number") copy.expires = new Date(e * 1000).toISOString();
        return copy;
      }),
    };
  }
  return parsed;
}

function authCacheKey(auth) {
  const cookies = Array.isArray(auth?.cookies)
    ? auth.cookies
    : Array.isArray(auth?.cookies?.cookies)
      ? auth.cookies.cookies
      : [];
  const firstVal = cookies[0]?.value || "";
  const raw = `${auth?.imei || ""}|${(auth?.userAgent || "").slice(0, 80)}|${firstVal.slice(0, 32)}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function formatTimeVn(value) {
  let ms = Date.now();
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    ms = value < 1e11 ? value * 1000 : value;
  } else if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  // Fixed UTC+7 offset — never depends on OS tzdata
  const vn = new Date(ms + 7 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const hh = pad(vn.getUTCHours());
  const mm = pad(vn.getUTCMinutes());
  const dd = pad(vn.getUTCDate());
  const mo = pad(vn.getUTCMonth() + 1);
  return `${hh}:${mm} ${dd}/${mo}`;
}

function formatWaitText(seconds) {
  const secs = Math.max(0, Math.floor(Number(seconds) || 0));
  if (secs < 60) return `${secs} giây`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins} phút ${remSecs} giây` : `${mins} phút`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours} giờ ${remMins} phút` : `${hours} giờ`;
}

function checkAntiLoop(config, event) {
  const cfg = config || {};
  const evt = event || {};
  const channel = String(evt.channel || "").trim().toLowerCase();
  const convId = String(evt.conversation_id || "").trim();
  const targetGroupId = String(cfg.target_zalo_group_id || "").trim();
  const content = String(evt.content || "");
  const alertType = String(evt.alert_type || "new_message").trim().toLowerCase();

  // Never block explicit test pings unless target_zalo_group_id is missing
  if (alertType !== "test") {
    if (channel === "zalo") {
      if (targetGroupId && convId && convId === targetGroupId) {
        return { blocked: true, reason: "anti_loop_guard" };
      }
      for (const marker of ANTI_LOOP_MARKERS) {
        if (content.includes(marker)) {
          return { blocked: true, reason: "anti_loop_guard" };
        }
      }
    }
    if (Array.isArray(cfg.excluded_conversation_ids) && convId) {
      const excluded = cfg.excluded_conversation_ids.map((x) => String(x || "").trim());
      if (excluded.includes(convId)) {
        return { blocked: true, reason: "excluded_conversation" };
      }
    }
  }
  return { blocked: false, reason: null };
}

function renderTemplate(config, event, batchMeta = {}) {
  const cfg = config || {};
  const evt = event || {};
  const alertType = String(evt.alert_type || "new_message").trim().toLowerCase();
  const channelRaw = String(evt.channel || "zalo").trim().toLowerCase();
  const channelLabel = CHANNEL_LABELS[channelRaw] || channelRaw.toUpperCase();

  let tpl = "";
  if (alertType === "new_message" && cfg.new_message_template && String(cfg.new_message_template).trim()) {
    tpl = String(cfg.new_message_template);
  } else if (
    (alertType === "sla_breach" || alertType === "sla_warning") &&
    cfg.sla_breach_template &&
    String(cfg.sla_breach_template).trim() &&
    alertType === "sla_breach"
  ) {
    tpl = String(cfg.sla_breach_template);
  } else {
    tpl = DEFAULT_TEMPLATES[alertType] || DEFAULT_TEMPLATES.new_message;
  }

  const batchCount = Number(batchMeta.batchCount || evt.batch_count || 1);
  const extraCountText =
    batchMeta.extraCountText !== undefined
      ? String(batchMeta.extraCountText)
      : batchCount > 1
        ? ` (+${batchCount - 1} tin)`
        : "";

  const contentVal =
    batchMeta.combinedContent !== undefined
      ? String(batchMeta.combinedContent)
      : String(evt.content || "").trim() || "(Không có nội dung văn bản)";

  const slaMinutes =
    evt.sla_minutes != null
      ? String(evt.sla_minutes)
      : evt.target_seconds != null
        ? String(Math.max(1, Math.round(Number(evt.target_seconds) / 60)))
        : "5";

  const waitText =
    evt.wait_text ||
    (evt.wait_business_seconds != null ? formatWaitText(evt.wait_business_seconds) : formatWaitText(0));

  const vars = {
    channel: channelLabel,
    customer_name: String(evt.customer_name || "").trim() || "Khách hàng",
    customer_phone: String(evt.customer_phone || "").trim() || "Chưa rõ SĐT",
    account_name: String(evt.account_name || evt.account_id || "").trim() || "Tài khoản",
    content: contentVal.slice(0, 600),
    extra_count_text: extraCountText,
    time_vn: evt.time_vn || formatTimeVn(evt.received_at || Date.now()),
    sla_minutes: slaMinutes,
    deadline_vn: evt.deadline_vn || (evt.deadline_at ? formatTimeVn(evt.deadline_at) : "--:--"),
    wait_text: waitText,
    staff_name: String(evt.staff_name || "").trim() || "Chưa phân công",
    open_url: String(evt.open_url || "").trim() || "",
  };

  let rendered = tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
  });

  // Clean up trailing empty link line if open_url is blank
  rendered = rendered
    .split("\n")
    .filter((line) => line.trim() !== "🔗")
    .join("\n")
    .trim();

  return rendered;
}

function buildMentions(config, event, renderedText) {
  const cfg = config || {};
  const evt = event || {};
  const alertType = String(evt.alert_type || "new_message").trim().toLowerCase();
  let msg = String(renderedText || "");
  const mentions = [];

  if (alertType === "sla_breach" && cfg.mention_all_on_breach) {
    if (!msg.startsWith("@All")) {
      msg = `@All ${msg}`;
    }
    mentions.push({ pos: 0, uid: "-1", len: 4 });
  }

  if (alertType === "sla_breach" && Array.isArray(cfg.mention_zalo_uids) && cfg.mention_zalo_uids.length > 0) {
    for (const item of cfg.mention_zalo_uids) {
      const uid = typeof item === "string" ? item.trim() : String(item?.uid || "").trim();
      if (!uid || uid === "-1") continue;
      const label = typeof item === "object" && item?.name ? `@${String(item.name).trim()}` : `@${uid}`;
      const prefix = msg.endsWith("\n") ? "" : "\n";
      const pos = msg.length + prefix.length;
      msg = `${msg}${prefix}${label}`;
      mentions.push({ pos, uid, len: label.length });
    }
  }

  return { msg, mentions };
}

// ── Core Persistent Engine Class ─────────────────────────────────────────────

class SlaAlertForwardEngine {
  constructor(options = {}) {
    this.startedAt = Date.now();
    this.minIntervalMs =
      options.minIntervalMs !== undefined ? Number(options.minIntervalMs) : DEFAULT_MIN_INTERVAL_MS;
    this.maxPerMin = options.maxPerMin !== undefined ? Number(options.maxPerMin) : DEFAULT_MAX_PER_MIN;
    this.windowMs = options.windowMs !== undefined ? Number(options.windowMs) : DEFAULT_WINDOW_MS;
    this.sessionTtlMs = options.sessionTtlMs !== undefined ? Number(options.sessionTtlMs) : SESSION_TTL_MS;
    this.onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
    // Optional injectable sender for unit testing real-send paths without zca-js
    this.customSender = typeof options.customSender === "function" ? options.customSender : null;

    this._sessionCache = new Map(); // key -> { api, lastUsed }
    this._debounceBuffers = new Map(); // convKey -> { config, auth, events, batchCount, createdAt, timer }
    this._cooldownMap = new Map(); // convKey -> lastSentMs
    this._notifierQueues = new Map(); // notifierAccountId -> { queue, processing, lastSendTs, sendTimestamps, drainResolvers }

    this.stats = {
      sent_total: 0,
      failed_total: 0,
      coalesced_total: 0,
      rate_limited_total: 0,
      skipped_total: 0,
      dry_run_total: 0,
    };
  }

  getStats() {
    let queuedJobs = 0;
    for (const q of this._notifierQueues.values()) {
      queuedJobs += q.queue.length + (q.processing ? 1 : 0);
    }
    return {
      pending_debounce: this._debounceBuffers.size,
      queued_jobs: queuedJobs,
      sent_total: this.stats.sent_total,
      failed_total: this.stats.failed_total,
      coalesced_total: this.stats.coalesced_total,
      rate_limited_total: this.stats.rate_limited_total,
      skipped_total: this.stats.skipped_total,
      dry_run_total: this.stats.dry_run_total,
      active_sessions: this._sessionCache.size,
    };
  }

  getPingInfo() {
    return {
      pid: process.pid,
      uptime_ms: Date.now() - this.startedAt,
      stats: this.getStats(),
    };
  }

  _convKey(config, event) {
    const cfgId = String(config?.id || "default").trim();
    const channel = String(event?.channel || "zalo").trim().toLowerCase();
    const accountId = String(event?.account_id || "").trim();
    const convId = String(event?.conversation_id || "").trim();
    return `${cfgId}|${channel}|${accountId}|${convId}`;
  }

  _buildMeta(config, event, batchCount = 1) {
    return {
      config_id: config?.id || null,
      alert_type: String(event?.alert_type || "new_message"),
      channel: String(event?.channel || "zalo"),
      source_account_id: event?.account_id ? String(event.account_id) : null,
      source_conversation_id: event?.conversation_id ? String(event.conversation_id) : null,
      sla_turn_id: event?.sla_turn_id || null,
      target_zalo_group_id: config?.target_zalo_group_id ? String(config.target_zalo_group_id) : null,
      notifier_zalo_account_id: config?.notifier_zalo_account_id
        ? String(config.notifier_zalo_account_id)
        : null,
      batch_count: batchCount,
    };
  }

  _emitDeliveryResult(payload) {
    this.onEvent({ type: "delivery_result", ...payload });
  }

  _getNotifierState(notifierAccountId) {
    const key = String(notifierAccountId || "default").trim();
    let state = this._notifierQueues.get(key);
    if (!state) {
      state = {
        queue: [],
        processing: false,
        lastSendTs: 0,
        sendTimestamps: [],
        drainResolvers: [],
      };
      this._notifierQueues.set(key, state);
    }
    return state;
  }

  async _getZcaApi(auth, { forceRefresh = false } = {}) {
    if (!auth || typeof auth !== "object") {
      throw new Error("Missing ZCA auth credentials for notifier account");
    }
    const key = authCacheKey(auth);
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this._sessionCache.get(key);
      if (cached && now - cached.lastUsed < this.sessionTtlMs) {
        cached.lastUsed = now;
        return { api: cached.api, fromCache: true, key };
      }
    } else {
      this._sessionCache.delete(key);
    }

    // Lazy require so `--self-test`, dry-run, and offline unit tests run in 0ms
    const { Zalo } = require("zca-js");
    const cookie = normalizeCookieJar(auth.cookies);
    if (!cookie || !auth.imei || !auth.userAgent) {
      throw new Error("Missing ZCA auth fields: cookies, imei, userAgent");
    }
    const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
    const api = await zalo.login({ cookie, imei: auth.imei, userAgent: auth.userAgent });
    this._sessionCache.set(key, { api, lastUsed: now });

    // Prune stale sessions
    for (const [k, v] of this._sessionCache) {
      if (now - v.lastUsed > this.sessionTtlMs * 2) {
        this._sessionCache.delete(k);
      }
    }
    return { api, fromCache: false, key };
  }

  async _deliverReal(config, event, auth, renderedText) {
    const targetGroupId = String(config?.target_zalo_group_id || "").trim();
    if (!targetGroupId) {
      throw new Error("Missing target_zalo_group_id");
    }
    const { msg, mentions } = buildMentions(config, event, renderedText);

    if (this.customSender) {
      const response = await this.customSender({ msg, mentions, targetGroupId, config, event, auth });
      return { response, finalMsg: msg, mentions };
    }

    const messageContent = { msg };
    if (mentions.length > 0) {
      messageContent.mentions = mentions;
    }

    const { api, fromCache, key } = await this._getZcaApi(auth, { forceRefresh: false });
    try {
      // ThreadType.Group = 1
      const response = await api.sendMessage(messageContent, targetGroupId, 1);
      return { response, finalMsg: msg, mentions };
    } catch (firstErr) {
      if (!fromCache) {
        throw firstErr;
      }
      // Retry once after evicting stale cached session
      this._sessionCache.delete(key);
      const refreshed = await this._getZcaApi(auth, { forceRefresh: true });
      const response = await refreshed.api.sendMessage(messageContent, targetGroupId, 1);
      return { response, finalMsg: msg, mentions };
    }
  }

  enqueueAlert(payload) {
    const startMs = Date.now();
    const { config = {}, event = {}, auth = null } = payload || {};
    const alertType = String(event.alert_type || "new_message").trim().toLowerCase();
    const convKey = this._convKey(config, event);
    const meta = this._buildMeta(config, event, 1);

    // 1. Anti-Loop Guard
    const loopCheck = checkAntiLoop(config, event);
    if (loopCheck.blocked) {
      this.stats.skipped_total += 1;
      const result = {
        ok: true,
        status: "skipped",
        error: loopCheck.reason,
        via: "js_engine",
        latency_ms: Date.now() - startMs,
        rendered_text: null,
        meta,
      };
      this._emitDeliveryResult(result);
      return { accepted: false, status: "skipped", error: loopCheck.reason };
    }

    // 2. If an active debounce buffer already exists for this conversation & new_message,
    //    coalesce immediately (even if cooldown would apply to subsequent turns).
    if (alertType === "new_message" && this._debounceBuffers.has(convKey)) {
      const buf = this._debounceBuffers.get(convKey);
      buf.events.push(event);
      buf.batchCount += 1;
      if (auth) buf.auth = auth;
      this.stats.coalesced_total += 1;
      return { accepted: true, action: "debounced_coalesced", batch_count: buf.batchCount };
    }

    // 3. Cooldown check (new_message + new_turn_only + !force_new_turn)
    const alertMode = String(config.alert_mode || "new_turn_only").trim().toLowerCase();
    if (alertType === "new_message" && alertMode === "new_turn_only" && !event.force_new_turn) {
      const cooldownMs =
        config.cooldown_ms != null
          ? Math.max(0, Number(config.cooldown_ms))
          : Math.max(0, Number(config.cooldown_minutes ?? 15) * 60 * 1000);
      if (cooldownMs > 0) {
        const lastSent = this._cooldownMap.get(convKey);
        if (lastSent && Date.now() - lastSent < cooldownMs) {
          this.stats.skipped_total += 1;
          this._emitDeliveryResult({
            ok: true,
            status: "skipped",
            error: "cooldown_active",
            via: "js_engine",
            latency_ms: Date.now() - startMs,
            rendered_text: null,
            meta,
          });
          return { accepted: false, status: "skipped", error: "cooldown_active" };
        }
      }
    }

    // 4. Debounce for `new_message` when debounce > 0
    const debounceMs =
      config.debounce_ms != null
        ? Math.max(0, Number(config.debounce_ms))
        : Math.max(0, Math.round(Number(config.debounce_seconds ?? 8) * 1000));

    if (alertType === "new_message" && debounceMs > 0) {
      const buffer = {
        convKey,
        config,
        auth,
        events: [event],
        batchCount: 1,
        createdAt: Date.now(),
        timer: null,
      };
      buffer.timer = setTimeout(() => {
        this._flushDebounceKey(convKey);
      }, debounceMs);
      if (buffer.timer.unref) buffer.timer.unref();
      this._debounceBuffers.set(convKey, buffer);
      return { accepted: true, action: "debounced", debounce_ms: debounceMs };
    }

    // 5. Immediate enqueue into Per-Notifier Rate-Limited Queue
    //    (sla_warning, sla_breach, test, or new_message with debounce = 0)
    const renderedText = renderTemplate(config, event, { batchCount: 1 });
    this._pushToNotifierQueue({
      convKey,
      config,
      event,
      auth,
      renderedText,
      batchCount: 1,
      enqueuedAt: startMs,
    });
    return { accepted: true, action: "queued" };
  }

  _flushDebounceKey(convKey) {
    const buf = this._debounceBuffers.get(convKey);
    if (!buf) return false;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    this._debounceBuffers.delete(convKey);

    const events = buf.events;
    const latestEvent = events[events.length - 1] || {};
    const firstEvent = events[0] || {};
    const batchCount = buf.batchCount;

    // Combine preview of up to 3 latest non-empty messages
    const previews = events
      .map((e) => String(e?.content || "").trim())
      .filter(Boolean)
      .slice(-3);
    const combinedContent =
      previews.length <= 1
        ? previews[0] || "(Tin nhắn đa phương tiện)"
        : previews.map((p) => (p.length > 160 ? `${p.slice(0, 157)}...` : p)).join("\n• ");

    const mergedEvent = {
      ...firstEvent,
      ...latestEvent,
      customer_name: latestEvent.customer_name || firstEvent.customer_name,
      customer_phone: latestEvent.customer_phone || firstEvent.customer_phone,
      deadline_at: firstEvent.deadline_at || latestEvent.deadline_at,
      deadline_vn: firstEvent.deadline_vn || latestEvent.deadline_vn,
      sla_turn_id: latestEvent.sla_turn_id || firstEvent.sla_turn_id,
      open_url: latestEvent.open_url || firstEvent.open_url,
    };

    const extraCountText = batchCount > 1 ? ` (+${batchCount - 1} tin)` : "";
    const renderedText = renderTemplate(buf.config, mergedEvent, {
      batchCount,
      extraCountText,
      combinedContent: previews.length > 1 ? `• ${combinedContent}` : combinedContent,
    });

    this._pushToNotifierQueue({
      convKey,
      config: buf.config,
      event: mergedEvent,
      auth: buf.auth,
      renderedText,
      batchCount,
      enqueuedAt: buf.createdAt,
    });
    return true;
  }

  _pushToNotifierQueue(job) {
    const notifierId = String(job.config?.notifier_zalo_account_id || "default").trim();
    const state = this._getNotifierState(notifierId);
    state.queue.push(job);
    if (!state.processing) {
      this._processNotifierQueue(notifierId).catch((err) => {
        process.stderr.write(`[sla-alert-engine] queue error (${notifierId}): ${err.message}\n`);
      });
    }
  }

  async _processNotifierQueue(notifierId) {
    const state = this._getNotifierState(notifierId);
    if (state.processing) return;
    state.processing = true;

    try {
      while (state.queue.length > 0) {
        const job = state.queue.shift();
        await this._executeQueuedJob(state, job);
      }
    } finally {
      state.processing = false;
      const resolvers = state.drainResolvers.splice(0, state.drainResolvers.length);
      for (const fn of resolvers) fn();
    }
  }

  async _executeQueuedJob(notifierState, job) {
    const started = Date.now();
    const { convKey, config, event, auth, renderedText, batchCount } = job;
    const alertType = String(event?.alert_type || "new_message").trim().toLowerCase();
    const meta = this._buildMeta(config, event, batchCount);

    // Sliding window rate-limit check (60s window, maxPerMin)
    const nowBefore = Date.now();
    notifierState.sendTimestamps = notifierState.sendTimestamps.filter(
      (ts) => nowBefore - ts < this.windowMs
    );
    if (notifierState.sendTimestamps.length >= this.maxPerMin) {
      this.stats.rate_limited_total += 1;
      this._emitDeliveryResult({
        ok: false,
        status: "rate_limited",
        error: `rate_limit_exceeded (${this.maxPerMin}/min)`,
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: renderedText,
        meta,
      });
      return;
    }

    // Dry-run mode: never call zca-js
    if (config?.dry_run === true) {
      if (config?.enforce_pacing_in_dry_run && this.minIntervalMs > 0) {
        const waitMs = this.minIntervalMs - (Date.now() - notifierState.lastSendTs);
        if (waitMs > 0) await sleep(waitMs);
      }
      const sentAt = Date.now();
      notifierState.lastSendTs = sentAt;
      notifierState.sendTimestamps.push(sentAt);
      if (alertType === "new_message") {
        this._cooldownMap.set(convKey, sentAt);
      }
      this.stats.dry_run_total += 1;
      const { msg: previewMsg } = buildMentions(config, event, renderedText);
      this._emitDeliveryResult({
        ok: true,
        status: "dry_run",
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: previewMsg,
        meta,
      });
      return;
    }

    // Real send: enforce minimum spacing between consecutive messages
    if (this.minIntervalMs > 0 && notifierState.lastSendTs > 0) {
      const waitMs = this.minIntervalMs - (Date.now() - notifierState.lastSendTs);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    // Re-check sliding window after pacing sleep
    const nowAfterWait = Date.now();
    notifierState.sendTimestamps = notifierState.sendTimestamps.filter(
      (ts) => nowAfterWait - ts < this.windowMs
    );
    if (notifierState.sendTimestamps.length >= this.maxPerMin) {
      this.stats.rate_limited_total += 1;
      this._emitDeliveryResult({
        ok: false,
        status: "rate_limited",
        error: `rate_limit_exceeded (${this.maxPerMin}/min)`,
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: renderedText,
        meta,
      });
      return;
    }

    try {
      const { finalMsg } = await this._deliverReal(config, event, auth, renderedText);
      const sentAt = Date.now();
      notifierState.lastSendTs = sentAt;
      notifierState.sendTimestamps.push(sentAt);
      if (alertType === "new_message") {
        this._cooldownMap.set(convKey, sentAt);
      }
      this.stats.sent_total += 1;
      this._emitDeliveryResult({
        ok: true,
        status: "sent",
        via: "js_engine",
        latency_ms: sentAt - started,
        rendered_text: finalMsg,
        meta,
      });
    } catch (err) {
      const serialized = serializeError(err);
      this.stats.failed_total += 1;
      this._emitDeliveryResult({
        ok: false,
        status: "failed",
        error: serialized.message,
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: renderedText,
        meta,
      });
    }
  }

  async sendImmediate(payload) {
    const started = Date.now();
    const { config = {}, event = {}, auth = null } = payload || {};
    const renderedText = renderTemplate(config, event, { batchCount: 1 });
    const { msg: finalPreview } = buildMentions(config, event, renderedText);

    if (config?.dry_run === true) {
      this.stats.dry_run_total += 1;
      return {
        sent: true,
        dry_run: true,
        status: "dry_run",
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: finalPreview,
      };
    }

    try {
      const { response, finalMsg } = await this._deliverReal(config, event, auth, renderedText);
      this.stats.sent_total += 1;
      return {
        sent: true,
        dry_run: false,
        status: "sent",
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: finalMsg,
        response,
      };
    } catch (err) {
      const serialized = serializeError(err);
      this.stats.failed_total += 1;
      return {
        sent: false,
        dry_run: false,
        status: "failed",
        via: "js_engine",
        latency_ms: Date.now() - started,
        rendered_text: finalPreview,
        error: serialized.message,
      };
    }
  }

  async flushAll() {
    const keys = Array.from(this._debounceBuffers.keys());
    for (const key of keys) {
      this._flushDebounceKey(key);
    }

    const waitPromises = [];
    for (const state of this._notifierQueues.values()) {
      if (state.processing || state.queue.length > 0) {
        waitPromises.push(
          new Promise((resolve) => {
            state.drainResolvers.push(resolve);
          })
        );
      }
    }
    if (waitPromises.length > 0) {
      await Promise.all(waitPromises);
    }
    return {
      flushed_buffers: keys.length,
      stats: this.getStats(),
    };
  }
}

// ── Self-Test Mode (`node scripts/sla_alert_forward_engine.js --self-test`) ──

async function runSelfTest() {
  const emitted = [];
  const engine = new SlaAlertForwardEngine({
    minIntervalMs: 0,
    maxPerMin: 20,
    onEvent: (evt) => emitted.push(evt),
  });

  // 1. Anti-Loop
  const loopRes = engine.enqueueAlert({
    config: { id: "c1", target_zalo_group_id: "g_target", dry_run: true },
    event: { alert_type: "new_message", channel: "zalo", conversation_id: "g_target", content: "hello" },
  });
  if (loopRes.status !== "skipped" || loopRes.error !== "anti_loop_guard") {
    throw new Error("Self-test failed: anti_loop_guard");
  }

  // 2. Debounce coalesce 3 msgs
  for (let i = 1; i <= 3; i++) {
    engine.enqueueAlert({
      config: {
        id: "c1",
        notifier_zalo_account_id: "acc1",
        target_zalo_group_id: "g_target",
        dry_run: true,
        debounce_ms: 40,
      },
      event: {
        alert_type: "new_message",
        channel: "zalo",
        account_id: "acc_src",
        conversation_id: "conv_1",
        customer_name: "Anh Nam",
        content: `Tin ${i}`,
        force_new_turn: i === 1,
      },
    });
  }
  await sleep(90);
  await engine.flushAll();

  const dryRunEvt = emitted.find((e) => e.status === "dry_run");
  if (!dryRunEvt || !dryRunEvt.rendered_text.includes("(+2 tin)")) {
    throw new Error("Self-test failed: debounce (+2 tin)");
  }

  // 3. Cooldown active
  const cdRes = engine.enqueueAlert({
    config: {
      id: "c1",
      notifier_zalo_account_id: "acc1",
      target_zalo_group_id: "g_target",
      dry_run: true,
      alert_mode: "new_turn_only",
      cooldown_minutes: 15,
      debounce_ms: 0,
    },
    event: {
      alert_type: "new_message",
      channel: "zalo",
      account_id: "acc_src",
      conversation_id: "conv_1",
      content: "Tin thứ 4",
      force_new_turn: false,
    },
  });
  if (cdRes.status !== "skipped" || cdRes.error !== "cooldown_active") {
    throw new Error("Self-test failed: cooldown_active");
  }

  process.stdout.write(JSON.stringify({ ok: true, self_test: "passed", stats: engine.getStats() }) + "\n");
  process.exit(0);
}

// ── Stdio NDJSON Persistent Server ───────────────────────────────────────────

function startStdioServer() {
  function sendLine(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  const engine = new SlaAlertForwardEngine({
    onEvent: (evt) => sendLine(evt),
  });

  async function handleRequest(req) {
    const id = req?.id ?? null;
    const cmd = String(req?.cmd || req?.command || "").trim();
    const payload = req?.payload || {};

    if (!cmd) {
      sendLine({ id, ok: false, error: "Missing 'cmd' field" });
      return;
    }

    try {
      if (cmd === "ping") {
        sendLine({ id, ok: true, result: engine.getPingInfo() });
        return;
      }
      if (cmd === "stats") {
        sendLine({ id, ok: true, result: engine.getStats() });
        return;
      }
      if (cmd === "enqueue-alert") {
        const result = engine.enqueueAlert(payload);
        sendLine({ id, ok: true, result });
        return;
      }
      if (cmd === "send-immediate") {
        const result = await engine.sendImmediate(payload);
        sendLine({ id, ok: Boolean(result.sent), result, error: result.error || undefined });
        return;
      }
      if (cmd === "flush-all") {
        const result = await engine.flushAll();
        sendLine({ id, ok: true, result });
        return;
      }
      if (cmd === "shutdown") {
        const result = await engine.flushAll();
        sendLine({ id, ok: true, result: { message: "shutting down", ...result } });
        setImmediate(() => process.exit(0));
        return;
      }
      sendLine({ id, ok: false, error: `Unknown command: ${cmd}` });
    } catch (err) {
      const serialized = serializeError(err);
      sendLine({ id, ok: false, error: serialized.message, error_detail: serialized });
    }
  }

  process.stderr.write("[sla-alert-engine] ready\n");

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch (_) {
      sendLine({ id: null, ok: false, error: `Invalid JSON: ${trimmed.slice(0, 200)}` });
      return;
    }
    handleRequest(req).catch((err) => {
      sendLine({ id: req?.id ?? null, ok: false, error: String(err) });
    });
  });

  rl.on("close", () => {
    engine
      .flushAll()
      .catch(() => {})
      .finally(() => {
        process.stderr.write("[sla-alert-engine] stdin closed — shutting down\n");
        process.exit(0);
      });
  });

  process.on("uncaughtException", (err) => {
    process.stderr.write(`[sla-alert-engine] uncaughtException: ${err.message}\n`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`[sla-alert-engine] unhandledRejection: ${reason}\n`);
  });
}

if (require.main === module) {
  if (process.argv.includes("--self-test")) {
    runSelfTest().catch((err) => {
      process.stderr.write(`[sla-alert-engine] self-test failed: ${err.message}\n`);
      process.exit(1);
    });
  } else {
    startStdioServer();
  }
}

module.exports = {
  SlaAlertForwardEngine,
  renderTemplate,
  checkAntiLoop,
  normalizeCookieJar,
  buildMentions,
  formatTimeVn,
  formatWaitText,
  DEFAULT_TEMPLATES,
  ANTI_LOOP_MARKERS,
};
