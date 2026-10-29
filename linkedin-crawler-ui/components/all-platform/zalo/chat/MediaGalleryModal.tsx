"use client";

/**
 * Xem lại TOÀN BỘ ảnh đã trao đổi trong 1 hội thoại, giống tính năng "Ảnh/Video"
 * của Zalo thật (yêu cầu người dùng 2026-09-26: "kéo ảnh qua về để xem ảnh từ
 * trước đến nay trong hội thoại như zalo") — 2 chế độ:
 *   - "grid": lưới thumbnail, MỚI NHẤT ở trên cùng, bấm "Tải thêm ảnh cũ hơn"
 *     ở cuối để nạp tiếp về quá khứ (xem GET .../media, tham số before_ts).
 *   - "viewer": toàn màn hình, xem 1 ảnh phóng to — chuột KÉO NGANG (hoặc phím
 *     mũi tên trái/phải) để chuyển ảnh trước/sau, dò tới gần đầu danh sách đã
 *     tải thì tự nạp thêm ảnh cũ hơn (infinite-back), không phải đợi bấm nút.
 *
 * Dữ liệu load 1 LẦN/hội thoại (cache trong `loadedForRef`, sống theo vòng
 * đời modal — component unmount khi đổi hội thoại vì `key` ở nơi gọi) — mở
 * lại gallery của CÙNG hội thoại trong cùng phiên xem không phải gọi lại API.
 */

import { ChevronLeft, ChevronRight, Download, ImageOff, LayoutGrid, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type GalleryImage = {
  message_id: string;
  url: string;
  thumb_url?: string | null;
  width?: number;
  height?: number;
  ts: number;
  sender_name?: string | null;
  is_sent: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  accountId: string;
  conversationName?: string | null;
  /** message_id ảnh vừa bấm trong khung chat — có thì mở thẳng trình xem toàn
   *  màn hình tại đúng ảnh đó, không có (bấm từ nút "Xem ảnh" ở header) thì
   *  mở lưới thumbnail. */
  initialMessageId?: string | null;
};

const INITIAL_LIMIT = 260;
const PAGE_LIMIT = 200;
/** Kéo ngang bao nhiêu px thì tính là "muốn chuyển ảnh" trong trình xem toàn
 *  màn hình — cùng cơ chế với REPLY_DRAG_THRESHOLD ở ZaloChatPanel.tsx. */
const SWIPE_THRESHOLD = 90;
/** Còn cách đầu danh sách đã tải bao nhiêu ảnh thì tự nạp thêm ảnh cũ hơn khi
 *  đang kéo lùi trong trình xem — tránh người dùng kéo tới ảnh đầu tiên rồi
 *  phải chờ loading mới kéo tiếp được. */
const PRELOAD_BACK_THRESHOLD = 5;

function formatDateTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Ảnh có onError: URL CDN Zalo hết hạn thì hiện placeholder thay vì ô vỡ. */
function ViewerImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <div className="flex max-h-[78vh] w-full max-w-[92vw] flex-col items-center justify-center gap-2 py-24 text-white/70">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">Ảnh đã hết hạn, không xem lại được nữa</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailed(true)}
      className="max-h-[78vh] max-w-[92vw] select-none rounded-sm object-contain"
    />
  );
}

export function MediaGalleryModal({ open, onClose, conversationId, accountId, conversationName, initialMessageId }: Props) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeTs, setNextBeforeTs] = useState<number | null>(null);
  const [mode, setMode] = useState<"grid" | "viewer">("grid");
  const [viewerIndex, setViewerIndex] = useState(0);
  const loadedForRef = useRef<string | null>(null);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const nextBeforeTsRef = useRef(nextBeforeTs);
  nextBeforeTsRef.current = nextBeforeTs;
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (beforeTs?: number | null): Promise<{ images: GalleryImage[]; has_more: boolean; next_before_ts: number | null }> => {
      const qs = new URLSearchParams({ account_id: accountId, limit: String(beforeTs ? PAGE_LIMIT : INITIAL_LIMIT) });
      if (beforeTs != null) qs.set("before_ts", String(beforeTs));
      const res = await fetch(`/api/zalo/conversations/${encodeURIComponent(conversationId)}/media?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      return {
        images: Array.isArray(data?.images) ? data.images : [],
        has_more: !!data?.has_more,
        next_before_ts: data?.next_before_ts ?? null,
      };
    },
    [conversationId, accountId]
  );

  // Nạp thêm ảnh CŨ HƠN, chèn vào ĐẦU mảng (thứ tự cũ→mới) — nếu đang ở chế
  // độ viewer, phải cộng dồn viewerIndex đúng bằng số ảnh vừa chèn thêm vào
  // trước nó, nếu không "ảnh đang xem" sẽ nhảy lung tung sau khi mảng dịch.
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || nextBeforeTsRef.current == null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBeforeTsRef.current);
      if (page.images.length > 0) {
        setImages((prev) => [...page.images, ...prev]);
        setViewerIndex((i) => i + page.images.length);
      }
      setHasMore(page.has_more);
      setNextBeforeTs(page.next_before_ts);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (!open) return;
    if (loadedForRef.current === conversationId) {
      // Đã tải cho hội thoại này trong phiên hiện tại — chỉ cần đặt lại chế độ.
      if (initialMessageId) {
        const idx = imagesRef.current.findIndex((im) => im.message_id === initialMessageId);
        setViewerIndex(idx >= 0 ? idx : Math.max(imagesRef.current.length - 1, 0));
        setMode("viewer");
      } else {
        setMode("grid");
      }
      return;
    }
    loadedForRef.current = conversationId;
    let cancelled = false;
    setLoading(true);
    setImages([]);
    void (async () => {
      let page = await fetchPage(null);
      // Ảnh vừa bấm trong chat thường nằm trong lô đầu (chat cũng chỉ hiện tối
      // đa 200 tin gần nhất) — nếu vẫn chưa thấy, thử nạp thêm ĐÚNG 1 lô nữa
      // rồi thôi (đủ bao quát mọi trường hợp thực tế, tránh vòng lặp không
      // điểm dừng cho 1 message_id không tồn tại/đã bị xoá).
      if (initialMessageId && !page.images.some((im) => im.message_id === initialMessageId) && page.has_more && page.next_before_ts != null) {
        const extra = await fetchPage(page.next_before_ts);
        page = { images: [...extra.images, ...page.images], has_more: extra.has_more, next_before_ts: extra.next_before_ts };
      }
      if (cancelled) return;
      setImages(page.images);
      setHasMore(page.has_more);
      setNextBeforeTs(page.next_before_ts);
      if (initialMessageId) {
        const idx = page.images.findIndex((im) => im.message_id === initialMessageId);
        setViewerIndex(idx >= 0 ? idx : Math.max(page.images.length - 1, 0));
        setMode("viewer");
      } else {
        setMode("grid");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId, initialMessageId]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= images.length) return;
      setViewerIndex(index);
      if (index < PRELOAD_BACK_THRESHOLD) void loadMore();
    },
    [images.length, loadMore]
  );

  // ── Kéo ngang để chuyển ảnh (viewer) ─────────────────────────────────────
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "touch" && e.pointerType !== "pen") return;
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setDragX(e.clientX - dragStartXRef.current);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragX((current) => {
      if (current <= -SWIPE_THRESHOLD) goTo(viewerIndex + 1);
      else if (current >= SWIPE_THRESHOLD) goTo(viewerIndex - 1);
      return 0;
    });
  };

  useEffect(() => {
    if (!open || mode !== "viewer") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goTo(viewerIndex - 1);
      else if (e.key === "ArrowRight") goTo(viewerIndex + 1);
      else if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, mode, viewerIndex, goTo, onClose]);

  const gridImages = useMemo(() => images.slice().reverse(), [images]); // mới → cũ để hiện lưới

  if (!open) return null;

  const current = images[viewerIndex];

  // Portal thẳng ra document.body — KHÔNG render tại chỗ trong cây component.
  // `position: fixed` chỉ phủ đúng toàn viewport khi KHÔNG có ancestor nào
  // (transform/filter/contain/will-change, hoặc 1 stacking context lạ nào đó
  // của layout dashboard) "nhốt" nó lại — thực tế đã gặp đúng bug này (báo lỗi
  // 2026-09-27: modal chỉ phủ tối vùng nội dung chính, lộ nguyên sidebar +
  // header phía trên). Portal ra body là cách chuẩn (mọi thư viện modal thật
  // đều làm vậy) để không phải truy lùng từng ancestor mỗi khi đổi layout.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2">
          {mode === "viewer" ? (
            <button type="button" onClick={() => setMode("grid")} title="Xem dạng lưới" className="rounded-full p-1.5 transition hover:bg-white/10">
              <LayoutGrid className="h-4.5 w-4.5" />
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{conversationName || "Ảnh đã chia sẻ"}</div>
            {mode === "viewer" && images.length > 0 ? (
              <div className="text-[11px] text-white/60">
                {viewerIndex + 1}/{images.length}
                {hasMore ? "+" : ""} · {formatDateTime(current?.ts || 0)}
              </div>
            ) : (
              <div className="text-[11px] text-white/60">{loading ? "Đang tải..." : `${images.length} ảnh${hasMore ? "+" : ""}`}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {mode === "viewer" && current?.url ? (
            <a
              href={`/api/download?url=${encodeURIComponent(current.url)}&filename=${encodeURIComponent(`zalo_image_${current.message_id || Date.now()}.jpg`)}`}
              download={`zalo_image_${current.message_id || Date.now()}.jpg`}
              title="Tải ảnh gốc"
              className="rounded-full p-1.5 text-white transition hover:bg-white/10"
            >
              <Download className="h-4.5 w-4.5" />
            </a>
          ) : null}
          <button type="button" onClick={onClose} title="Đóng" className="rounded-full p-1.5 text-white transition hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loading && images.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-white/70">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Đang tải ảnh...
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-white/70">Hội thoại này chưa có ảnh nào.</div>
      ) : mode === "grid" ? (
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
            {gridImages.map((im, i) => (
              <button
                key={`${im.message_id}-${i}`}
                type="button"
                onClick={() => {
                  const realIdx = images.length - 1 - i;
                  setViewerIndex(realIdx);
                  setMode("viewer");
                  if (realIdx < PRELOAD_BACK_THRESHOLD) void loadMore();
                }}
                className="aspect-square overflow-hidden rounded-sm bg-white/5 transition hover:opacity-80"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.thumb_url || im.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          {hasMore ? (
            <div className="flex justify-center py-4">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}
                Tải thêm ảnh cũ hơn
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
          <button
            type="button"
            onClick={() => goTo(viewerIndex - 1)}
            disabled={viewerIndex <= 0 && !hasMore}
            title="Ảnh trước"
            className="absolute left-2 z-10 hidden rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 disabled:opacity-30 sm:grid sm:place-items-center"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex cursor-grab touch-pan-y items-center justify-center active:cursor-grabbing"
            style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: draggingRef.current ? "none" : "transform 0.18s ease" }}
          >
            {current?.url ? <ViewerImage src={current.url} alt="" /> : null}
          </div>

          {loadingMore && viewerIndex < PRELOAD_BACK_THRESHOLD ? (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Đang tải ảnh cũ hơn...
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => goTo(viewerIndex + 1)}
            disabled={viewerIndex >= images.length - 1}
            title="Ảnh sau"
            className="absolute right-2 z-10 hidden rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 disabled:opacity-30 sm:grid sm:place-items-center"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
