"use client";

import { useCallback, useEffect, useState } from "react";
import { allPlatformQuickCommentService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import type { QuickCommentTemplate } from "@/types/unified.types";

export type { QuickCommentTemplate };

export function useQuickCommentLibrary(platform?: string) {
  const { user } = useAppAuth();
  const [items, setItems] = useState<QuickCommentTemplate[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await allPlatformQuickCommentService.getAll(platform);
    if (res.success) {
      setItems(res.data || []);
      setError(null);
    } else {
      setError(res.message || "Không tải được thư viện mẫu comment.");
    }
    setIsLoaded(true);
  }, [platform]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTemplate = async (payload: {
    title: string;
    label: string;
    content: string;
    platform?: string;
  }) => {
    const res = await allPlatformQuickCommentService.add({
      ...payload,
      id_member: user?.id,
    });
    if (res.success) await refresh();
    return res;
  };

  const updateTemplate = async (
    id: string,
    payload: { title: string; label: string; content: string; platform?: string },
  ) => {
    const res = await allPlatformQuickCommentService.update({ id, ...payload });
    if (res.success) await refresh();
    return res;
  };

  const deleteTemplate = async (id: string) => {
    const res = await allPlatformQuickCommentService.delete(id);
    if (res.success) await refresh();
    return res;
  };

  const moveTemplate = async (id: string, direction: "up" | "down") => {
    const res = await allPlatformQuickCommentService.reorder(id, direction);
    if (res.success) await refresh();
    return res;
  };

  return {
    libraryItems: items,
    isLoaded,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    moveTemplate,
    refresh,
  };
}
