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
 *   + CRM Standalone (clone): KHÓA list luôn theo workspace của chính clone
 *     (CURRENT_WORKSPACE_INSTANCE, suy từ build arg NEXT_PUBLIC_CRM_INSTANCE
 *     của stack đó) — Requirement B: clone KHÔNG hiển thị groups của workspace
 *     khác; server lọc trước khi trả (instances= được truyền vào mỗi query).
 *
 * LỊCH SỬ (giữ ngữ cảnh): trước 2026-10-12 clone cố ý để "Tất cả" vì khi đó
 * toàn bộ rows đều instance='markee' + CURRENT_WORKSPACE_INSTANCE luôn trả
 * 'markee' ở mọi app. Từ migration 190 (junction many-to-many), DB có thật
 * sự phân bổ theo workspace (vd securityzone chỉ tồn tại trong junction) và
 * yêu cầu hiện tại (Requirement B) là lọc chặt → mở lại scoping và GUARD
 * setter: mọi đường đổi filter trong clone đều bị ép về workspace của clone.
 *
 * - Tải danh sách Workspaces 100% động từ Database qua endpoint
 *   /api/all-platform/service-catalog/workspaces; refreshWorkspaces() cho phép
 *   sync-poller (use-service-catalog) làm mới metadata khi fingerprint đổi.
 */
export function useWorkspaceFilter() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Môi trường standalone hay Seeding chính
  const isStandalone = IS_STANDALONE_CRM;

  // Workspace key mở khóa của clone này (lowercase — chuẩn so với junction)
  const ownInstance = useMemo(() => CURRENT_WORKSPACE_INSTANCE.toLowerCase(), []);

  // State các workspace đã áp dụng để query API.
  // STANDALONE: luôn đúng 1 workspace của clone (Requirement B — strict
  // filtering, server-side qua `instances=`); không route UI nào thay được.
  const [appliedWorkspaces, setAppliedWorkspacesState] = useState<string[]>(() =>
    IS_STANDALONE_CRM ? [CURRENT_WORKSPACE_INSTANCE.toLowerCase()] : []
  );

  // Guard setter: ở standalone MỌI attempt đổi/thêm/reset đều bị ép về đúng
  // workspace của clone (openGroupsFor('')/resetFilter/popover... không thể
  // mở rộng scope). MAIN giữ hành vi set tự do như cũ.
  const setAppliedWorkspaces = useCallback(
    (value: string[] | ((prev: string[]) => string[])) => {
      if (!IS_STANDALONE_CRM) {
        setAppliedWorkspacesState(value);
        return;
      }
      setAppliedWorkspacesState([ownInstance]);
    },
    [ownInstance]
  );

  // Fetch danh sách workspace động từ DB (async promise callback — rule
  // react-hooks: setState chỉ trong callback, không trong effect body).
  const loadWorkspaces = useCallback(async () => {
    try {
      const data = await serviceCatalogRepository.getWorkspaces();
      setWorkspaces(data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách workspace');
    } finally {
      setLoading(false);
    }
  }, []);

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

  // ĐỒNG BỘ CROSS-CLONE (Requirement C): hook cho page cắm vào sync callback
  // (fingerprint đổi → metadata workspace/counts cũng được làm mới).
  const refreshWorkspaces = useCallback(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  // Đặt lại (MAIN: về Tất cả; standalone: guard giữ workspace của clone)
  const resetFilter = useCallback(() => {
    setAppliedWorkspaces(IS_STANDALONE_CRM ? [ownInstance] : []);
  }, [ownInstance, setAppliedWorkspaces]);

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
    ownInstance,
    appliedWorkspaces,
    setAppliedWorkspaces,
    refreshWorkspaces,
    triggerLabel,
    resetFilter,
  };
}
