'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { WorkspaceMeta } from './types';
import { IS_STANDALONE_CRM, CURRENT_WORKSPACE_INSTANCE } from '@/lib/env';

/**
 * Hook quản lý trạng thái bộ lọc Workspace.
 * 
 * TÍCH HỢP BỘ LỌC WORKSPACE:
 * - Tự động phát hiện môi trường:
 *   + Seeding chính: isStandalone = false -> Nút bộ lọc hiển thị, hỗ trợ multi-select.
 *   + CRM Standalone: isStandalone = true -> Cố định workspace theo CURRENT_WORKSPACE_INSTANCE,
 *     ẩn hoàn toàn nút bộ lọc trên UI.
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
  // Mặc định: nếu Standalone thì gán [CURRENT_WORKSPACE_INSTANCE], nếu Seeding chính thì rỗng (tức là Tất cả)
  const [appliedWorkspaces, setAppliedWorkspaces] = useState<string[]>(() => {
    if (isStandalone) {
      return [CURRENT_WORKSPACE_INSTANCE];
    }
    return [];
  });

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
