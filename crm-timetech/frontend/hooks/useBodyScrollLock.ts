'use client';

import { useEffect } from 'react';

// Dem so "khoa" dang mo cung luc (module-level, dung chung cho MOI lan goi
// hook nay trong toan app) - bat buoc phai reference-count thay vi tung nơi
// tu snapshot/restore overflow rieng: 1 deal modal co the mo BEN TRONG 1
// trang (vd CrmShell.tsx) ma chinh trang do CUNG dang tu khoa scroll rieng
// (nhieu overlay khac nhau dung chung 1 effect) - neu 2 noi doc lap luu lai
// "gia tri overflow truoc do" roi tra ve khong dung thu tu, ket qua la
// body bi ket o 'hidden' vinh vien sau khi dong het modal (bug thuc te gap
// phai: "mobile khong cuon duoc" sau khi dung qua 1 luong co long modal).
let lockCount = 0;
let originalOverflow: string | null = null;

function acquireLock() {
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow ?? '';
    originalOverflow = null;
  }
}

/**
 * Khoa scroll cua trang phia sau khi 1 modal/overlay dang mo - tranh vua co
 * scrollbar trang ngoai vua co scrollbar trong modal cung luc. Dung dem tham
 * chieu (reference count) o module-level thay vi tung instance tu snapshot/
 * restore rieng - an toan khi nhieu lock chong nhau (vd modal nay mo trong
 * luc 1 effect khac cua trang cha cung dang khoa scroll).
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    acquireLock();
    return () => {
      releaseLock();
    };
  }, [locked]);
}
