"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SeedingMark } from "@/types/unified.types";

interface SeedingModalProps {
  isOpen: boolean;
  onClose: () => void;
  postUrl: string;
  emailMember: string;
  platform: string;
  onSubmit: (payload: SeedingPayload) => Promise<void>;
  existingMark?: SeedingMark;
}

export interface SeedingPayload {
  email_member: string;
  link_post: string;
  platform: string;
  name?: string;
  link_comment?: string;
  name_profile?: string;
  profile_id?: string;
  facebook_name?: string;
  current_day?: string;
}

export function SeedingModal({
  isOpen,
  onClose,
  postUrl,
  emailMember,
  platform,
  onSubmit,
  existingMark,
}: SeedingModalProps) {
  const [profileId, setProfileId] = useState(existingMark?.profile_id || "");
  const [fbName, setFbName] = useState(existingMark?.facebook_name || "");
  const [linkComment, setLinkComment] = useState(existingMark?.link_comment || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit({
        email_member: emailMember,
        link_post: postUrl,
        platform,
        profile_id: profileId || undefined,
        facebook_name: fbName || undefined,
        link_comment: linkComment || undefined,
        current_day: new Date().toISOString().split("T")[0],
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-[512px] rounded-xl bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-on-surface">
          {existingMark ? "Cập nhật Seeding" : "Đánh dấu Seeding"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Link bài viết
            </label>
            <input
              type="url"
              value={postUrl}
              readOnly
              className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Facebook Profile ID
            </label>
            <input
              type="text"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              placeholder="Ví dụ: 1000000000"
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Tên Facebook
            </label>
            <input
              type="text"
              value={fbName}
              onChange={(e) => setFbName(e.target.value)}
              placeholder="Ví dụ: Nguyễn Văn A"
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Link bình luận (sau khi comment)
            </label>
            <input
              type="url"
              value={linkComment}
              onChange={(e) => setLinkComment(e.target.value)}
              placeholder="https://www.facebook.com/..."
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <p className="rounded-lg bg-primary/10 p-3 text-xs text-primary">
            1. Mở bài viết → 2. Để lại bình luận → 3. Copy link bình luận vào đây → 4. Nhấn Xác minh
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={cn(
              "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors",
              isSubmitting ? "opacity-50 cursor-not-allowed" : "hover:bg-primary/90",
            )}
          >
            {isSubmitting ? "Đang lưu..." : "Đánh dấu Seeding"}
          </button>
        </div>
      </div>
    </div>
  );
}
