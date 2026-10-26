'use client';

import { useCallback, useMemo, useState } from 'react';

/** 4 cot gia von/loi nhuan/margin/chiet khau tren bang "Báo giá" cua trang
 * Customer 360 (CustomerQuotesTab.tsx) - CHI hien khi user bat qua menu "Cột
 * hiển thị", giong het pattern useCustomerColumnPreferences.ts (trang Khach
 * hang). Cac cot GOC cua bang (BÁO GIÁ/DỰ ÁN/CƠ HỘI/... /THAO TÁC) luon hien,
 * khong dua vao day. */
export type QuoteColumnKey = 'costTotal' | 'grossProfit' | 'grossMarginPercent' | 'discount';

/** Mac dinh AN CA 4 cot (khac voi useCustomerColumnPreferences mac dinh hien
 * het) - day la du lieu gia von/loi nhuan nhay cam (chi Sale/admin/leader/
 * quote owner duoc xem thuc su, gac o backend qua
 * apply_quote_field_permissions()), khong nen dap thang vao mat moi nguoi
 * ngay khi vao trang. */
export const DEFAULT_VISIBLE_QUOTE_COLUMNS: QuoteColumnKey[] = [];

export const ALL_QUOTE_COLUMNS: QuoteColumnKey[] = ['costTotal', 'grossProfit', 'grossMarginPercent', 'discount'];

const VALID_KEYS = new Set<string>(ALL_QUOTE_COLUMNS);

function storageKey(workspaceId: string, userId: string): string {
  return `crm_customer_quote_columns:${workspaceId}:${userId}`;
}

function parseStoredColumns(raw: string | null): Set<QuoteColumnKey> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((key): key is QuoteColumnKey => typeof key === 'string' && VALID_KEYS.has(key));
    return new Set(valid);
  } catch {
    return null;
  }
}

function loadVisibleColumns(workspaceId: string | null, userId: string | null): Set<QuoteColumnKey> {
  if (typeof window === 'undefined' || !workspaceId || !userId) return new Set(DEFAULT_VISIBLE_QUOTE_COLUMNS);
  return parseStoredColumns(window.localStorage.getItem(storageKey(workspaceId, userId))) || new Set(DEFAULT_VISIBLE_QUOTE_COLUMNS);
}

/**
 * Preference "cột nào hiển thị" cho bảng Báo giá trong Customer 360 - rieng
 * theo TUNG workspace+user, luu localStorage
 * `crm_customer_quote_columns:<workspace_id>:<user_id>`. FE-only, khong goi
 * API/backend nao - bao ve THAT SU van nam o backend (apply_quote_field_permissions),
 * day chi la preference hien/an cot tren UI. Xem useCustomerColumnPreferences.ts
 * (trang Khach hang) - cung 1 pattern, tach rieng file vi khac tap key/mac dinh.
 */
export function useQuoteColumnPreferences(workspaceId: string | null, userId: string | null) {
  const [version, setVersion] = useState(0);
  const visible = useMemo(
    () => loadVisibleColumns(workspaceId, userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` khong doc trong body, chi dung de buoc tinh lai sau persist().
    [workspaceId, userId, version],
  );

  const persist = useCallback((next: Set<QuoteColumnKey>) => {
    if (typeof window !== 'undefined' && workspaceId && userId) {
      try {
        window.localStorage.setItem(storageKey(workspaceId, userId), JSON.stringify([...next]));
      } catch {
        // Quota/private-mode error - bo qua, van tang version de UI cap nhat
        // ngay cho phien hien tai, chi khong luu lai qua lan sau.
      }
    }
    setVersion(v => v + 1);
  }, [workspaceId, userId]);

  const toggle = useCallback((key: QuoteColumnKey) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  }, [visible, persist]);

  const selectAll = useCallback(() => {
    persist(new Set(ALL_QUOTE_COLUMNS));
  }, [persist]);

  const resetToDefault = useCallback(() => {
    persist(new Set(DEFAULT_VISIBLE_QUOTE_COLUMNS));
  }, [persist]);

  return { visible, toggle, selectAll, resetToDefault };
}
