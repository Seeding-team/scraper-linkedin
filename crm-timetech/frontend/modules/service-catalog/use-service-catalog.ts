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
  const [error, setError] = useState<string | null>(null);

  const instancesKey = instances ? [...instances].sort().join(',') : '';

  const refresh = useCallback(async () => {
    try {
      // TÍCH HỢP BỘ LỌC WORKSPACE: Truyền instances vào list()
      const data = await serviceCatalogRepository.list({
        instances: instances && instances.length > 0 ? instances : undefined,
      });
      setItems(data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh mục dịch vụ.');
    } finally {
      setIsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancesKey]);

  useEffect(() => {
    let active = true;
    serviceCatalogRepository
      .list({
        instances: instances && instances.length > 0 ? instances : undefined,
      })
      .then(data => {
        if (!active) return;
        setItems(data || []);
        setError(null);
        setIsLoaded(true);
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
  }, [instancesKey]);

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

  return { items, isLoaded, error, createItem, updateItem, deleteItem, moveItem, setBundleComponents, refresh };
}
