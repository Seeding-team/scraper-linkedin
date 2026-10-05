'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes/repositories/SeedingQuoteRepository';
import type { SystemExchangeRate } from '@/modules/quotes/repositories/QuoteRepository';

/** Ty gia USD->VND HE THONG (bang quote_exchange_rates) — backend TU lay tu nguon uy tin (tygiausd.org,
 * du phong ExchangeRate-API), co the bi Admin override thu cong. Nguon duy nhat cho form San pham/Dich vu,
 * import NCC va bao gia (Workspace + Tao bao gia nhanh). KHONG hard-code ty gia trong code: khong lay
 * duoc va chua tung co rate → null va nguoi dung nhap tay. Bao gia da tao KHONG doc lai ty gia nay
 * (dung snapshot da chot). */
const TTL_MS = 60_000;
let cache: { at: number; promise: Promise<SystemExchangeRate | null> } | null = null;

/** force=true bo qua cache (dung ngay luc nguoi dung chon USD de lay ty gia MOI NHAT). */
export function fetchSystemUsdVndRateInfo(force = false): Promise<SystemExchangeRate | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = seedingQuoteRepository
    .getExchangeRate()
    .then(result => (result?.rate && result.rate > 0 ? result : null))
    .catch(() => {
      cache = null;
      return null;
    });
  cache = { at: Date.now(), promise };
  return promise;
}

export function fetchSystemUsdVndRate(force = false): Promise<number | null> {
  return fetchSystemUsdVndRateInfo(force).then(info => info?.rate ?? null);
}

export function invalidateSystemUsdVndRate(): void {
  cache = null;
}

/** "Tỷ giá USD thị trường tự do – tygiausd.org · cập nhật 14:05 05/10/2026" — de nguoi dung biet rate tu dau, luc nao. */
export function describeSystemRate(info: Pick<SystemExchangeRate, 'source' | 'updatedAt' | 'isManual' | 'stale'> | null | undefined): string {
  if (!info) return '';
  const when = info.updatedAt ? new Date(info.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  return [info.source, when ? `cập nhật ${when}` : ''].filter(Boolean).join(' · ');
}

export function useSystemUsdVndRate(): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSystemUsdVndRate().then(value => {
      if (alive) setRate(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return rate;
}
