'use client';

import { useCallback, useEffect, useState } from 'react';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogItemInput, BundleComponentInput } from './types';

/**
 * Hook quản lý nạp và thao tác dữ liệu Service Catalog.
 * 
 * TÍCH HỢP BỘ LỌC WORKSPACE:
 * - Tiếp nhận tham số `instances?: string[]` để lọc danh mục theo 1 hoặc nhiều workspace.
 * - Khi `instances` thay đổi, tự động tải lại danh sách tương ứng.
 */
export function useServiceCatalog(instances?: string[]) {
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

  // Fetch được mount / đổi filter: setState chỉ chạy trong async callbacks
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

  // Refresh thủ công sau mutation thành công (create/delete/delete/assign) —
  // refetch light-weight; ws counts (client-derived từ groups) tự cập nhật
  // đúng khi data về (khong optimistic update khi fetch lỗi).
  const refresh = useCallback(async () => {
    setIsFetching(true);
    try {
      const data = await serviceCatalogRepository.list({
        instances: instances && instances.length > 0 ? instances : undefined,
      });
      await applyData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh mục dịch vụ.');
    } finally {
      setIsFetching(false);
    }
  }, [instances, applyData]);

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
