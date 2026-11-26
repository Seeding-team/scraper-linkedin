#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const zlib = require("zlib");
const { createRequire } = require("module");
const { Zalo, LoginQRCallbackEventType } = require("zca-js");

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

function emit(payload) {
  const line = `${JSON.stringify(payload)}\n`;
  try {
    fs.writeSync(1, line);
  } catch (_) {
    process.stdout.write(line);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || !token.startsWith("--")) {
      if (!args._positional) args._positional = [];
      args._positional.push(token);
      continue;
    }
    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function safeLoadPackage(pkgName) {
  const candidates = [
    path.join(__dirname, "node_modules", pkgName),
    pkgName,
  ];
  for (const target of candidates) {
    try {
      return require(target);
    } catch (_) {
      // try next resolution path
    }
  }
  try {
    const scriptsPkgJson = path.join(__dirname, "package.json");
    if (fs.existsSync(scriptsPkgJson)) {
      const localReq = createRequire(scriptsPkgJson);
      return localReq(pkgName);
    }
  } catch (_) {
    // package unavailable
  }
  return null;
}

function buildSyncedSecChUa(userAgent) {
  const ua = String(userAgent || DEFAULT_USER_AGENT);
  const match = ua.match(/(?:Chrome|Chromium|Edg)\/(\d+)/i);
  const major = match ? match[1] : "145";
  if (/Edg\//i.test(ua)) {
    return `"Microsoft Edge";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
  }
  return `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not_A Brand";v="24"`;
}

function syncSecChUaHeaders(headersInput, secChUaValue, userAgent) {
  if (!secChUaValue || !headersInput) return headersInput;
  if (typeof Headers !== "undefined" && headersInput instanceof Headers) {
    const out = new Headers(headersInput);
    if (out.has("sec-ch-ua")) {
      out.set("sec-ch-ua", secChUaValue);
    }
    if (userAgent && !out.has("user-agent")) {
      out.set("user-agent", userAgent);
    }
    return out;
  }
  if (Array.isArray(headersInput)) {
    return headersInput.map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return pair;
      return String(pair[0]).toLowerCase() === "sec-ch-ua"
        ? [pair[0], secChUaValue]
        : pair;
    });
  }
  if (typeof headersInput === "object") {
    const out = { ...headersInput };
    for (const key of Object.keys(out)) {
      if (key.toLowerCase() === "sec-ch-ua") {
        out[key] = secChUaValue;
      }
    }
    return out;
  }
  return headersInput;
}

function headersToPlainObject(headersInput) {
  const out = {};
  if (!headersInput) return out;
  if (typeof Headers !== "undefined" && headersInput instanceof Headers) {
    headersInput.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headersInput)) {
    for (const pair of headersInput) {
      if (Array.isArray(pair) && pair.length >= 2) {
        out[String(pair[0])] = String(pair[1]);
      }
    }
    return out;
  }
  if (typeof headersInput === "object") {
    for (const [k, v] of Object.entries(headersInput)) {
      if (v !== undefined && v !== null) {
        out[k] = String(v);
      }
    }
  }
  return out;
}

async function normalizeRequestBody(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.arrayBuffer === "function") {
    return Buffer.from(await body.arrayBuffer());
  }
  return Buffer.from(String(body), "utf8");
}

function decompressResponseBuffer(buf, contentEncoding) {
  const enc = String(contentEncoding || "").toLowerCase().trim();
  if (!enc || enc === "identity" || buf.length === 0) return buf;
  try {
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("br") && typeof zlib.brotliDecompressSync === "function") {
      return zlib.brotliDecompressSync(buf);
    }
    if (enc.includes("deflate")) {
      try {
        return zlib.inflateSync(buf);
      } catch (_) {
        return zlib.inflateRawSync(buf);
      }
    }
  } catch (_) {
    return buf;
  }
  return buf;
}

async function fetchWithNodeAgent(urlInput, init, agent) {
  const urlObj = new URL(typeof urlInput === "string" ? urlInput : urlInput.toString());
  const method = String((init && init.method) || "GET").toUpperCase();
  const headers = headersToPlainObject(init && init.headers);
  const bodyBuf = await normalizeRequestBody(init && init.body);
  if (bodyBuf && !Object.keys(headers).some((k) => k.toLowerCase() === "content-length")) {
    headers["content-length"] = String(bodyBuf.length);
  }
  const signal = init && init.signal;
  const transport = urlObj.protocol === "http:" ? http : https;

  return await new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
      return;
    }

    const req = transport.request(
      urlObj,
      {
        method,
        headers,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const rawBuf = Buffer.concat(chunks);
          const body = decompressResponseBuffer(rawBuf, res.headers["content-encoding"]);
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers || {})) {
            if (v === undefined) continue;
            const lower = k.toLowerCase();
            if (lower === "content-encoding" || lower === "content-length" || lower === "transfer-encoding") {
              continue;
            }
            if (Array.isArray(v)) {
              for (const item of v) {
                respHeaders.append(k, String(item));
              }
            } else {
              respHeaders.set(k, String(v));
            }
          }
          const status = res.statusCode || 200;
          const isNullBodyStatus = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(isNullBodyStatus ? null : body, {
              status,
              statusText: res.statusMessage || "",
              headers: respHeaders,
            }),
          );
        });
      },
    );

    const onAbort = () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      req.destroy(abortErr);
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    req.on("error", reject);
    if (bodyBuf && bodyBuf.length > 0) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

function createZcaClientOptions(userAgent, proxyUrl) {
  const cleanUa = String(userAgent || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
  const cleanProxy = String(proxyUrl || "").trim();
  const secChUa = buildSyncedSecChUa(cleanUa);

  const isSocks = /^socks(?:4|4a|5|5h)?:\/\//i.test(cleanProxy);
  const isHttp = /^https?:\/\//i.test(cleanProxy);

  let agent = undefined;
  let dispatcher = null;
  let proxyKind = null;

  const undiciMod = safeLoadPackage("undici");
  const baseFetch = (undiciMod && typeof undiciMod.fetch === "function") ? undiciMod.fetch : global.fetch;

  if (isSocks) {
    proxyKind = "socks";
    const socksMod = safeLoadPackage("socks-proxy-agent");
    const SocksProxyAgent = socksMod && (socksMod.SocksProxyAgent || socksMod.default || socksMod);
    if (typeof SocksProxyAgent === "function") {
      agent = new SocksProxyAgent(cleanProxy);
    }
  } else if (isHttp) {
    proxyKind = "http";
    const httpsMod = safeLoadPackage("https-proxy-agent");
    const HttpsProxyAgent = httpsMod && (httpsMod.HttpsProxyAgent || httpsMod.default || httpsMod);
    if (typeof HttpsProxyAgent === "function") {
      agent = new HttpsProxyAgent(cleanProxy);
    }
    if (undiciMod && typeof undiciMod.ProxyAgent === "function") {
      dispatcher = new undiciMod.ProxyAgent(cleanProxy);
    }
  }

  const polyfill = async (url, init = {}) => {
    const nextInit = { ...(init || {}) };
    delete nextInit.agent;
    if (nextInit.headers) {
      nextInit.headers = syncSecChUaHeaders(nextInit.headers, secChUa, cleanUa);
    }
    if (isSocks && agent) {
      return await fetchWithNodeAgent(url, nextInit, agent);
    }
    if (dispatcher) {
      nextInit.dispatcher = dispatcher;
    }
    return await baseFetch(url, nextInit);
  };

  const close = () => {
    try {
      if (dispatcher && typeof dispatcher.close === "function") {
        dispatcher.close().catch(() => {});
      }
    } catch (_) {}
    try {
      if (agent && typeof agent.destroy === "function") {
        agent.destroy();
      }
    } catch (_) {}
  };

  const options = {
    selfListen: false,
    checkUpdate: false,
    logging: false,
    polyfill,
  };
  if (agent) {
    options.agent = agent;
  }
  Object.defineProperty(options, "__close", { value: close, enumerable: false });
  Object.defineProperty(options, "__meta", {
    value: {
      has_proxy: Boolean(cleanProxy),
      proxy_kind: proxyKind,
      has_agent: Boolean(agent),
      has_dispatcher: Boolean(dispatcher),
      sec_ch_ua: secChUa,
    },
    enumerable: false,
  });
  return options;
}

function formatQrErrorMessage(err) {
  const raw = err && err.message ? String(err.message) : String(err || "Unknown QR login error");
  const lower = raw.toLowerCase();
  if (
    lower.includes("gtoken") ||
    lower.includes("captcha") ||
    lower.includes("verify") ||
    lower.includes("error_code\": -14") ||
    lower.includes("error_code\":-14") ||
    lower.includes("403") ||
    lower.includes("429")
  ) {
    return (
      `${raw} — Zalo yêu cầu xác minh bổ sung từ IP máy chủ này. ` +
      "Hãy thử cấu hình Proxy VN (Sticky Proxy) hoặc chuyển sang tab Extension 1-Chạm (Dự phòng)."
    );
  }
  return raw;
}

async function main() {
  const args = parseArgs(process.argv);
  const userAgent =
    String(args["user-agent"] || process.env.ZALO_ZCA_USER_AGENT || DEFAULT_USER_AGENT).trim() ||
    DEFAULT_USER_AGENT;
  const persistentImei = String(args.imei || "").trim();
  const maxAttemptsRaw = Number(args["max-attempts"] || 3);
  const maxAttempts = Number.isFinite(maxAttemptsRaw)
    ? Math.max(1, Math.min(5, Math.trunc(maxAttemptsRaw)))
    : 3;
  // SECURITY: Proxy URL is NEVER read from CLI args — only from process.env.ZALO_PROXY_URL
  const proxyUrl = String(process.env.ZALO_PROXY_URL || "").trim();

  const clientOptions = createZcaClientOptions(userAgent, proxyUrl);

  if (args["dry-run"]) {
    emit({
      event: "ready",
      dry_run: true,
      has_proxy: Boolean(proxyUrl),
      proxy_kind: clientOptions.__meta.proxy_kind,
      has_agent: clientOptions.__meta.has_agent,
      has_dispatcher: clientOptions.__meta.has_dispatcher,
      sec_ch_ua: clientOptions.__meta.sec_ch_ua,
      imei: persistentImei || null,
      max_attempts: maxAttempts,
    });
    clientOptions.__close();
    process.exit(0);
    return;
  }

  const zalo = new Zalo(clientOptions);

  // Preserve persistent device IMEI across QR re-links without modifying node_modules/zca-js
  if (persistentImei) {
    const origLoginCookie = zalo.loginCookie.bind(zalo);
    zalo.loginCookie = (ctx, credentials) =>
      origLoginCookie(ctx, { ...credentials, imei: persistentImei });
  }

  let abortFn = null;
  let attempt = 0;
  let terminalEmitted = false;
  let scannedUser = { display_name: null, avatar: null };
  let gotLoginCookies = null;

  const cleanupAndExit = (code) => {
    try {
      if (abortFn) abortFn();
    } catch (_) {}
    try {
      clientOptions.__close();
    } catch (_) {}
    process.exit(code);
  };

  process.on("SIGTERM", () => {
    terminalEmitted = true;
    cleanupAndExit(0);
  });
  process.on("SIGINT", () => {
    terminalEmitted = true;
    cleanupAndExit(0);
  });

  try {
    const api = await zalo.loginQR({ userAgent, language: "vi" }, (res) => {
      if (!res || terminalEmitted) return;

      if (res.type === LoginQRCallbackEventType.QRCodeGenerated) {
        attempt += 1;
        abortFn = (res.actions && res.actions.abort) || null;
        const raw = (res.data && (res.data.image || res.data.qrData)) || "";
        const qrDataUrl = raw
          ? raw.startsWith("data:")
            ? raw
            : `data:image/png;base64,${raw}`
          : "";
        emit({
          event: "qr",
          qr_data_url: qrDataUrl,
          attempt,
          max_attempts: maxAttempts,
          expires_in_s: 100,
        });
        return;
      }

      if (res.type === LoginQRCallbackEventType.QRCodeScanned) {
        scannedUser = {
          display_name: (res.data && (res.data.display_name || res.data.displayName)) || null,
          avatar: (res.data && res.data.avatar) || null,
        };
        emit({
          event: "scanned",
          display_name: scannedUser.display_name,
          avatar: scannedUser.avatar,
        });
        return;
      }

      if (res.type === LoginQRCallbackEventType.QRCodeExpired) {
        if (attempt < maxAttempts && res.actions && typeof res.actions.retry === "function") {
          res.actions.retry();
          return;
        }
        terminalEmitted = true;
        emit({
          event: "expired",
          attempt,
          max_attempts: maxAttempts,
        });
        try {
          if (res.actions && typeof res.actions.abort === "function") {
            res.actions.abort();
          }
        } catch (_) {}
        clientOptions.__close();
        process.exit(0);
        return;
      }

      if (res.type === LoginQRCallbackEventType.QRCodeDeclined) {
        terminalEmitted = true;
        emit({ event: "declined" });
        clientOptions.__close();
        process.exit(0);
        return;
      }

      if (res.type === LoginQRCallbackEventType.GotLoginInfo) {
        if (res.data && res.data.cookie) {
          gotLoginCookies = res.data.cookie;
        }
      }
    });

    if (terminalEmitted) return;

    const context = api && typeof api.getContext === "function" ? api.getContext() : null;
    const uid = api && typeof api.getOwnId === "function" ? String(api.getOwnId() || "") : "";
    if (!uid || !context) {
      throw new Error("ZCA QR login succeeded without valid session context");
    }

    let cookies = [];
    if (context.cookie && typeof context.cookie.serializeSync === "function") {
      const serialized = context.cookie.serializeSync();
      cookies = Array.isArray(serialized && serialized.cookies) ? serialized.cookies : [];
    } else if (Array.isArray(gotLoginCookies)) {
      cookies = gotLoginCookies;
    }

    const finalImei = String(persistentImei || context.imei || "").trim();
    const finalUa = String(context.userAgent || userAgent).trim();
    const loginInfo = context.loginInfo || {};

    terminalEmitted = true;
    emit({
      event: "confirmed",
      cookies,
      imei: finalImei,
      userAgent: finalUa,
      uid,
      display_name: scannedUser.display_name || loginInfo.display_name || loginInfo.zalo_name || null,
      avatar: scannedUser.avatar || loginInfo.avatar || null,
    });
    clientOptions.__close();
    process.exit(0);
  } catch (err) {
    if (terminalEmitted) return;
    terminalEmitted = true;
    emit({
      event: "error",
      error: formatQrErrorMessage(err),
    });
    clientOptions.__close();
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    emit({
      event: "error",
      error: formatQrErrorMessage(err),
    });
    process.exit(1);
  });
} else {
  module.exports = {
    DEFAULT_USER_AGENT,
    parseArgs,
    buildSyncedSecChUa,
    syncSecChUaHeaders,
    createZcaClientOptions,
    formatQrErrorMessage,
  };
}
