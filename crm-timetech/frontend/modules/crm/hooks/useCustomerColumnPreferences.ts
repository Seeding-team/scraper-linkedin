'use client';

import { useCallback, useMemo, useState } from 'react';

/** 2 cot "Doanh nghiệp"/"Hành động" luon hien, khong dua vao day - chi 8 cot
 * con lai user duoc bat/tat trong bang Khach hang. */
export type CustomerColumnKey =
  | 'primaryContact'
  | 'phone'
  | 'email'
  | 'taxCode'
  | 'dealCount'
  | 'pipelineValue'
  | 'status'
  | 'owner';

export const DEFAULT_VISIBLE_CUSTOMER_COLUMNS: CustomerColumnKey[] = [
  'primaryContact',
  'phone',
  'email',
  'taxCode',
  'dealCount',
  'pipelineValue',
  'status',
  'owner',
];

const VALID_KEYS = new Set<string>(DEFAULT_VISIBLE_CUSTOMER_COLUMNS);

function storageKey(workspaceId: string, userId: string): string {
  return `crm_customer_columns:${workspaceId}:${userId}`;
}

function parseStoredColumns(raw: string | null): Set<CustomerColumnKey> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((key): key is CustomerColumnKey => typeof key === 'string' && VALID_KEYS.has(key));
    return new Set(valid);
  } catch {
    return null;
  }
}

function loadVisibleColumns(workspaceId: string | null, userId: string | null): Set<CustomerColumnKey> {
  if (typeof window === 'undefined' || !workspaceId || !userId) return new Set(DEFAULT_VISIBLE_CUSTOMER_COLUMNS);
  return parseStoredColumns(window.localStorage.getItem(storageKey(workspaceId, userId))) || new Set(DEFAULT_VISIBLE_CUSTOMER_COLUMNS);
}

/**
 * Preference "cột nào hiển thị" cho bảng Khách hàng - rieng theo TUNG
 * workspace+user (khong phai 1 key global), luu localStorage
 * `crm_customer_columns:<workspace_id>:<user_id>`. FE-only: khong goi API,
 * khong doi backend/migration nao.
 *
 * `workspaceId`/`userId` = null/'' (chua xac dinh - vd auth con dang load)
 * -> luon dung mac dinh hien het 8 cot, KHONG doc/ghi localStorage (tranh
 * fallback ve 1 key global dung chung hoac de user nay ghi de preference cua
 * user khac).
 *
 * `visible` KHONG phai state truc tiep - la useMemo doc lai localStorage moi
 * khi (workspaceId, userId, version) doi. `version` chi la 1 counter tang len
 * moi lan ghi (persist) de kich hoat memo tinh lai - tranh phai "reset state
 * khi prop doi" (can either useEffect+setState, bi cam boi
 * react-hooks/set-state-in-effect, hoac doc/ghi ref luc render, bi cam boi
 * react-hooks/refs trong eslint config cua repo nay).
 */
export function useCustomerColumnPreferences(workspaceId: string | null, userId: string | null) {
  const [version, setVersion] = useState(0);
  const visible = useMemo(
    () => loadVisibleColumns(workspaceId, userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` khong doc trong body, chi dung de buoc tinh lai sau persist().
    [workspaceId, userId, version],
  );

  const persist = useCallback((next: Set<CustomerColumnKey>) => {
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

  const toggle = useCallback((key: CustomerColumnKey) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  }, [visible, persist]);

  const resetToDefault = useCallback(() => {
    persist(new Set(DEFAULT_VISIBLE_CUSTOMER_COLUMNS));
  }, [persist]);

  return { visible, toggle, selectAll: resetToDefault, resetToDefault };
}
