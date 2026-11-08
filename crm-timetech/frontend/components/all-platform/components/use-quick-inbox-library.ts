"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { allPlatformQuickInboxService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { INBOX_TEMPLATES, POST_PLACEHOLDER } from "./inbox-templates";
import type { QuickInboxTemplate } from "@/types/unified.types";

export interface QuickInboxLibraryEntry {
  id: string;
  title: string;
  label: string;
  content: string;
  contentWithPost?: string;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

function toEntry(record: QuickInboxTemplate): QuickInboxLibraryEntry {
  return {
    id: record.id,
    title: record.title,
    label: record.label,
    content: record.content,
    contentWithPost: record.content_with_post || undefined,
    order: record.order_index,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function buildFallbackItems(): QuickInboxLibraryEntry[] {
  return INBOX_TEMPLATES.flatMap((group, groupIndex) =>
    group.templates.map((template, templateIndex) => ({
      id: `fallback-${groupIndex}-${templateIndex}`,
      title: template.title,
      label: group.category,
      content: template.content,
      contentWithPost: template.contentWithPost,
      order: groupIndex * 100 + templateIndex + 1,
    })),
  );
}

export function composeQuickInboxMessage(
  template: Pick<QuickInboxLibraryEntry, "content" | "contentWithPost">,
  postContent?: string | null,
): string {
  const quote = (postContent || "").replace(/\s+/g, " ").trim();
  const replacement = (text?: string) =>
    (text || template.content).replace(POST_PLACEHOLDER, quote);

  if (!quote) {
    if (template.content.includes(POST_PLACEHOLDER)) {
      return template.content.replace(POST_PLACEHOLDER, "").trim();
    }
    return template.content;
  }

  if (template.contentWithPost) {
    return replacement(template.contentWithPost);
  }

  if (template.content.includes(POST_PLACEHOLDER)) {
    return replacement(template.content);
  }

  return template.content;
}

export function useQuickInboxLibrary() {
  const { user } = useAppAuth();
  const [items, setItems] = useState<QuickInboxLibraryEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await allPlatformQuickInboxService.getAll();
    if (res.success) {
      setItems((res.data || []).map(toEntry));
      setError(null);
    } else {
      setError(res.message || "Không tải được thư viện mẫu inbox.");
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fallbackItems = useMemo(() => buildFallbackItems(), []);

  const createTemplate = async (payload: {
    title: string;
    label: string;
    content: string;
    contentWithPost?: string;
  }) => {
    const res = await allPlatformQuickInboxService.add({
      title: payload.title.trim() || payload.content.slice(0, 40),
      label: payload.label.trim() || "Khác",
      content: payload.content.trim(),
      content_with_post: payload.contentWithPost?.trim() || undefined,
      id_member: user?.id,
    });
    if (res.success) await refresh();
    return res;
  };

  const updateTemplate = async (
    templateId: string,
    payload: {
      title: string;
      label: string;
      content: string;
      contentWithPost?: string;
    },
  ) => {
    const res = await allPlatformQuickInboxService.update({
      id: templateId,
      title: payload.title.trim() || payload.content.slice(0, 40),
      label: payload.label.trim() || "Khác",
      content: payload.content.trim(),
      content_with_post: payload.contentWithPost?.trim() || undefined,
    });
    if (res.success) await refresh();
    return res;
  };

  const deleteTemplate = async (templateId: string) => {
    const res = await allPlatformQuickInboxService.delete(templateId);
    if (res.success) await refresh();
    return res;
  };

  const moveTemplate = async (templateId: string, direction: "up" | "down") => {
    const res = await allPlatformQuickInboxService.reorder(templateId, direction);
    if (res.success) await refresh();
    return res;
  };

  return {
    libraryItems: items,
    fallbackItems,
    isLoaded,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    moveTemplate,
    refresh,
  };
}
