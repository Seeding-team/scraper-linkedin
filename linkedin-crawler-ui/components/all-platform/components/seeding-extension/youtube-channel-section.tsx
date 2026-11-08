"use client";

/**
 * Liên kết kênh YouTube với tài khoản Markee (tab "Kênh YouTube" của SeedingExtensionPanel).
 *
 * Extension đọc kênh YouTube đang đăng nhập trên trình duyệt (channel_id + @handle + tên), người
 * dùng bấm "Liên kết" -> lưu thành tài khoản seeding (social_accounts, platform youtube). Khi comment,
 * chỉ tính KPI nếu kênh đang đăng nhập trùng kênh đã liên kết.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { socialAccountsService, youtubeSeedingService } from "@/services/all-platform.service";
import type { SocialAccount } from "@/types/unified.types";
import { YOUTUBE_EXTENSION_VERSION } from "./use-seeding-extension";
import { detectYouTubeAccount, type DetectedYouTubeAccount } from "./use-youtube-seeding";

async function loadLinkedChannels(): Promise<SocialAccount[]> {
  try {
    const res = await socialAccountsService.getAll("youtube");
    return res.success && res.data ? res.data.filter((a) => a.is_active !== false) : [];
  } catch {
    return [];
  }
}

/** Kênh YouTube đã liên kết của người đang đăng nhập (dùng chung cho modal comment). */
export function useLinkedYouTubeChannels(enabled = true) {
  // null = đang tải lần đầu.
  const [channels, setChannels] = useState<SocialAccount[] | null>(null);

  const reload = useCallback(async () => {
    setChannels(await loadLinkedChannels());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadLinkedChannels().then((list) => {
      if (!cancelled) setChannels(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { channels: channels ?? [], isLoading: enabled && channels === null, reload };
}

interface YouTubeChannelSectionProps {
  isReady: boolean;
  needsUpdate: boolean;
}

export function YouTubeChannelSection({ isReady, needsUpdate }: YouTubeChannelSectionProps) {
  const { channels, isLoading, reload } = useLinkedYouTubeChannels();
  const [detected, setDetected] = useState<DetectedYouTubeAccount | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const handleDetect = async () => {
    setIsDetecting(true);
    setDetected(null);
    try {
      const res = await detectYouTubeAccount();
      setDetected(res);
      if (!res.success) toast.error(res.error || "Không đọc được kênh YouTube.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không đọc được kênh YouTube.");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleLink = async () => {
    if (!detected?.loggedIn) return;
    setIsLinking(true);
    try {
      const res = await youtubeSeedingService.linkChannel({
        channel_id: detected.channel_id,
        handle: detected.handle,
        name: detected.name,
      });
      if (res.success) {
        toast.success(res.message || "Đã liên kết kênh YouTube.");
        setDetected(null);
        await reload();
      } else {
        toast.error(res.message || "Không liên kết được kênh YouTube.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không liên kết được kênh YouTube.");
    } finally {
      setIsLinking(false);
    }
  };

  const detectedName = detected?.name || detected?.handle || detected?.channel_id;

  return (
    <div className="flex flex-col gap-4">
      {needsUpdate ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Extension bạn đang cài chưa hỗ trợ YouTube. Tải bản {YOUTUBE_EXTENSION_VERSION} ở nút &quot;Tải Extension&quot;,
          giải nén đè lên thư mục cũ, vào chrome://extensions bấm reload trên Markee Seeding Extension rồi F5 lại trang này.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div>
            <h4 className="text-sm font-bold text-foreground">Liên kết kênh đang đăng nhập</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
              Đăng nhập YouTube trên trình duyệt này bằng kênh bạn dùng để seeding, rồi bấm nhận diện. Chỉ comment bằng
              kênh đã liên kết mới được tính KPI cho tài khoản Markee của bạn.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDetect}
            disabled={!isReady || needsUpdate || isDetecting}
            className="self-start px-4 py-2 rounded-xl bg-card border border-primary text-primary hover:bg-primary hover:text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDetecting ? "Đang đọc kênh YouTube..." : "Nhận diện kênh YouTube"}
          </button>

          {detected?.success ? (
            detected.loggedIn ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex flex-col gap-2">
                <div className="text-sm text-foreground">
                  Đang đăng nhập: <span className="font-bold">{detectedName}</span>
                  {detected.handle && detected.name ? <span className="text-muted-foreground"> ({detected.handle})</span> : null}
                </div>
                <button
                  type="button"
                  onClick={handleLink}
                  disabled={isLinking}
                  className="self-start px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-bold disabled:opacity-50"
                >
                  {isLinking ? "Đang liên kết..." : "Liên kết kênh này"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Trình duyệt chưa đăng nhập YouTube (hoặc tài khoản chưa có kênh). Mở youtube.com, đăng nhập rồi thử lại.
              </div>
            )
          ) : null}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
          <h4 className="text-sm font-bold text-foreground">Kênh đã liên kết ({channels.length})</h4>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Đang tải...</p>
          ) : channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">Chưa liên kết kênh YouTube nào — chưa thể comment tính KPI.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-foreground">{c.account_name}</span>
                    {c.account_handle ? <span className="text-muted-foreground"> · {c.account_handle}</span> : null}
                  </span>
                  {c.is_primary ? <span className="shrink-0 text-[10px] font-bold text-primary">Mặc định</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
