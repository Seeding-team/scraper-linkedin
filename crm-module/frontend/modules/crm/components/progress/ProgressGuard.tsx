'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { hasProgressAccess } from '../../constants/crmConfig';
import { ProgressDashboardView } from './ProgressDashboardView';

/** "/crm/progress" ("Quản lý tiến độ") — chỉ admin/leader (KHÁC
 * CrmAnalyticsGuard: không mở cho Sale), khớp `require_admin_or_leader` +
 * `progress_scope()` ở backend. Member gõ thẳng URL vẫn bị đưa về Cơ hội. */
export function ProgressGuard() {
  const { user, isLoading } = useAppAuth();
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (hasProgressAccess(user)) {
      setAuthorized(true);
    } else {
      router.replace('/all-platform/crm');
    }
  }, [isLoading, user, router]);

  if (authorized === null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center p-6 text-center text-on-surface-variant">
        <div className="mb-3 h-8 w-8 animate-spin rounded-full border-4 border-outline-variant border-t-primary" />
        <p>Đang kiểm tra quyền truy cập...</p>
      </div>
    );
  }

  return <ProgressDashboardView />;
}
