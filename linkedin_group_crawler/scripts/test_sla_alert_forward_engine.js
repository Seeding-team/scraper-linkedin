#!/usr/bin/env node
/**
 * Comprehensive Unit + Live Child-Process IPC Test Suite for
 * `scripts/sla_alert_forward_engine.js`.
 *
 * Run directly:
 *   node d:\CrawlDataLinkedin\linkedin_group_crawler\scripts\test_sla_alert_forward_engine.js
 */

"use strict";

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const engineModule = require(path.join(__dirname, "sla_alert_forward_engine.js"));
const {
  SlaAlertForwardEngine,
  renderTemplate,
  checkAntiLoop,
  normalizeCookieJar,
  buildMentions,
  formatTimeVn,
  formatWaitText,
  ANTI_LOOP_MARKERS,
} = engineModule;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];

async function runTest(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const dt = Date.now() - t0;
    results.push({ name, passed: true, durationMs: dt });
    console.log(`  [PASS] ${name} (${dt}ms)`);
  } catch (err) {
    const dt = Date.now() - t0;
    results.push({ name, passed: false, durationMs: dt, error: err });
    console.error(`  [FAIL] ${name} (${dt}ms): ${err && err.stack ? err.stack : err}`);
  }
}

async function main() {
  console.log("=== Running Node.js Tests: sla_alert_forward_engine.js ===");

  // 1. Anti-Loop Guard (direct function + engine enqueue)
  await runTest("TC-JS-01: Anti-Loop Guard blocks same target Zalo group, alert markers, and excluded conversations", async () => {
    const emitted = [];
    const engine = new SlaAlertForwardEngine({
      minIntervalMs: 0,
      onEvent: (evt) => emitted.push(evt),
    });

    const baseCfg = {
      id: "cfg-loop",
      notifier_zalo_account_id: "zl_notifier",
      target_zalo_group_id: "grp_shared_999",
      excluded_conversation_ids: ["conv_vip_excluded"],
      dry_run: true,
      debounce_ms: 0,
    };

    // 1a. Same target Zalo group ID
    const res1 = engine.enqueueAlert({
      config: baseCfg,
      event: {
        alert_type: "new_message",
        channel: "zalo",
        account_id: "zl_src",
        conversation_id: "grp_shared_999",
        content: "Tin nhắn bình thường trong nhóm đích",
      },
    });
    assert.strictEqual(res1.accepted, false);
    assert.strictEqual(res1.status, "skipped");
    assert.strictEqual(res1.error, "anti_loop_guard");

    // 1b. Every anti-loop marker on Zalo channel
    for (const marker of ANTI_LOOP_MARKERS) {
      const check = checkAntiLoop(baseCfg, {
        alert_type: "new_message",
        channel: "zalo",
        conversation_id: "conv_other",
        content: `Prefix ${marker} nội dung cảnh báo`,
      });
      assert.strictEqual(check.blocked, true, `Marker ${marker} must be blocked`);
      assert.strictEqual(check.reason, "anti_loop_guard");
    }

    // 1c. Excluded conversation ID
    const resExcl = engine.enqueueAlert({
      config: baseCfg,
      event: {
        alert_type: "new_message",
        channel: "messenger",
        account_id: "fb_1",
        conversation_id: "conv_vip_excluded",
        content: "Xin chào",
      },
    });
    assert.strictEqual(resExcl.accepted, false);
    assert.strictEqual(resExcl.status, "skipped");
    assert.strictEqual(resExcl.error, "excluded_conversation");

    // 1d. Non-Zalo channel with marker text is NOT blocked by Zalo loop guard
    const checkNonZalo = checkAntiLoop(baseCfg, {
      alert_type: "new_message",
      channel: "messenger",
      conversation_id: "grp_shared_999",
      content: "[TIN MỚI - ZALO] khách forward ảnh chụp màn hình",
    });
    assert.strictEqual(checkNonZalo.blocked, false);

    // 1e. Test ping targeting target_zalo_group_id is NOT blocked
    const checkTest = checkAntiLoop(baseCfg, {
      alert_type: "test",
      channel: "zalo",
      conversation_id: "grp_shared_999",
      content: "[TEST THÔNG BÁO SLA - ZALO]",
    });
    assert.strictEqual(checkTest.blocked, false);

    // Verify delivery_result events were emitted for skipped items
    assert.strictEqual(emitted.length, 2);
    assert.strictEqual(emitted[0].type, "delivery_result");
    assert.strictEqual(emitted[0].error, "anti_loop_guard");
    assert.strictEqual(emitted[1].error, "excluded_conversation");
    assert.strictEqual(engine.getStats().skipped_total, 2);
  });

  // 2. Debounce coalesces 3 messages within 150ms into 1 alert with "(+2 tin)"
  await runTest("TC-JS-02: Debounce coalesces 3 burst messages within 150ms into 1 notification with (+2 tin)", async () => {
    const emitted = [];
    const engine = new SlaAlertForwardEngine({
      minIntervalMs: 0,
      maxPerMin: 20,
      onEvent: (evt) => emitted.push(evt),
    });

    const cfg = {
      id: "cfg-debounce",
      notifier_zalo_account_id: "zl_notifier",
      target_zalo_group_id: "grp_target_1",
      dry_run: true,
      alert_mode: "new_turn_only",
      debounce_ms: 150,
      cooldown_minutes: 15,
    };

    const r1 = engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "new_message",
        channel: "zalo",
        account_id: "zl_sale1",
        account_name: "Zalo Sale 01",
        conversation_id: "cust_101",
        customer_name: "Nguyễn Văn A",
        customer_phone: "0901234567",
        content: "Shop ơi còn hàng không?",
        sla_turn_id: "turn-1",
        sla_minutes: 5,
        force_new_turn: true,
      },
    });
    assert.strictEqual(r1.accepted, true);
    assert.strictEqual(r1.action, "debounced");

    await sleep(30);
    const r2 = engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "new_message",
        channel: "zalo",
        account_id: "zl_sale1",
        conversation_id: "cust_101",
        content: "Mình cần mua 5 bộ giao HN",
        force_new_turn: false,
      },
    });
    assert.strictEqual(r2.action, "debounced_coalesced");
    assert.strictEqual(r2.batch_count, 2);

    await sleep(30);
    const r3 = engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "new_message",
        channel: "zalo",
        account_id: "zl_sale1",
        conversation_id: "cust_101",
        content: "Báo giá giúp mình nhé",
        force_new_turn: false,
      },
    });
    assert.strictEqual(r3.action, "debounced_coalesced");
    assert.strictEqual(r3.batch_count, 3);

    // Before debounce expires, nothing should be delivered yet
    assert.strictEqual(emitted.length, 0);
    assert.strictEqual(engine.getStats().pending_debounce, 1);

    // Wait past 150ms window
    await sleep(170);
    await engine.flushAll();

    assert.strictEqual(emitted.length, 1, "3 burst messages must coalesce into exactly 1 alert");
    const evt = emitted[0];
    assert.strictEqual(evt.status, "dry_run");
    assert.strictEqual(evt.meta.batch_count, 3);
    assert.ok(evt.rendered_text.includes("(+2 tin)"), `Expected (+2 tin) in:\n${evt.rendered_text}`);
    assert.ok(evt.rendered_text.includes("Shop ơi còn hàng không?"));
    assert.ok(evt.rendered_text.includes("Mình cần mua 5 bộ giao HN"));
    assert.ok(evt.rendered_text.includes("Báo giá giúp mình nhé"));
    assert.strictEqual(engine.getStats().coalesced_total, 2);
    assert.strictEqual(engine.getStats().pending_debounce, 0);
  });

  // 3. Cooldown anti-spam for new_turn_only vs force_new_turn vs every_batch vs sla_breach
  await runTest("TC-JS-03: Cooldown blocks spam under new_turn_only, allows force_new_turn / every_batch / sla_breach", async () => {
    const emitted = [];
    const engine = new SlaAlertForwardEngine({
      minIntervalMs: 0,
      maxPerMin: 20,
      onEvent: (evt) => emitted.push(evt),
    });

    const cfgNewTurn = {
      id: "cfg-cd",
      notifier_zalo_account_id: "zl_notifier",
      target_zalo_group_id: "grp_target_cd",
      dry_run: true,
      alert_mode: "new_turn_only",
      debounce_ms: 0,
      cooldown_minutes: 15,
    };

    // First message sends & records cooldown timestamp
    engine.enqueueAlert({
      config: cfgNewTurn,
      event: {
        alert_type: "new_message",
        channel: "telegram",
        account_id: "tg_1",
        conversation_id: "dlg_55",
        content: "Tin đầu tiên",
        force_new_turn: true,
      },
    });
    await engine.flushAll();
    assert.strictEqual(emitted.length, 1);
    assert.strictEqual(emitted[0].status, "dry_run");

    // Second message without force_new_turn -> blocked by cooldown_active
    const blocked = engine.enqueueAlert({
      config: cfgNewTurn,
      event: {
        alert_type: "new_message",
        channel: "telegram",
        account_id: "tg_1",
        conversation_id: "dlg_55",
        content: "Tin tiếp theo trong cùng lượt",
        force_new_turn: false,
      },
    });
    assert.strictEqual(blocked.accepted, false);
    assert.strictEqual(blocked.status, "skipped");
    assert.strictEqual(blocked.error, "cooldown_active");

    // Third message WITH force_new_turn: true -> allowed (e.g. staff replied & customer started new turn)
    const allowedNewTurn = engine.enqueueAlert({
      config: cfgNewTurn,
      event: {
        alert_type: "new_message",
        channel: "telegram",
        account_id: "tg_1",
        conversation_id: "dlg_55",
        content: "Lượt hỏi mới sau khi NV đã trả lời",
        force_new_turn: true,
      },
    });
    assert.strictEqual(allowedNewTurn.accepted, true);

    // Every_batch mode -> bypasses cooldown even when force_new_turn is false
    const allowedEveryBatch = engine.enqueueAlert({
      config: { ...cfgNewTurn, alert_mode: "every_batch" },
      event: {
        alert_type: "new_message",
        channel: "telegram",
        account_id: "tg_1",
        conversation_id: "dlg_55",
        content: "Chế độ every_batch",
        force_new_turn: false,
      },
    });
    assert.strictEqual(allowedEveryBatch.accepted, true);

    // SLA breach is NEVER blocked by new_message cooldown and NEVER debounced
    const allowedBreach = engine.enqueueAlert({
      config: { ...cfgNewTurn, debounce_ms: 5000, mention_all_on_breach: true },
      event: {
        alert_type: "sla_breach",
        channel: "telegram",
        account_id: "tg_1",
        conversation_id: "dlg_55",
        customer_name: "Khách VIP",
        content: "Chưa ai trả lời!",
        wait_business_seconds: 420,
        sla_minutes: 5,
      },
    });
    assert.strictEqual(allowedBreach.accepted, true);
    assert.strictEqual(allowedBreach.action, "queued");

    await engine.flushAll();
    const breachEvt = emitted.find((e) => e.meta && e.meta.alert_type === "sla_breach");
    assert.ok(breachEvt, "SLA breach alert must be delivered immediately");
    assert.strictEqual(breachEvt.status, "dry_run");
    assert.ok(breachEvt.rendered_text.startsWith("@All "), "mention_all_on_breach must prepend @All");
  });

  // 4. Rate-Limit sliding 60s window & recovery + pacing
  await runTest("TC-JS-04: Rate-Limit sliding window blocks excess messages & recovers after window expires", async () => {
    const emitted = [];
    const engine = new SlaAlertForwardEngine({
      minIntervalMs: 0,
      maxPerMin: 3,
      windowMs: 120, // short sliding window for fast deterministic test
      onEvent: (evt) => emitted.push(evt),
    });

    const cfg = {
      id: "cfg-rl",
      notifier_zalo_account_id: "zl_rate_notifier",
      target_zalo_group_id: "grp_rl",
      dry_run: true,
      alert_mode: "every_batch",
      debounce_ms: 0,
    };

    for (let i = 1; i <= 5; i++) {
      engine.enqueueAlert({
        config: cfg,
        event: {
          alert_type: "new_message",
          channel: "whatsapp",
          account_id: "wa_1",
          conversation_id: `conv_rl_${i}`,
          content: `Tin số ${i}`,
        },
      });
    }
    await engine.flushAll();

    const dryRuns = emitted.filter((e) => e.status === "dry_run");
    const rateLimited = emitted.filter((e) => e.status === "rate_limited");
    assert.strictEqual(dryRuns.length, 3, "First 3 alerts should pass sliding window");
    assert.strictEqual(rateLimited.length, 2, "Alerts 4 & 5 must be rate_limited");
    assert.strictEqual(engine.getStats().rate_limited_total, 2);

    // Wait for sliding window to expire -> 6th message should succeed
    await sleep(140);
    engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "new_message",
        channel: "whatsapp",
        account_id: "wa_1",
        conversation_id: "conv_rl_6",
        content: "Tin sau khi cửa sổ trượt mở lại",
      },
    });
    await engine.flushAll();
    assert.strictEqual(emitted.filter((e) => e.status === "dry_run").length, 4);
  });

  // 5. Real-send pacing per notifier & customSender verification
  await runTest("TC-JS-05: Per-notifier pacing enforces minIntervalMs on real sends & passes mentions", async () => {
    const sendTimestamps = [];
    const sentPayloads = [];
    const emitted = [];

    const engine = new SlaAlertForwardEngine({
      minIntervalMs: 60,
      maxPerMin: 20,
      onEvent: (evt) => emitted.push(evt),
      customSender: async (payload) => {
        sendTimestamps.push(Date.now());
        sentPayloads.push(payload);
        return { msgId: `mock_${sentPayloads.length}` };
      },
    });

    const cfg = {
      id: "cfg-pace",
      notifier_zalo_account_id: "zl_pace_1",
      target_zalo_group_id: "grp_pace",
      dry_run: false,
      debounce_ms: 0,
      mention_all_on_breach: true,
      mention_zalo_uids: [{ uid: "123456789", name: "Leader An" }],
    };

    engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "sla_breach",
        channel: "zalo",
        account_id: "zl_sale",
        conversation_id: "conv_p1",
        customer_name: "Khách P1",
        content: "Cần gấp!",
        wait_business_seconds: 600,
      },
    });
    engine.enqueueAlert({
      config: cfg,
      event: {
        alert_type: "sla_warning",
        channel: "zalo",
        account_id: "zl_sale",
        conversation_id: "conv_p2",
        customer_name: "Khách P2",
        content: "Sắp quá hạn",
        wait_business_seconds: 220,
      },
    });
    await engine.flushAll();

    assert.strictEqual(sentPayloads.length, 2);
    const gap = sendTimestamps[1] - sendTimestamps[0];
    assert.ok(gap >= 45, `Expected pacing gap >= 45ms, got ${gap}ms`);

    // Check mentions on breach message
    const first = sentPayloads[0];
    assert.strictEqual(first.targetGroupId, "grp_pace");
    assert.ok(first.msg.startsWith("@All "));
    assert.ok(first.msg.includes("@Leader An"));
    assert.strictEqual(first.mentions.length, 2);
    assert.deepStrictEqual(first.mentions[0], { pos: 0, uid: "-1", len: 4 });
    assert.strictEqual(first.mentions[1].uid, "123456789");
    assert.strictEqual(
      first.msg.slice(first.mentions[1].pos, first.mentions[1].pos + first.mentions[1].len),
      "@Leader An"
    );
    assert.strictEqual(emitted.filter((e) => e.status === "sent").length, 2);
  });

  // 6. Template renderer, formatters & normalizeCookieJar
  await runTest("TC-JS-06: Template renderer (12 vars), UTC+7 time formatter, wait formatter & cookie normalizer", async () => {
    const customTpl =
      "[{{channel}}]{{extra_count_text}} | {{customer_name}} ({{customer_phone}}) | {{account_name}} | " +
      "{{content}} | {{time_vn}} | {{sla_minutes}}m | {{deadline_vn}} | {{wait_text}} | {{staff_name}} | {{open_url}}";
    const out = renderTemplate(
      { new_message_template: customTpl },
      {
        alert_type: "new_message",
        channel: "messenger",
        customer_name: "Chị Lan",
        customer_phone: "0988777666",
        account_name: "Page Markee",
        content: "Tư vấn gói Pro",
        received_at: "2026-11-28T01:30:00Z", // 08:30 28/11 VN
        deadline_at: "2026-11-28T01:35:00Z", // 08:35 28/11 VN
        sla_minutes: 5,
        wait_business_seconds: 125,
        staff_name: "Minh Anh",
        open_url: "https://crm.example.com/all-platform/messenger-inbox",
      },
      { batchCount: 3 }
    );
    assert.strictEqual(
      out,
      "[MESSENGER] (+2 tin) | Chị Lan (0988777666) | Page Markee | Tư vấn gói Pro | " +
        "08:30 28/11 | 5m | 08:35 28/11 | 2 phút 5 giây | Minh Anh | https://crm.example.com/all-platform/messenger-inbox"
    );

    // Dangling link line removed when open_url is blank
    const defaultRendered = renderTemplate(
      {},
      { alert_type: "new_message", channel: "zalo", customer_name: "Anh B", content: "Hi", open_url: "" }
    );
    assert.ok(!defaultRendered.includes("🔗"), "Blank open_url should strip dangling 🔗 line");

    // Time & wait formatters
    assert.strictEqual(formatTimeVn("2026-11-28T01:30:00Z"), "08:30 28/11");
    assert.strictEqual(formatWaitText(45), "45 giây");
    assert.strictEqual(formatWaitText(180), "3 phút");
    assert.strictEqual(formatWaitText(312), "5 phút 12 giây");
    assert.strictEqual(formatWaitText(7500), "2 giờ 5 phút");

    // Cookie jar normalization
    const normArr = normalizeCookieJar([{ name: "zpw_sek", value: "abc", expirationDate: 1800000000 }]);
    assert.strictEqual(typeof normArr[0].expires, "string");
    assert.ok(normArr[0].expires.startsWith("2027-"));

    const normObj = normalizeCookieJar({ cookies: [{ name: "c", value: "v", expires: 1800000000 }] });
    assert.strictEqual(typeof normObj.cookies[0].expires, "string");

    // buildMentions only adds @All on sla_breach
    const mWarn = buildMentions({ mention_all_on_breach: true }, { alert_type: "sla_warning" }, "Cảnh báo");
    assert.strictEqual(mWarn.mentions.length, 0);
    assert.strictEqual(mWarn.msg, "Cảnh báo");
  });

  // 7. Dry-run send-immediate & error path
  await runTest("TC-JS-07: sendImmediate handles dry-run (0ms) & real-send failure gracefully", async () => {
    const engine = new SlaAlertForwardEngine({
      customSender: async () => {
        throw new Error("Simulated ZCA network error");
      },
    });

    const dryRes = await engine.sendImmediate({
      config: {
        id: "cfg-test",
        target_zalo_group_id: "grp_1",
        dry_run: true,
      },
      event: {
        alert_type: "test",
        channel: "zalo",
        account_name: "Zalo Bot",
        content: "Ping kiểm tra",
        open_url: "https://crm.example.com/all-platform/sla-monitor",
      },
    });
    assert.strictEqual(dryRes.sent, true);
    assert.strictEqual(dryRes.dry_run, true);
    assert.strictEqual(dryRes.status, "dry_run");
    assert.strictEqual(dryRes.via, "js_engine");
    assert.ok(dryRes.rendered_text.includes("[TEST THÔNG BÁO SLA - ZALO]"));

    const failRes = await engine.sendImmediate({
      config: {
        id: "cfg-test",
        target_zalo_group_id: "grp_1",
        dry_run: false,
      },
      event: {
        alert_type: "test",
        channel: "zalo",
        content: "Real send should fail",
      },
    });
    assert.strictEqual(failRes.sent, false);
    assert.strictEqual(failRes.status, "failed");
    assert.ok(failRes.error.includes("Simulated ZCA network error"));
  });

  // 8. Live JSON-Lines IPC Protocol over real child_process.spawn
  await runTest("TC-JS-08: Live JSON-Lines IPC child_process (ready, ping, send-immediate, anti-loop, debounce 3->1, cooldown, stats, shutdown)", async () => {
    const scriptPath = path.join(__dirname, "sla_alert_forward_engine.js");
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SLA_ALERT_MIN_INTERVAL_MS: "0", SLA_ALERT_MAX_PER_MIN: "20" },
    });

    const pending = new Map();
    const deliveryEvents = [];
    let readyResolved = false;

    const readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Engine did not emit ready within 5s")), 5000);
      const errRl = readline.createInterface({ input: child.stderr });
      errRl.on("line", (line) => {
        if (!readyResolved && line.toLowerCase().includes("ready")) {
          readyResolved = true;
          clearTimeout(timeout);
          resolve(line);
        }
      });
    });

    const outRl = readline.createInterface({ input: child.stdout });
    outRl.on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.type === "delivery_result") {
        deliveryEvents.push(msg);
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    });

    let seq = 0;
    const rpc = (cmd, payload) =>
      new Promise((resolve, reject) => {
        const id = `req_${++seq}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`IPC timeout for cmd=${cmd}`));
        }, 5000);
        pending.set(id, {
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
        });
        child.stdin.write(JSON.stringify({ id, cmd, payload }) + "\n");
      });

    try {
      await readyPromise;

      // 8a. ping
      const pingResp = await rpc("ping");
      assert.strictEqual(pingResp.ok, true);
      assert.strictEqual(pingResp.result.pid, child.pid);
      assert.strictEqual(typeof pingResp.result.uptime_ms, "number");

      // 8b. send-immediate (dry-run)
      const immResp = await rpc("send-immediate", {
        config: { id: "ipc_c1", target_zalo_group_id: "ipc_grp", dry_run: true },
        event: {
          alert_type: "test",
          channel: "zalo",
          account_name: "IPC Bot",
          content: "IPC Test Ping",
        },
      });
      assert.strictEqual(immResp.ok, true);
      assert.strictEqual(immResp.result.sent, true);
      assert.strictEqual(immResp.result.dry_run, true);
      assert.strictEqual(immResp.result.via, "js_engine");

      // 8c. Anti-loop over IPC
      const loopResp = await rpc("enqueue-alert", {
        config: { id: "ipc_c1", target_zalo_group_id: "ipc_grp", dry_run: true },
        event: {
          alert_type: "new_message",
          channel: "zalo",
          account_id: "zl_1",
          conversation_id: "ipc_grp",
          content: "Loop message",
        },
      });
      assert.strictEqual(loopResp.ok, true);
      assert.strictEqual(loopResp.result.status, "skipped");
      assert.strictEqual(loopResp.result.error, "anti_loop_guard");

      // 8d. Debounce 3 messages in 150ms over IPC
      const debCfg = {
        id: "ipc_c1",
        notifier_zalo_account_id: "zl_notif",
        target_zalo_group_id: "ipc_grp",
        dry_run: true,
        alert_mode: "new_turn_only",
        debounce_ms: 150,
        cooldown_minutes: 15,
      };
      for (let i = 1; i <= 3; i++) {
        const enq = await rpc("enqueue-alert", {
          config: debCfg,
          event: {
            alert_type: "new_message",
            channel: "zalo",
            account_id: "zl_src",
            conversation_id: "ipc_conv_1",
            customer_name: "Khách IPC",
            content: `IPC tin ${i}`,
            force_new_turn: i === 1,
          },
        });
        assert.strictEqual(enq.ok, true);
        assert.strictEqual(enq.result.accepted, true);
      }

      // Wait for debounce timer + flush
      await sleep(220);
      await rpc("flush-all");

      // 8e. Cooldown active over IPC
      const cdResp = await rpc("enqueue-alert", {
        config: { ...debCfg, debounce_ms: 0 },
        event: {
          alert_type: "new_message",
          channel: "zalo",
          account_id: "zl_src",
          conversation_id: "ipc_conv_1",
          content: "IPC tin thứ 4 bị cooldown chặn",
          force_new_turn: false,
        },
      });
      assert.strictEqual(cdResp.ok, true);
      assert.strictEqual(cdResp.result.status, "skipped");
      assert.strictEqual(cdResp.result.error, "cooldown_active");

      // 8f. stats
      const statsResp = await rpc("stats");
      assert.strictEqual(statsResp.ok, true);
      assert.strictEqual(statsResp.result.coalesced_total, 2);
      assert.strictEqual(statsResp.result.skipped_total, 2);
      assert.strictEqual(statsResp.result.dry_run_total, 2);

      // Verify async delivery_result events received on stdout
      const dryRunDeliveries = deliveryEvents.filter((e) => e.status === "dry_run");
      assert.strictEqual(dryRunDeliveries.length, 1);
      assert.ok(dryRunDeliveries[0].rendered_text.includes("(+2 tin)"));
      assert.strictEqual(
        deliveryEvents.filter((e) => e.status === "skipped" && e.error === "anti_loop_guard").length,
        1
      );
      assert.strictEqual(
        deliveryEvents.filter((e) => e.status === "skipped" && e.error === "cooldown_active").length,
        1
      );

      // 8g. Clean shutdown -> exit code 0
      const exitPromise = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
      const shutResp = await rpc("shutdown");
      assert.strictEqual(shutResp.ok, true);
      const exitCode = await exitPromise;
      assert.strictEqual(exitCode, 0, `Expected exit code 0 on shutdown, got ${exitCode}`);
    } finally {
      if (child.exitCode === null) {
        child.kill();
      }
    }
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n=== Summary: ${passed}/${results.length} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled test runner error:", err);
  process.exit(1);
});
