/**
 * useMembers — nguồn dữ liệu DUY NHẤT cho mọi dropdown liên quan tới nhân sự
 * trong app (GET /api/all-platform/members). Không hard-code / không tự tạo
 * danh sách riêng ở từng màn hình — mọi nơi cần chọn người đều dùng hook này.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { allPlatformMembersService } from "@/services/all-platform.service";
import type { MemberProfile } from "@/types/unified.types";

export function useMembers() {
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await allPlatformMembersService.getAll();
      if (!res.success) throw new Error(res.message || 'Không tải được danh sách thành viên.');
      setMembers(res.data || []);
    } catch (err) {
      setMembers([]);
      setError(err instanceof Error ? err.message : 'Không tải được danh sách thành viên.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  return { members, loading, error, loadMembers };
}
