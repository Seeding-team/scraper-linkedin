'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { WorkspaceMeta } from './types';
import { IS_STANDALONE_CRM } from '@/lib/env';

/**
 * Hook quản lý trạng thái bộ lọc Workspace.
 * 
 * TÍCH HỢP BỘ LỌC WORKSPACE:
 * - Tự động phát hiện môi trường:
 *   + Seeding chính: isStandalone = false -> Nút bộ lọc hiển thị, hỗ trợ multi-select.
 *   + CRM Standalone: isStandalone = true -> mặc định "Tất cả" (dùng chung giữa 4 clone,
 *     giống Seeding chính), chỉ ẩn nút bộ lọc trên UI (không cho đổi thủ công).
 * - Tải danh sách Workspaces 100% động từ Database qua endpoint /api/all-platform/service-catalog/workspaces.
 * - Quản lý trạng thái áp dụng (appliedWorkspaces).
 */
export function useWorkspaceFilter() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Môi trường standalone hay Seeding chính
  const isStandalone = IS_STANDALONE_CRM;

  // State các workspace đã áp dụng để query API
  // BUG THAT DA GAP ("sp và dv bên timetech chưa thấy hiện, nhớ xài chung 4
  // clone mà"): TRUOC DAY Standalone tu gan cung [CURRENT_WORKSPACE_INSTANCE]
  // - "Sản phẩm & dịch vụ" la bang DUNG CHUNG giua 4 clone (khong co y dinh
  // tach rieng theo workspace, khac han Khach hang/Lead/Deal/Bao gia), nen
  // loc cung nay khien moi clone CHI thay dung nhom cua minh, trong khi du
  // lieu that nam het duoi 1 instance (truoc day la 'markee' do
  // CURRENT_WORKSPACE_INSTANCE bi loi luon tra 'markee' o moi app - xem fix
  // NEXT_PUBLIC_CRM_INSTANCE build-arg). Standalone gio cung mac dinh RONG
  // (= "Tất cả") giong Seeding chinh - UI nut loc van an o Standalone (xem
  // `isStandalone` ben duoi), chi khac o day KHONG con tu dong thu hep theo
  // instance nua.
  const [appliedWorkspaces, setAppliedWorkspaces] = useState<string[]>([]);

  // Fetch danh sách workspace động từ DB (dùng async promise callback)
  useEffect(() => {
    let active = true;
    serviceCatalogRepository
      .getWorkspaces()
      .then(data => {
        if (!active) return;
        setWorkspaces(data || []);
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Không tải được danh sách workspace');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Đặt lại (reset về Tất cả)
  const resetFilter = useCallback(() => {
    setAppliedWorkspaces([]);
  }, []);

  // Label hiển thị trên nút Trigger
  const triggerLabel = useMemo(() => {
    if (appliedWorkspaces.length === 0) {
      return 'Tất cả';
    }
    if (appliedWorkspaces.length === 1) {
      const match = workspaces.find(w => w.instance_key.toLowerCase() === appliedWorkspaces[0].toLowerCase());
      return match?.name || match?.code || appliedWorkspaces[0];
    }
    return `${appliedWorkspaces.length} đã chọn`;
  }, [appliedWorkspaces, workspaces]);

  return {
    workspaces,
    loading,
    error,
    isStandalone,
    appliedWorkspaces,
    setAppliedWorkspaces,
    triggerLabel,
    resetFilter,
  };
}
