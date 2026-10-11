"use client";

/**
 * useDragAutoScroll — auto-scroll container khi user đang kéo-thả HTML5 và đưa
 * chuột vào vùng "edge" (mép trên/dưới container).
 *
 * Bài toán trong CrmKanbanBoard: board có 2 phần (pipeline 7 cột ở đầu trang +
 * terminal 3 ô ở cuối trang). Cột dọc thì không cao bằng nhau — terminal dài
 * hơn pipeline nhiều. Khi user kéo card từ PHẦN 1 xuống PHẦN 2 (vd từ
 * `proposal_sent` xuống `won`/`lost`/`on_hold`) → phải kéo qua viewport
 * dài. Native HTML5 drag không có auto-scroll → dropzone đầu kia "mất" sự
 * kiện drag-over do scroll/re-render.
 *
 * Linear/Trello/Notion giải bằng cách lắng nghe `dragover` global, nếu con
 * trỏ trong vùng proximity (top/bottom ~50px) của **container scrollable** →
 * `requestAnimationFrame` + `scrollBy`. Mình làm tương tự nhưng giới hạn
 * scroll TRONG phạm vi container (không scroll cả window — tránh giật header
 * dashboard). Auto-stop khi không còn drag.
 *
 * Lưu ý quan trọng về HTML5 drag:
 *  - `dragover` phát liên tục (không phải 1 lần như mouseover).
 *  - `pointermove` KHÔNG phát khi đang drag — phải dùng `dragover` làm nguồn.
 *  - Phải gọi `preventDefault()` trên dragover thì drop mới fire đúng chỗ.
 *    Nhưng `preventDefault` ở document-level sẽ chặn mọi drop khác; ta chỉ
 *    scroll khi drag đang active và trong vùng container.
 */

import { useEffect, useRef } from "react";

const EDGE_PX = 64;       // vùng mép — con trỏ trong khoảng này tính từ mép thì kích hoạt scroll
const MAX_SPEED_PX = 18;  // tốc độ scroll tối đa mỗi frame (~1080px/s ở 60fps)
const MIN_SPEED_PX = 4;   // tốc độ tối thiểu khi đã vào vùng edge (tránh giật quá ít)

interface Options {
  /** Khoảng cách từ mép (px) tính là "edge". Mặc định 64px (≈ 1 ô card). */
  edge?: number;
  /** Tốc độ scroll tối đa (px/frame). Mặc định 18. */
  maxSpeed?: number;
  /** Bật/tắt hook. Cho phép parent disable khi không cần (vd user đang chọn modal). */
  enabled?: boolean;
  /**
   * "container" (mặc định) → scroll bằng `containerRef.scrollTop` (cần container
   *  có `overflow-y: auto` + height giới hạn). "window" → scroll bằng
   *  `window.scrollBy` (cho board window-scroll như CrmKanbanBoard: outer không
   *  có scrollbar riêng, trang cuộn theo window).
   *
   * Khi "window": vùng edge tính theo `viewport.height` thay vì
   * `container.getBoundingClientRect()`.
   */
  scrollOn?: "container" | "window";
}

export function useDragAutoScroll<T extends HTMLElement>(
  options: Options = {},
) {
  const {
    edge = EDGE_PX,
    maxSpeed = MAX_SPEED_PX,
    enabled = true,
    scrollOn = "container",
  } = options;

  // Ref tới container (chỉ cần khi scrollOn="container").
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;

    let rafId: number | null = null;
    let dragging = false;
    let pendingSpeed = 0;

    /**
     * Tính tốc độ scroll theo khoảng cách từ con trỏ tới mép.
     * - container mode: tính theo container.getBoundingClientRect().
     * - window mode: tính theo viewport (rect của documentElement).
     */
    function computeScrollSpeed(e: DragEvent): number {
      let topEdge: number;
      let bottomEdge: number;
      if (scrollOn === "window") {
        const vh = window.innerHeight;
        topEdge = edge; // mép trên viewport
        bottomEdge = vh - edge;
      } else if (container) {
        const rect = container.getBoundingClientRect();
        topEdge = rect.top + edge;
        bottomEdge = rect.bottom - edge;
      } else {
        return 0;
      }

      const y = e.clientY;
      // Đã ở sát mép trên → scroll lên
      if (y <= topEdge) {
        const distance = Math.max(0, topEdge - y);
        const t = Math.min(1, distance / edge);
        return -MIN_SPEED_PX - (maxSpeed - MIN_SPEED_PX) * t;
      }
      // Đã ở sát mép dưới → scroll xuống
      if (y >= bottomEdge) {
        const distance = Math.max(0, y - bottomEdge);
        const t = Math.min(1, distance / edge);
        return MIN_SPEED_PX + (maxSpeed - MIN_SPEED_PX) * t;
      }
      return 0;
    }

    function isPointerInRegion(e: DragEvent): boolean {
      // Với window mode → luôn true (window bao trùm).
      if (scrollOn === "window") return true;
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    }

    function tick() {
      if (!dragging) {
        rafId = null;
        return;
      }
      const v = pendingSpeed;
      if (v !== 0) {
        if (scrollOn === "window") {
          window.scrollBy({ top: v, behavior: "auto" });
        } else if (container) {
          container.scrollTop += v;
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    function onDragOver(e: DragEvent) {
      if (!isPointerInRegion(e)) {
        if (dragging) pendingSpeed = 0;
        return;
      }
      if (!dragging) {
        dragging = true;
        if (rafId == null) rafId = requestAnimationFrame(tick);
      }
      pendingSpeed = computeScrollSpeed(e);
      // preventDefault để dropzone vẫn nhận drop dù dragover xảy ra khi đang scroll.
      e.preventDefault();
    }

    function onDragStart() {
      dragging = true;
      pendingSpeed = 0;
      if (rafId == null) rafId = requestAnimationFrame(tick);
    }
    function onDragEnd() {
      dragging = false;
      pendingSpeed = 0;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragover", onDragOver);

    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("dragover", onDragOver);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [edge, maxSpeed, enabled, scrollOn]);

  return containerRef;
}
