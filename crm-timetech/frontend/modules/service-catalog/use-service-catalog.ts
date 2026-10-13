'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogItemInput, BundleComponentInput, CatalogChangeFingerprint } from './types';
import { IS_STANDALONE_CRM } from '@/lib/env';

/**
 * Hook quản lý nạp và thao tác dữ liệu Service Catalog.
 *
 * TÍCH HỢP BỘ LỌC WORKSPACE:
 * - Tiếp nhận tham số `instances?: string[]` để lọc danh mục theo 1 hoặc nhiều workspace.
 * - Khi `instances` thay đổi, tự động tải lại danh sách tương ứng.
 *
 * ĐỒNG BỘ CROSS-CLONE (Requirement C — CHỈ clone standalone dùng):
 * - Các clone đọc/ghi CÙNG 1 Postgres với Seeding chính nhưng không có cơ chế
 *   push giữa các deploy (realtime không khả dụng ở DB local PostgREST), nên clone poll endpoint
 *   `GET /service-catalog/version` (fingerprint rẻ: max(updated_at) + counts)
 *   theo chu kỳ bounded 20s KHI TAB ĐANG visible, rồi mới refetch list khi
 *   fingerprint đổi — tránh poll full list và tránh request khi tab ẩn.
 * - Revalidate ngay khi tab visible lại / window focus (bắt kịp khi mạng chập
 *   chờn — fallback reconnect), lỗi poll giữ nguyên dữ liệu cũ (không banner
 *   spam) và thử lại chu kỳ sau. Token monotonic chống out-of-order/duplicate.
 * - MAIN (IS_STANDALONE_CRM=false) không có endpoint /version → không poll.
 */
const REVALIDATE_INTERVAL_MS = 20_000;

export function useServiceCatalog(instances?: string[], onSyncChange?: () => void) {
  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instancesKey = instances ? [...instances].sort().join(',') : '';

  const applyData = useCallback(async (data: ServiceCatalogItem[] | null) => {
    setItems(data || []);
    setError(null);
    setIsLoaded(true);
  }, []);

  // Fetch khi mount / đổi filter: setState chỉ chạy trong async callbacks
  // (original pattern của hook này — rule react-hooks yêu cầu vậy).
  useEffect(() => {
    let active = true;
    serviceCatalogRepository
      .list({
        instances: instances && instances.length > 0 ? instances : undefined,
      })
      .then(data => {
        if (!active) return;
        void applyData(data);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Không tải được danh mục dịch vụ.');
        setIsLoaded(true);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancesKey, applyData]);
  // ── Fingerprint lần cuối biết (sync poll) — refresh() thủ công cũng cập
  //    nhật nó để poll kế tiếp không refetch thừa sau mutation cục bộ. ──────
  const fingerprintRef = useRef<string | null>(null);

  const markFingerprint = useCallback(() => {
    if (!IS_STANDALONE_CRM) return;
    serviceCatalogRepository
      .getCatalogVersion()
      .then(fp => {
        fingerprintRef.current = [
          fp.groups_count,
          fp.items_max_updated_at ?? '',
          fp.junction_count,
        ].join('|');
      })
      .catch(() => {
        /* poll lỗi: bỏ qua — chu kỳ sau sẽ thử lại */
      });
  }, []);

  // Refresh thủ công sau mutation thành công (create/update/delete/assign) —
  // refetch light-weight; không optimistic update khi fetch lỗi.
  const refresh = useCallback(async () => {
    setIsFetching(true);
    try {
      const data = await serviceCatalogRepository.list({
        instances: instances && instances.length > 0 ? instances : undefined,
      });
      await applyData(data);
      markFingerprint();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh mục dịch vụ.');
    } finally {
      setIsFetching(false);
    }
  }, [instances, applyData, markFingerprint]);

  // ── Poller đồng bộ (clone-only) ────────────────────────────────────────────
  const onSyncChangeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    onSyncChangeRef.current = onSyncChange ?? null;
  }, [onSyncChange]);

  useEffect(() => {
    if (!IS_STANDALONE_CRM) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0; // token monotonic: response cũ của request cũ bị bỏ qua

    const fingerprintKey = (fp: CatalogChangeFingerprint) =>
      [fp.groups_count, fp.items_max_updated_at ?? '', fp.junction_count].join('|');

    const revalidate = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        schedule();
        return;
      }
      const my = ++seq;
      try {
        const fp = await serviceCatalogRepository.getCatalogVersion();
        if (stopped || my !== seq) return;
        const key = fingerprintKey(fp);
        const previous = fingerprintRef.current;
        fingerprintRef.current = key;
        if (previous !== null && key !== previous) {
          // Dữ liệu ở nơi khác (Seeding/clone khác) vừa thay đổi → refetch
          // đúng scope của clone này + báo page để refresh workspaces metadata.
          await refresh();
          onSyncChangeRef.current?.();
        }
      } catch {
        /* lỗi poll: giữ dữ liệu cũ, thử lại chu kỳ sau (fallback an toàn) */
      }
      schedule();
    };

    function schedule() {
      if (stopped || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void revalidate();
      }, REVALIDATE_INTERVAL_MS);
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [instancesKey, refresh]); // refetch đúng scope hiện tại

  const createItem = async (input: ServiceCatalogItemInput) => {
    const result = await serviceCatalogRepository.create(input);
    await refresh();
    return result;
  };

  const updateItem = async (id: string, input: Partial<ServiceCatalogItemInput>) => {
    const result = await serviceCatalogRepository.update(id, input);
    await refresh();
    return result;
  };

  const deleteItem = async (id: string) => {
    const result = await serviceCatalogRepository.delete(id);
    await refresh();
    return result;
  };

  const moveItem = async (id: string, direction: 'up' | 'down') => {
    const result = await serviceCatalogRepository.reorder(id, direction);
    await refresh();
    return result;
  };

  const setBundleComponents = async (bundleId: string, items_: BundleComponentInput[]) => {
    const result = await serviceCatalogRepository.setBundleComponents(bundleId, items_);
    await refresh();
    return result;
  };

  return { items, isLoaded, isFetching, error, createItem, updateItem, deleteItem, moveItem, setBundleComponents, refresh };
}
