"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { zaloBotApi, type ZaloBotThreadStatus } from "@/lib/zaloBotClient";
import { useVisiblePolling } from "./useZaloBotPolling";

const keyOf = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;

type ThreadStore = { key: string; status: ZaloBotThreadStatus | null; error: string | null };

/**
 * Trạng thái bot của 1 hội thoại 1-1. `enabled=false` (nhóm / chưa chọn) thì không gọi API.
 * `refreshSignal` đổi giá trị => làm mới ngay (vd sau khi nhân viên gửi tin).
 *
 * State gắn với khoá (tài khoản + hội thoại): đổi hội thoại thì dữ liệu của hội thoại cũ tự bị bỏ qua,
 * không cần reset trong effect.
 */
export function useZaloBotThread(accountId: string, threadId: string, enabled: boolean, refreshSignal: string) {
  const key = keyOf(accountId, threadId);
  const [store, setStore] = useState<ThreadStore>({ key, status: null, error: null });
  const [busy, setBusy] = useState(false);
  const targetRef = useRef({ accountId, threadId });

  useEffect(() => {
    targetRef.current = { accountId, threadId };
  }, [accountId, threadId]);

  const refresh = useCallback(async () => {
    const { accountId: a, threadId: t } = targetRef.current;
    if (!a || !t) return;
    try {
      const data = await zaloBotApi.getThreadStatus(a, t);
      if (targetRef.current.accountId === a && targetRef.current.threadId === t) {
        setStore({ key: keyOf(a, t), status: data, error: null });
      }
    } catch {
      // poll nền: giữ trạng thái cũ
    }
  }, []);

  const active = enabled && Boolean(accountId) && Boolean(threadId);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [active, key, refresh]);

  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    if (!active) return;
    // backend tự tạm dừng bot khi nhân viên nhắn: chờ chút cho kịp ghi nhận rồi làm mới
    const timer = window.setTimeout(() => void refresh(), 800);
    return () => window.clearTimeout(timer);
  }, [refreshSignal, active, refresh]);

  useVisiblePolling(() => void refresh(), 15_000, active);

  const run = useCallback(async (call: () => Promise<ZaloBotThreadStatus>) => {
    const { accountId: a, threadId: t } = targetRef.current;
    const k = keyOf(a, t);
    setBusy(true);
    setStore((s) => (s.key === k ? { ...s, error: null } : s));
    try {
      const data = await call();
      if (targetRef.current.accountId === a && targetRef.current.threadId === t) {
        setStore({ key: k, status: data, error: null });
      }
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Thao tác thất bại";
      setStore((s) => ({ key: k, status: s.key === k ? s.status : null, error: message }));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const takeover = useCallback(
    () => run(() => zaloBotApi.takeover(targetRef.current.accountId, targetRef.current.threadId, null)),
    [run],
  );
  const resume = useCallback(
    () => run(() => zaloBotApi.resume(targetRef.current.accountId, targetRef.current.threadId)),
    [run],
  );

  /** Bật (true) / tắt (false) / về mặc định (null) bot cho riêng hội thoại này. */
  const setRule = useCallback(
    (botOn: boolean | null) =>
      run(() => zaloBotApi.setThreadRule(targetRef.current.accountId, targetRef.current.threadId, botOn)),
    [run],
  );

  const current = store.key === key ? store : null;
  return {
    status: active ? (current?.status ?? null) : null,
    busy,
    actionError: current?.error ?? null,
    takeover,
    resume,
    setRule,
  };
}

const NO_THREADS = new Set<string>();

/** Danh sách thread đang bị tạm dừng của tài khoản (icon ở danh sách hội thoại). */
export function useZaloBotPausedThreads(accountId: string, enabled: boolean): Set<string> {
  const [store, setStore] = useState<{ account: string; ids: Set<string> }>({ account: accountId, ids: NO_THREADS });
  const accountRef = useRef(accountId);

  useEffect(() => {
    accountRef.current = accountId;
  }, [accountId]);

  const load = useCallback(async () => {
    const id = accountRef.current;
    if (!id) return;
    try {
      const res = await zaloBotApi.getPausedThreads(id);
      if (accountRef.current === id) setStore({ account: id, ids: new Set(res.paused_thread_ids ?? []) });
    } catch {
      // bỏ qua
    }
  }, []);

  useEffect(() => {
    if (!enabled || !accountId) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [accountId, enabled, load]);

  useVisiblePolling(() => void load(), 30_000, enabled && Boolean(accountId));

  return enabled && store.account === accountId ? store.ids : NO_THREADS;
}
