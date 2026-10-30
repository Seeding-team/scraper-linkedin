'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Cầu nối postMessage <-> plugin OnlyOffice tuỳ chỉnh (2026-10-27, Word Editor — xem
 * C:\Users\Asus\.claude\plans\proud-stargazing-pixel.md, mục "Kết quả Phase 0"). Đây là cơ chế
 * THẬT DUY NHẤT để chạy lệnh trong phiên OnlyOffice đang mở sống từ bên NGOÀI iframe ở Community
 * Edition (không có `connector.callCommand`) — plugin tự "chào" bằng message
 * `{__mkEditPlugin:"ready"}` lúc init, ta lưu lại `event.source` (window của CHÍNH iframe plugin,
 * dùng được dù khác origin) để gửi lệnh ngược lại bằng đúng tham chiếu đó — KHÔNG dò DOM
 * iframe lồng nhau (bị chặn bởi same-origin policy vì OnlyOffice khác origin với trang host).
 *
 * Lệnh hỗ trợ (khớp `crm-module/backend/static/onlyoffice_plugin/scripts/edit_bridge_plugin.js`):
 *   ping                                              -> "pong"
 *   selectBookmark      {name}                        -> nhảy tới bookmark đã chèn sẵn ở server
 *   removeHighlightRange {paragraphIndex, start, end}  -> xoá màu highlight đúng vùng ký tự
 *   triggerSave                                        -> dispatch Ctrl+S thật vào editor (autosave
 *       THẬT — xem ghi chú "BUG THẬT ĐÃ SỬA" trong edit_bridge_plugin.js: Command Service
 *       forcesave của backend KHÔNG đáng tin cậy, đây mới là cơ chế lưu chính)
 */
export function useWordEditorBridge() {
  const pluginSourceRef = useRef<Window | null>(null);
  const [pluginReady, setPluginReady] = useState(false);
  const pendingRef = useRef<Map<string, (r: { ok: boolean; result?: unknown }) => void>>(new Map());
  const seqRef = useRef(0);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as { __mkEditPlugin?: string; __mkEditReply?: string; ok?: boolean; result?: unknown } | null;
      if (!data) return;
      if (data.__mkEditPlugin === 'ready') {
        pluginSourceRef.current = ev.source as Window;
        setPluginReady(true);
        return;
      }
      if (typeof data.__mkEditReply !== 'undefined') {
        const cb = pendingRef.current.get(data.__mkEditReply);
        if (cb) {
          cb({ ok: Boolean(data.ok), result: data.result });
          pendingRef.current.delete(data.__mkEditReply);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const sendCommand = useCallback((cmd: string, args: Record<string, unknown> = {}, timeoutMs = 8000): Promise<{ ok: boolean; result?: unknown }> => {
    return new Promise(resolve => {
      if (!pluginSourceRef.current) {
        resolve({ ok: false, result: { error: 'plugin-not-ready' } });
        return;
      }
      const id = `cmd${seqRef.current++}`;
      const timer = setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id);
          resolve({ ok: false, result: { error: 'timeout' } });
        }
      }, timeoutMs);
      pendingRef.current.set(id, r => { clearTimeout(timer); resolve(r); });
      pluginSourceRef.current!.postMessage({ __mkEditCmd: cmd, __mkEditId: id, ...args }, '*');
    });
  }, []);

  const reset = useCallback(() => {
    pluginSourceRef.current = null;
    setPluginReady(false);
    pendingRef.current.clear();
  }, []);

  return { pluginReady, sendCommand, reset };
}

/** Nạp script `api.js` của OnlyOffice đúng 1 lần theo URL (URL động theo
 * `settings.onlyoffice_public_url`, không hardcode) — trả về `window.DocsAPI` khi sẵn sàng. */
const _loadedScripts = new Set<string>();
let _currentLoadedApiUrl = '';

export function loadOnlyOfficeApi(apiUrl: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { DocsAPI?: unknown };
    if (w.DocsAPI && _currentLoadedApiUrl === apiUrl) {
      resolve(w.DocsAPI);
      return;
    }
    if (w.DocsAPI && _currentLoadedApiUrl !== apiUrl) {
      delete (window as unknown as { DocsAPI?: unknown }).DocsAPI;
      _loadedScripts.clear();
    }
    if (_loadedScripts.has(apiUrl)) {
      const check = setInterval(() => {
        const ww = window as unknown as { DocsAPI?: unknown };
        if (ww.DocsAPI) { clearInterval(check); resolve(ww.DocsAPI); }
      }, 150);
      setTimeout(() => clearInterval(check), 15000);
      return;
    }
    _loadedScripts.add(apiUrl);
    _currentLoadedApiUrl = apiUrl;
    const script = document.createElement('script');
    script.src = apiUrl;
    script.async = true;
    script.onload = () => {
      const ww = window as unknown as { DocsAPI?: unknown };
      if (ww.DocsAPI) resolve(ww.DocsAPI);
      else reject(new Error('OnlyOffice api.js đã tải nhưng không thấy window.DocsAPI'));
    };
    script.onerror = () => reject(new Error('Không tải được OnlyOffice api.js — kiểm tra container onlyoffice đã chạy chưa.'));
    document.head.appendChild(script);
  });
}
