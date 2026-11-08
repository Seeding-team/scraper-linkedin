"use client";

import { useState, useEffect } from "react";
import { socialAccountsService } from "@/services/all-platform.service";
import type { SocialAccount } from "@/types/unified.types";
import { cn } from "@/lib/utils";

interface VerifyAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  postUrl: string;
  postId?: string;
  platform: string;
  memberEmail: string;
}

export function VerifyAccountModal({
  isOpen,
  onClose,
  postUrl,
  postId,
  platform,
  memberEmail,
}: VerifyAccountModalProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      // Determine platform ID for query
      const pid = platform.toLowerCase() === "facebook" ? 1 : platform.toLowerCase() === "linkedin" ? 2 : undefined;

      socialAccountsService
        .getAll(platform.toLowerCase() as "facebook" | "linkedin" | undefined)
        .then((res) => {
          if (res.success && res.data) {
            setAccounts(res.data);
            const saved = localStorage.getItem("kpi_selected_social_account_id");
            if (saved && res.data.some((a: SocialAccount) => a.id === saved)) {
              setSelectedId(saved);
            } else if (res.data.length > 0) {
              setSelectedId(res.data[0].id);
            }
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, platform]);

  if (!isOpen) return null;

  const handleVerify = () => {
    if (!selectedId) {
      alert("Vui lòng chọn một tài khoản mạng xã hội.");
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === selectedId);
    if (!selectedAccount) return;

    localStorage.setItem("kpi_selected_social_account_id", selectedId);

    const nameValue = selectedAccount.account_name || "";
    const profileIdValue = selectedAccount.account_profile_id || "";
    const platformIdValue = selectedAccount.id_platform || (platform === "facebook" ? 1 : 2);

    const targetUrl = `${postUrl}#kpi_email=${encodeURIComponent(
      memberEmail
    )}&kpi_uid=${encodeURIComponent(profileIdValue)}&kpi_name=${encodeURIComponent(
      nameValue
    )}&social_account_id=${encodeURIComponent(
      selectedAccount.id
    )}&platform_id=${encodeURIComponent(platformIdValue.toString())}&post_id=${encodeURIComponent(postId || "")}`;

    const win = window.open(targetUrl, "_blank");
    if (!win) {
      alert("Không thể mở tab mới. Vui lòng cho phép popup cho trang này.");
    } else {
      onClose(); // Close modal after opening
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-[400px] max-w-[90vw] rounded-xl bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-foreground">
          Chọn tài khoản seeding ({platform === "facebook" ? "Facebook" : "LinkedIn"})
        </h2>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Đang tải tài khoản...</div>
        ) : accounts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Chưa có tài khoản {platform} nào được thêm. Vui lòng thêm tài khoản trước khi xác minh.
          </div>
        ) : (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto mb-6">
            {accounts.map((acc) => (
              <label
                key={acc.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                  selectedId === acc.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted"
                )}
              >
                <input
                  type="radio"
                  name="social_account"
                  value={acc.id}
                  checked={selectedId === acc.id}
                  onChange={() => setSelectedId(acc.id)}
                  className="h-4 w-4 text-primary focus:ring-primary"
                />
                <div>
                  <div className="text-sm font-bold text-foreground">{acc.account_name}</div>
                  <div className="text-xs text-muted-foreground">UID: {acc.account_profile_id}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Hủy
          </button>
          <button
            onClick={handleVerify}
            disabled={!selectedId || accounts.length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Tiến hành Xác minh
          </button>
        </div>
      </div>
    </div>
  );
}
