'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { PriceBookZoneTab } from './PriceBookZoneTab';
import { useServiceCatalog } from './use-service-catalog';
import './styles/service-catalog.css';

/** Trang "Bảng giá VPS Zone" - tach thanh trang RIENG (route
 * /all-platform/service-catalog/price-book-zone), truy cap qua nut o
 * toolbar trang goc thay vi la 1 tab ngang hang voi danh sach Nhom san
 * pham.
 *
 * BUG THAT DA GAP ("thành một trang ngang cấp không rõ quan hệ với nhóm
 * VPS"): yeu cau ro rang breadcrumb phai la
 * "Sản phẩm & dịch vụ / VPS Hosting / Bảng giá VPS Zone" (dat vao dung ngu
 * canh VPS, du day la 1 module nghiep vu doc lap ve du lieu - Draft/
 * Published/audit rieng, xem PriceBookZoneTab.tsx). Tim ID that cua nhom
 * "VPS Hosting" qua du lieu da tai (useServiceCatalog(), khong hardcode 1 ID
 * gia) de link dung; neu KHONG tim thay nhom ten dung nhu vay (vd doi ten
 * sau nay) thi hien segment nhu TEXT thuong (khong link vo hieu) thay vi
 * doan link 404.
 *
 * PriceBookZoneTab.tsx giu nguyen 100% - tu quan ly fetch/loading/error cua
 * chinh no (khong nhan props), file nay chi boc them breadcrumb. */
export function ServiceCatalogPriceBookZonePage() {
  const { items } = useServiceCatalog();
  const vpsGroup = useMemo(
    () => items.find(item => item.itemType === 'group' && item.name.trim().toLowerCase() === 'vps hosting'),
    [items]
  );

  return (
    <div className="sc-page">
      <nav className="sc-breadcrumb" aria-label="Breadcrumb">
        <Link href="/all-platform/service-catalog">Sản phẩm & dịch vụ</Link>
        <span className="sc-breadcrumb-sep">/</span>
        {vpsGroup ? (
          <Link href={`/all-platform/service-catalog/groups/${vpsGroup.id}`}>VPS Hosting</Link>
        ) : (
          <span>VPS Hosting</span>
        )}
        <span className="sc-breadcrumb-sep">/</span>
        <span className="sc-breadcrumb-current">Bảng giá VPS Zone</span>
      </nav>
      <div className="sc-header">
        <h1>Bảng giá VPS Zone</h1>
      </div>
      <PriceBookZoneTab />
    </div>
  );
}
