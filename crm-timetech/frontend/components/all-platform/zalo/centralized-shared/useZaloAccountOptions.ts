"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { getZaloAccounts, getZaloConversations } from "@/services/zaloCrawlerService";
import type { ZaloAccountInfo, ZaloConversationSummary } from "@/types/zalo-api";

/** Danh sách tài khoản Zalo mà user hiện tại được phép thao tác + account đang chọn.
 * Dùng chung cho 5 trang mới (forward-rules/bulk-send/campaigns/broadcast-groups/scan-members). */
export function useZaloAccountOptions() {
  const { user } = useAppAuth();
  const [accounts, setAccounts] = useState<ZaloAccountInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getZaloAccounts(user?.id || "default", user?.id, user?.email);
      const list = res.accounts.filter((a) => a.has_auth);
      setAccounts(list);
      setSelectedAccountId((prev) => (prev && list.some((a) => a.account_id === prev) ? prev : list[0]?.account_id || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách tài khoản Zalo");
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.email]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { accounts, selectedAccountId, setSelectedAccountId, loading, error, reload };
}

/** Danh sách hội thoại (nhóm/1-1) của 1 account — dùng cho các trình chọn nhóm. */
export function useZaloConversationOptions(accountId: string) {
  const [conversations, setConversations] = useState<ZaloConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accountId) {
      setConversations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getZaloConversations(accountId);
      setConversations(res.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách hội thoại");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { conversations, loading, error, reload };
}
