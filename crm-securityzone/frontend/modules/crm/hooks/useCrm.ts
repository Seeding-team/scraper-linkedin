'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { CrmRepository } from '../repositories/CrmRepository';
import { allPlatformCategoriesService } from '@/services/all-platform.service';
import { SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import type {
  AnalyticsFilters,
  CreateDealInput,
  CrmUserOption,
  Deal,
  DealFilters,
  DealStage,
  StageTransitionInput,
  UpdateDealInput,
} from '../types';

type CrmSelectOption = { value: string; label: string };

const INDUSTRY_SELECT_OPTIONS: CrmSelectOption[] = INDUSTRY_OPTIONS.map(value => ({ value, label: value }));

// Danh mục Lĩnh vực / Nguồn / Danh mục sản phẩm / Gói mặc định hardcode trong
// crmConfig, hoà với dữ liệu leader tự thêm/sửa qua trang "Quản lý danh mục"
// (category_type crm_industry/crm_source/crm_service_package/crm_package).
// Mục nào trùng "code" với default thì lấy tên hiển thị mới nhất từ DB (leader
// sửa tên là có hiệu lực ngay); mục DB-only (leader tự thêm) được nối thêm vào cuối.
export function mergeCategoryOptions(defaults: CrmSelectOption[], dynamic?: Array<{ code: string; name?: string }>): CrmSelectOption[] {
  const dynamicByCode = new Map((dynamic || []).map(item => [item.code, item]));
  const merged = defaults.map(option => {
    const override = dynamicByCode.get(option.value);
    return override ? { value: option.value, label: override.name || option.label } : option;
  });
  const extra = (dynamic || [])
    .filter(item => !defaults.some(option => option.value === item.code))
    .map(item => ({ value: item.code, label: item.name || item.code }));
  return [...merged, ...extra];
}

export function useCrm(repository: CrmRepository = seedingCrmRepository) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [agents, setAgents] = useState<CrmUserOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<CrmSelectOption[]>(SOURCE_OPTIONS);
  const [servicePackageOptions, setServicePackageOptions] = useState<CrmSelectOption[]>(SERVICE_PACKAGE_OPTIONS);
  const [packageOptions, setPackageOptions] = useState<CrmSelectOption[]>(CRM_PACKAGE_OPTIONS);
  const [industryOptions, setIndustryOptions] = useState<CrmSelectOption[]>(INDUSTRY_SELECT_OPTIONS);
  const [cityOptions, setCityOptions] = useState<CrmSelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadDeals = useCallback(
    async (filters?: DealFilters) => {
      setLoading(true);
      setError('');
      try {
        const result = await repository.getDeals(filters);
        setDeals(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không tải được CRM.');
      } finally {
        setLoading(false);
      }
    },
    [repository]
  );

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  const loadAgents = useCallback(async () => {
    try {
      setAgents(await repository.getAgents());
    } catch {
      setAgents([]);
    }
  }, [repository]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const loadCrmCategoryOptions = useCallback(async () => {
    try {
      const [sourceRes, servicePackageRes, packageRes, industryRes, cityRes] = await Promise.all([
        allPlatformCategoriesService.getAll('crm_source'),
        allPlatformCategoriesService.getAll('crm_service_package'),
        allPlatformCategoriesService.getAll('crm_package'),
        allPlatformCategoriesService.getAll('crm_industry'),
        allPlatformCategoriesService.getAll('crm_city'),
      ]);
      setSourceOptions(mergeCategoryOptions(SOURCE_OPTIONS, sourceRes.data));
      setServicePackageOptions(mergeCategoryOptions(SERVICE_PACKAGE_OPTIONS, servicePackageRes.data));
      setPackageOptions(mergeCategoryOptions(CRM_PACKAGE_OPTIONS, packageRes.data));
      setIndustryOptions(mergeCategoryOptions(INDUSTRY_SELECT_OPTIONS, industryRes.data));
      setCityOptions((cityRes.data || []).map(item => {
        const label = item.name || item.code;
        return { value: label, label };
      }));
    } catch {
      // Giữ nguyên danh sách mặc định nếu tải danh mục mở rộng thất bại.
    }
  }, []);

  useEffect(() => {
    void loadCrmCategoryOptions();
  }, [loadCrmCategoryOptions]);

  const getDeal = useCallback(
    async (id: string) => repository.getDeal(id),
    [repository]
  );

  const createDeal = useCallback(
    async (input: CreateDealInput) => {
      setSaving(true);
      try {
        const deal = await repository.createDeal(input);
        await loadDeals();
        return deal;
      } finally {
        setSaving(false);
      }
    },
    [loadDeals, repository]
  );

  const updateDeal = useCallback(
    async (id: string, input: UpdateDealInput) => {
      setSaving(true);
      try {
        const deal = await repository.updateDeal(id, input);
        await loadDeals();
        return deal;
      } finally {
        setSaving(false);
      }
    },
    [loadDeals, repository]
  );

  const deleteDeal = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        await repository.deleteDeal(id);
        await loadDeals();
      } finally {
        setSaving(false);
      }
    },
    [loadDeals, repository]
  );

  const moveDeal = useCallback(
    async (id: string, stage: DealStage, payload?: StageTransitionInput) => {
      setSaving(true);
      try {
        const deal = await repository.moveDeal(id, stage, payload);
        await loadDeals();
        return deal;
      } finally {
        setSaving(false);
      }
    },
    [loadDeals, repository]
  );

  const stats = useMemo(() => {
    const counts = deals.reduce<Record<string, number>>((acc, deal) => {
      acc[deal.stage] = (acc[deal.stage] || 0) + 1;
      return acc;
    }, {});
    const wonValue = deals
      .filter(deal => deal.stage === 'won')
      .reduce(
        (sum, deal) => sum + Number(deal.quote?.totalAmount || deal.estimatedBudget || 0),
        0
      );
    return {
      counts,
      totalDeals: deals.length,
      wonCount: counts.won || 0,
      lostCount: counts.lost || 0,
      openCount: Math.max(deals.length - (counts.won || 0) - (counts.lost || 0), 0),
      wonValue,
    };
  }, [deals]);

  return {
    deals,
    agents,
    sourceOptions,
    servicePackageOptions,
    packageOptions,
    industryOptions,
    cityOptions,
    loading,
    saving,
    error,
    stats,
    loadDeals,
    loadAgents,
    getDeal,
    createDeal,
    updateDeal,
    deleteDeal,
    moveDeal,
    getAnalytics: (filters?: AnalyticsFilters) => repository.getAnalytics(filters),
  };
}
