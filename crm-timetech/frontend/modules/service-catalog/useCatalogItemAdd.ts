'use client';

import { useState } from 'react';

/** Dung chung cho MOI diem goi Catalog Picker (QuoteWorkspaceModal, FillQuoteStep)
 * - loai bo hanh vi trung lap khac nhau giua 2 noi (1 ben dung ConfirmModal
 * tang SL/them dong moi, 1 ben chi disable dong da co) da bi audit bat loi:
 * CA HAI PHAI cung hien trang thai "Da them" (khong disable am tham) VA cung
 * dung ConfirmModal 3 lua chon khi nguoi dung co them lai 1 san pham da co
 * san trong bang.
 *
 * `T` la kieu item TRUNG GIAN da chuan hoa qua normalizeCatalogSelection()
 * (khong phai QuoteItem/VillaSolutionItem truc tiep - noi goi tu quyet dinh
 * anh xa T -> kieu dong hang muc that su cua minh trong `onAdd`). */
export interface CatalogAddCandidate<T> {
  /** Khoa trung lap - vd catalogItemId hoac priceBookItemId cua dong da co
   * san trong bang, dung de biet "san pham nay DA CO trong quote chua". */
  key: string;
  item: T;
}

export interface CatalogDedupEntry<T> {
  candidate: CatalogAddCandidate<T>;
  existingIndex: number;
  label: string;
}

export function useCatalogItemAdd<T>({
  existingKeys,
  onAdd,
}: {
  /** Danh sach khoa (catalogItemId/priceBookItemId) DA CO trong bang hien
   * tai - dung de biet dong nao la "Da them" VA de phat hien trung lap khi
   * chon them. Tinh lai moi lan goi handleAddSelected (khong cache), phan
   * anh dung state THAT cua itemsDraft/quoteDraft ngay luc bam. */
  existingKeys: Map<string, number>;
  /** Ghi cac item MOI (khong trung) vao state cua noi goi - noi goi CHI lo
   * ghi vao dung kieu state cua minh, khong tu viet lai rule dedup. */
  onAdd: (items: T[]) => void;
}) {
  const [dedupQueue, setDedupQueue] = useState<CatalogDedupEntry<T>[]>([]);

  function isAlreadyAdded(key: string): boolean {
    return existingKeys.has(key);
  }

  /** Tra ve so dong bi trung (day vao hang doi ConfirmModal) - dung gia tri
   * TRA VE nay de quyet dinh hanh dong tiep theo (vd dong modal ngay hay
   * doi ConfirmModal), KHONG doc lai `dedupQueue` tu closure/state ngay sau
   * khi goi ham nay (setState bat dong bo, doc lai se la gia tri CU). */
  function handleAddSelected(candidates: Array<CatalogAddCandidate<T> & { label: string }>): number {
    const fresh: T[] = [];
    const dedup: CatalogDedupEntry<T>[] = [];
    for (const candidate of candidates) {
      const existingIndex = existingKeys.get(candidate.key);
      if (existingIndex != null) {
        dedup.push({ candidate, existingIndex, label: candidate.label });
      } else {
        fresh.push(candidate.item);
      }
    }
    if (fresh.length) onAdd(fresh);
    if (dedup.length) setDedupQueue(prev => [...prev, ...dedup]);
    return dedup.length;
  }

  /** Nguoi goi xu ly 1 dong dedup: 'increase' = tang SL dong da co (noi goi
   * tu quyet dinh cach tang, ham nay chi phat tin hieu + cung cap
   * existingIndex); 'addNew' = van them thanh dong moi (goi onAdd voi item
   * do); 'cancel' (mac dinh khi dong ConfirmModal) = bo qua, khong lam gi. */
  function resolveDedup(action: 'increase' | 'addNew', onIncrease: (existingIndex: number) => void) {
    const current = dedupQueue[0];
    if (!current) return;
    if (action === 'increase') onIncrease(current.existingIndex);
    else onAdd([current.candidate.item]);
    setDedupQueue(prev => prev.slice(1));
  }

  function cancelDedup() {
    setDedupQueue(prev => prev.slice(1));
  }

  return { dedupQueue, isAlreadyAdded, handleAddSelected, resolveDedup, cancelDedup };
}
