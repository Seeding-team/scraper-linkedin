"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  zaloBotApi,
  ZaloBotApiError,
  type ZaloBotConfig,
  type ZaloBotConfigBrief,
  type ZaloBotConfigUpdate,
} from "@/lib/zaloBotClient";
import { useVisiblePolling } from "./useZaloBotPolling";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

type ConfigStore = {
  account: string;
  config: ZaloBotConfig | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
};

const blank = (account: string): ConfigStore => ({ account, config: null, loading: false, error: null, forbidden: false });

/**
 * Cấu hình bot của 1 tài khoản (đọc + lưu). 403 khi đọc/ghi => chế độ chỉ xem.
 * State gắn với tài khoản: đổi tài khoản thì dữ liệu của tài khoản cũ tự bị bỏ qua (không reset trong effect).
 */
export function useZaloBotConfig(accountId: string) {
  const [store, setStore] = useState<ConfigStore>(() => blank(accountId));
  const accountRef = useRef(accountId);

  useEffect(() => {
    accountRef.current = accountId;
  }, [accountId]);

  const reload = useCallback(async () => {
    const id = accountRef.current;
    if (!id) return;
    setStore((s) => ({ ...(s.account === id ? s : blank(id)), loading: true }));
    try {
      const data = await zaloBotApi.getConfig(id);
      if (accountRef.current !== id) return;
      setStore((s) => ({ ...(s.account === id ? s : blank(id)), config: data, loading: false, error: null }));
    } catch (e) {
      if (accountRef.current !== id) return;
      const forbidden = e instanceof ZaloBotApiError && e.status === 403;
      setStore((s) => {
        const base = s.account === id ? s : blank(id);
        return { ...base, loading: false, error: errMsg(e, "Không tải được cấu hình bot"), forbidden: base.forbidden || forbidden };
      });
    }
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [accountId, reload]);

  const save = useCallback(async (body: ZaloBotConfigUpdate): Promise<{ ok: true } | { ok: false; error: string }> => {
    const id = accountRef.current;
    try {
      const data = await zaloBotApi.updateConfig(id, body);
      if (accountRef.current === id) {
        setStore((s) => ({ ...(s.account === id ? s : blank(id)), config: data, error: null }));
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof ZaloBotApiError && e.status === 403) {
        setStore((s) => ({ ...(s.account === id ? s : blank(id)), forbidden: true }));
      }
      return { ok: false, error: errMsg(e, "Lưu cấu hình thất bại") };
    }
  }, []);

  const current = store.account === accountId ? store : blank(accountId);
  return {
    config: current.config,
    loading: current.loading,
    error: current.error,
    forbidden: current.forbidden,
    reload,
    save,
  };
}

/** Cấu hình rút gọn của nhiều tài khoản (chip trên cây tài khoản) — 1 request cho cả danh sách. */
export function useZaloBotConfigs(accountIds: string[]) {
  const [configs, setConfigs] = useState<Record<string, ZaloBotConfigBrief>>({});
  const key = accountIds.join(",");

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const res = await zaloBotApi.getConfigs(key.split(","));
      setConfigs(res.configs ?? {});
    } catch {
      // chip chỉ là phụ trợ, lỗi thì bỏ qua
    }
  }, [key]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useVisiblePolling(() => void load(), 60_000, Boolean(key));

  return configs;
}
