"use client";

/**
 * Render đính kèm của 1 tin nhắn Zalo theo ĐÚNG LOẠI.
 *
 * ── Bug đang sửa (2026-09-12) ──────────────────────────────────────────────
 * Trước đây bong bóng chat chỉ biết `msg.image_urls` và render tất cả bằng
 * <img>. Mà cột đó được bridge lấp bằng "mọi field url-ish của content", nên:
 *   - tin chia sẻ LINK  → `href` (trang web) hiện thành ẢNH VỠ, mất tiêu đề/mô tả
 *   - tin VIDEO         → `href` (.mp4) hiện thành ẢNH VỠ, không xem được
 *   - tin FILE / THOẠI  → y hệt
 *   - tin NHÃN DÁN      → bong bóng rỗng
 * Giờ API trả `attachments[{kind,...}]` đã chuẩn hoá (src/lib/zaloMessageContent.ts),
 * mỗi kind có 1 component riêng bên dưới.
 *
 * Nguyên tắc: MỌI media đều phát/xem ngay trong khung chat (video có thẻ
 * <video controls>, thoại có <audio controls>) — không bắt người dùng mở tab
 * mới rồi tự tải file về.
 */

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  Play,
  QrCode,
  Smile,
  User,
} from "lucide-react";
import {
  formatBytes,
  formatDuration,
  type ZaloAttachment,
  type ZaloMessageKind,
} from "@/lib/zaloMessageContent";

type Props = {
  attachments: ZaloAttachment[];
  kind?: ZaloMessageKind;
  /** Bong bóng của mình (nền xanh) — đổi màu chữ/viền cho đọc được. */
  mine?: boolean;
  /** Bấm nút "Nhắn tin" trên danh thiếp (yêu cầu người dùng 2026-09-18: danh
   *  thiếp có SĐT thì cho nhắn tin thẳng với người đó) — chỉ hiện khi
   *  `a.phone` có giá trị, xem ContactBubble. */
  onContactMessage?: (a: ZaloAttachment) => void;
  /** Nhãn cụ thể hơn cho tin `kind === "unknown"` (thẻ "zinstant" — vd danh
   *  thiếp ngân hàng) — thay cho "Tin nhắn dạng đặc biệt" chung chung khi có.
   *  Xem zinstantFallbackLabel() ở zaloMessageContent.ts. */
  unknownLabel?: string | null;
  /** Gọi khi 1 ảnh/video trong đính kèm load xong kích thước thật (chỉ ảnh
   *  dùng `max-h-*`/video — sticker/link-thumbnail đã có height CỐ ĐỊNH nên
   *  không gây lệch layout, không cần báo). Cha (ZaloChatPanel) dùng để tự
   *  cuộn lại xuống cuối NẾU đang gần đáy — ảnh/video load xong SAU khi cuộn
   *  ban đầu (chưa biết kích thước thật lúc đó) đẩy nội dung cao thêm, khiến
   *  khung chat kẹt lưng chừng dù đã "cuộn xuống cuối" trước đó (báo lỗi
   *  2026-09-23: "toàn load ở lưng chừng hội thoại"). */
  onMediaLoad?: () => void;
  /** Bấm vào 1 ẢNH (không áp dụng video/file/link/...) — mở trình xem toàn
   *  màn hình kéo-ngang qua TOÀN BỘ ảnh của hội thoại (MediaGalleryModal),
   *  THAY CHO mở tab mới như trước (yêu cầu người dùng 2026-09-26: "xem ảnh
   *  từ trước đến nay trong hội thoại như zalo"). undefined = giữ hành vi cũ
   *  (mở ảnh gốc ở tab mới) — an toàn khi parent chưa kịp truyền. */
  onOpenGallery?: () => void;
};

/** Ảnh có onError: URL CDN Zalo hết hạn thì hiện placeholder, không để icon vỡ. */
function SafeImage({ src, alt, className, onLoad }: { src: string; alt: string; className: string; onLoad?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`grid place-items-center bg-[#eef1f5] text-[#8a9aa8] ${className}`}>
        <ImageIcon className="h-6 w-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} onLoad={onLoad} className={className} />
  );
}

function ImageGrid({ items, onLoad, onOpenGallery }: { items: ZaloAttachment[]; onLoad?: () => void; onOpenGallery?: () => void }) {
  const urls = items.map((a) => a.url).filter((u): u is string => !!u);
  if (urls.length === 0) return null;
  return (
    <div className={`grid gap-1 ${urls.length > 1 ? "grid-cols-2" : ""}`}>
      {urls.map((url, i) =>
        onOpenGallery ? (
          <button key={i} type="button" onClick={onOpenGallery} className="block text-left">
            <SafeImage
              src={url}
              alt={`Ảnh ${i + 1}`}
              onLoad={onLoad}
              className="max-h-56 max-w-full rounded-lg object-cover transition hover:opacity-90"
            />
          </button>
        ) : (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
            <SafeImage
              src={url}
              alt={`Ảnh ${i + 1}`}
              onLoad={onLoad}
              className="max-h-56 max-w-full rounded-lg object-cover transition hover:opacity-90"
            />
          </a>
        )
      )}
    </div>
  );
}

/**
 * Video phát NGAY trong khung chat.
 *
 * `preload="metadata"` để không tải cả clip khi mở hội thoại (nhóm nhiều video
 * sẽ ngốn băng thông), nhưng vẫn lấy được khung hình đầu + thời lượng.
 * `poster` dùng thumbnail Zalo gửi kèm nếu có.
 *
 * HLS (.m3u8): Chrome/Firefox không phát natively → hiện nút mở ngoài thay vì
 * player câm. Safari phát được nên vẫn để player ở đó.
 */
function VideoBubble({ a, onLoad }: { a: ZaloAttachment; onLoad?: () => void }) {
  const [broken, setBroken] = useState(false);
  if (!a.url) return null;
  const isHls = /\.m3u8(\?|#|$)/i.test(a.url);
  const duration = formatDuration(a.duration_ms);

  if (broken || (isHls && typeof navigator !== "undefined" && !/safari/i.test(navigator.userAgent))) {
    return (
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-lg border border-[#dce1e8] bg-white/95 p-2.5 text-[#0a1a2b] transition hover:bg-[#f1f4f8]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0068ff] text-white">
          <Play className="h-4 w-4 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{a.title || "Video"}</span>
          <span className="block text-[11px] text-[#6b7a8d]">
            {[duration, formatBytes(a.size_bytes), "Mở để xem"].filter(Boolean).join(" · ")}
          </span>
        </span>
      </a>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <video
        src={a.url}
        poster={a.thumb_url}
        controls
        playsInline
        preload="metadata"
        onError={() => setBroken(true)}
        onLoadedMetadata={onLoad}
        className="max-h-72 w-full max-w-[320px] bg-black"
      />
      {(a.title || duration) && (
        <div className="flex items-center justify-between gap-2 bg-black/80 px-2 py-1 text-[11px] text-white/90">
          <span className="truncate">{a.title || "Video"}</span>
          {duration ? <span className="shrink-0 tabular-nums">{duration}</span> : null}
        </div>
      )}
    </div>
  );
}

/** Tin nhắn thoại — nghe thẳng trong bong bóng, không phải tải file .m4a. */
function VoiceBubble({ a }: { a: ZaloAttachment }) {
  if (!a.url) return null;
  const duration = formatDuration(a.duration_ms);
  return (
    <div className="min-w-[220px] rounded-lg bg-white/95 p-2">
      <audio src={a.url} controls preload="metadata" className="w-full max-w-[260px]" />
      {duration ? <div className="mt-0.5 px-1 text-[11px] text-[#6b7a8d]">Tin nhắn thoại · {duration}</div> : null}
    </div>
  );
}

const FILE_ICON_BY_EXT: Record<string, typeof FileIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  zip: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
};

function buildDownloadProxyUrl(url: string, filename?: string): string {
  if (!url) return "";
  const name = filename || "attachment";
  return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(name)}`;
}

function FileBubble({ a }: { a: ZaloAttachment }) {
  if (!a.url) return null;
  const Icon = (a.ext && FILE_ICON_BY_EXT[a.ext]) || FileIcon;
  const meta = [a.ext?.toUpperCase(), formatBytes(a.size_bytes)].filter(Boolean).join(" · ");
  const downloadUrl = buildDownloadProxyUrl(a.url, a.name);

  return (
    <a
      href={downloadUrl}
      download={a.name || undefined}
      className="flex min-w-[220px] max-w-[300px] items-center gap-2.5 rounded-lg border border-[#dce1e8] bg-white/95 p-2.5 text-[#0a1a2b] transition hover:bg-[#f1f4f8]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e8f0ff] text-[#0068ff]">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name || "Tệp đính kèm"}</span>
        {meta ? <span className="block text-[11px] text-[#6b7a8d]">{meta}</span> : null}
      </span>
      <Download className="h-4 w-4 shrink-0 text-[#8a9aa8]" />
    </a>
  );
}

/**
 * Thẻ xem trước LINK — đúng thứ trước đây bị render nhầm thành <img>.
 * Ảnh thumbnail chỉ là MINH HOẠ cho link, không phải nội dung tin nhắn, nên
 * nằm trong thẻ và có thể vắng mặt mà thẻ vẫn đọc được.
 */
function LinkBubble({ a }: { a: ZaloAttachment }) {
  if (!a.url) return null;
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block max-w-[300px] overflow-hidden rounded-lg border border-[#dce1e8] bg-white/95 transition hover:bg-[#f1f4f8]"
    >
      {a.thumb_url ? (
        <SafeImage src={a.thumb_url} alt={a.title || "Xem trước liên kết"} className="h-32 w-full object-cover" />
      ) : null}
      <div className="p-2.5">
        <div className="flex items-center gap-1 text-[11px] text-[#6b7a8d]">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{a.domain || a.url}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold text-[#0a1a2b]">{a.title || a.url}</div>
        {a.description ? (
          <div className="mt-0.5 line-clamp-2 text-[12px] text-[#6b7a8d]">{a.description}</div>
        ) : null}
      </div>
    </a>
  );
}

/**
 * Nhãn dán. URL ảnh được bridge resolve qua api.getStickersDetail (tin mới lúc
 * persist, tin cũ khi API /api/zalo/messages đọc lên) — nếu Zalo không trả về
 * được thì hiện placeholder có id thay vì bong bóng trống.
 */
function StickerBubble({ a }: { a: ZaloAttachment }) {
  if (a.url) {
    return <SafeImage src={a.url} alt="Nhãn dán" className="h-28 w-28 object-contain" />;
  }
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-2 text-[12px] text-[#6b7a8d]">
      <Smile className="h-4 w-4 text-[#f59e0b]" />
      Nhãn dán{a.sticker_id ? ` #${a.sticker_id}` : ""}
    </div>
  );
}

function LocationBubble({ a }: { a: ZaloAttachment }) {
  const href = a.url || (a.lat != null && a.lon != null ? `https://www.google.com/maps?q=${a.lat},${a.lon}` : null);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-[200px] max-w-[300px] items-center gap-2.5 rounded-lg border border-[#dce1e8] bg-white/95 p-2.5 text-[#0a1a2b] transition hover:bg-[#f1f4f8]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#ffe9e9] text-[#e3000f]">
        <MapPin className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{a.title || "Vị trí được chia sẻ"}</span>
        <span className="block truncate text-[11px] text-[#6b7a8d]">
          {a.address || (a.lat != null && a.lon != null ? `${a.lat}, ${a.lon}` : "Mở bản đồ")}
        </span>
      </span>
    </a>
  );
}

function ContactAvatar({ src, name }: { src?: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name?.trim() ? name.trim().charAt(0).toUpperCase() : "";

  if (!src || failed) {
    return (
      <div className="grid h-full w-full place-items-center bg-[#e2e8f0] text-[#334155] font-bold text-sm select-none">
        {initial ? <span>{initial}</span> : <User className="h-4 w-4 text-[#64748b]" />}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || "Danh thiếp"}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function ContactBubble({ a, onContactMessage }: { a: ZaloAttachment; onContactMessage?: (a: ZaloAttachment) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopyPhone = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!a.phone) return;
    navigator.clipboard.writeText(a.phone.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const phone = a.phone?.trim();
  const name = a.name?.trim() || "Danh thiếp";

  return (
    <div className="min-w-[220px] max-w-[290px] rounded-xl border border-[#dce1e8] bg-white/95 p-2.5 text-[#0a1a2b] shadow-xs transition hover:border-[#b8c7db] hover:shadow-sm">
      {/* Thông tin liên hệ: Avatar + Tên + Số điện thoại kèm nút Copy */}
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#dce1e8] text-[#2f3e50] ring-1 ring-slate-200">
          <ContactAvatar src={a.avatar_url} name={name} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-[#0f172a]" title={name}>
            {name}
          </div>
          {phone ? (
            <div className="mt-0.5 flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyPhone}
                className="group inline-flex items-center gap-1 rounded px-1 -ml-1 py-0.5 text-left text-[12.5px] font-medium text-[#0068ff] transition hover:bg-[#eef4ff] active:bg-[#dbeafe]"
                title="Bấm để sao chép số điện thoại"
              >
                <span className="font-mono tracking-tight font-semibold">{phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                ) : (
                  <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100 shrink-0 transition" />
                )}
              </button>
              {copied && (
                <span className="text-[10.5px] font-medium text-emerald-600 animate-fade-in">
                  Đã chép!
                </span>
              )}
            </div>
          ) : (
            <div className="text-[11.5px] text-[#6b7a8d]">Danh thiếp Zalo</div>
          )}
        </div>
      </div>

      {/* Nút hành động Nhắn tin / Xem trang */}
      {(phone && onContactMessage) || a.url ? (
        <div className="mt-2.5 pt-2 border-t border-[#edf2f7]">
          {phone && onContactMessage ? (
            <button
              type="button"
              onClick={() => onContactMessage(a)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-1.5 text-[12px] font-semibold text-[#0068ff] transition hover:bg-[#eff6ff] hover:border-[#bfdbfe] active:bg-[#dbeafe]"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Nhắn tin
            </button>
          ) : a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-1.5 text-[12px] font-semibold text-[#0068ff] transition hover:bg-[#eff6ff] hover:border-[#bfdbfe]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Xem trang Zalo
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type BankcardParsed = {
  bank_name?: string;
  account_number?: string;
  logo_url?: string;
  bg_url?: string;
  qr_url?: string;
  bin?: string;
};

const BANKCARD_CACHE = new Map<string, BankcardParsed>();

function extractFromHtml(html: string): BankcardParsed {
  const clean = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const texts: string[] = [];
  const textMatches = clean.matchAll(/>([^<]+)</g);
  for (const m of textMatches) {
    const t = m[1].trim();
    if (t) texts.push(t);
  }

  const urls: string[] = [];
  const urlMatches = html.matchAll(/url\((.*?)\)/g);
  for (const m of urlMatches) {
    urls.push(m[1].trim().replace(/^['"]|['"]$/g, ""));
  }

  const logo_url = urls.find((u) => u.includes("LOGO"));
  const bg_url = urls.find((u) => u.includes("BG"));
  const qr_url = urls.find((u) => u.includes("group-qr") || u.toLowerCase().includes("qr"));

  const bin_code = texts[0] && /^\d+$/.test(texts[0]) ? texts[0] : undefined;
  const bank_name = texts[1] || texts.find((t) => /ngân\s*hàng|bank/i.test(t));
  let account_number = texts[2] && /^[0-9A-Za-z]+$/.test(texts[2]) ? texts[2] : undefined;

  if (!account_number) {
    for (const t of texts) {
      if (/^\d{6,20}$/.test(t) && t !== bin_code) {
        account_number = t;
        break;
      }
    }
  }

  return {
    bin: bin_code,
    bank_name,
    account_number,
    logo_url,
    bg_url,
    qr_url,
  };
}

function BankcardBubble({ a, mine, onOpenGallery }: { a: ZaloAttachment; mine?: boolean; onOpenGallery?: (url: string) => void }) {
  const [data, setData] = useState<BankcardParsed>(() => {
    if (a.account_number || a.bank_name) {
      return {
        bank_name: a.bank_name,
        account_number: a.account_number,
        logo_url: a.logo_url,
        bg_url: a.bg_url,
        qr_url: a.qr_url,
        bin: a.bin,
      };
    }
    const dataUrl = a.data_url || a.url;
    if (dataUrl && BANKCARD_CACHE.has(dataUrl)) {
      return BANKCARD_CACHE.get(dataUrl)!;
    }
    return {};
  });

  const [loading, setLoading] = useState<boolean>(() => {
    const dataUrl = a.data_url || a.url;
    return !a.account_number && !!dataUrl && !BANKCARD_CACHE.has(dataUrl);
  });

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dataUrl = a.data_url || a.url;
    if (!dataUrl || a.account_number || BANKCARD_CACHE.has(dataUrl)) return;

    let active = true;
    fetch(dataUrl)
      .then((res) => res.text())
      .then((html) => {
        if (!active) return;
        const parsed = extractFromHtml(html);
        BANKCARD_CACHE.set(dataUrl, parsed);
        setData(parsed);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [a.data_url, a.url, a.account_number]);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const num = data.account_number || a.account_number;
    if (!num) return;
    try {
      await navigator.clipboard.writeText(num.replace(/\D/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const bankName = data.bank_name || a.bank_name;
  const accNum = data.account_number || a.account_number;
  const qrUrl = data.qr_url || a.qr_url;
  const logoUrl = data.logo_url || a.logo_url;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs opacity-75 animate-pulse">
        <CreditCard className="h-4 w-4 shrink-0" />
        <span>Đang nạp số tài khoản...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      {/* Tên ngân hàng + Logo nếu có */}
      {bankName && (
        <div className="flex items-center gap-1.5 text-xs font-semibold opacity-90">
          {logoUrl ? (
            <img src={logoUrl} alt={bankName} className="h-4 w-4 rounded object-contain bg-white shrink-0 shadow-2xs" />
          ) : (
            <CreditCard className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{bankName}</span>
        </div>
      )}

      {/* Dãy số tài khoản như tin nhắn bình thường + Nút Copy */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`font-mono text-[15px] font-bold tracking-wider select-all ${
            mine ? "text-white" : "text-[#0068ff]"
          }`}
        >
          {accNum || "Tài khoản ngân hàng"}
        </span>

        {accNum && (
          <button
            type="button"
            onClick={handleCopy}
            title="Sao chép số tài khoản"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition active:scale-95 ${
              mine
                ? "bg-white/20 hover:bg-white/30 text-white"
                : "bg-blue-50 hover:bg-blue-100 text-[#0068ff] border border-blue-200/80"
            }`}
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? "Đã chép" : "Sao chép"}</span>
          </button>
        )}
      </div>

      {/* Mã VietQR nhỏ gọn nếu có */}
      {qrUrl && (
        <div className="pt-1">
          <img
            src={qrUrl}
            alt="Mã QR Chuyển khoản"
            className="h-28 w-28 rounded-lg border border-slate-200 bg-white p-1 cursor-pointer hover:shadow-md transition"
            onClick={() => (onOpenGallery ? onOpenGallery(qrUrl) : window.open(qrUrl, "_blank"))}
            title="Bấm để phóng to mã QR"
          />
        </div>
      )}
    </div>
  );
}

export function MessageAttachments({ attachments, kind, mine, onContactMessage, unknownLabel, onMediaLoad, onOpenGallery }: Props) {
  // Không có đính kèm nào dựng được nhưng loại tin lại KHÔNG phải text → hiện
  // nhãn loại, để người dùng biết "có gì đó được gửi" thay vì bong bóng trống.
  if (!attachments || attachments.length === 0) {
    if (!kind || kind === "text") return null;
    if (kind === "bankcard" || (unknownLabel && /tài khoản ngân hàng|bank account/i.test(unknownLabel))) {
      return (
        <div className="flex items-center gap-1.5 py-1 text-sm font-medium">
          <CreditCard className="h-4 w-4 text-[#0068ff]" />
          <span>Tài khoản ngân hàng</span>
        </div>
      );
    }
    return (
      <div className={`text-[12px] italic ${mine ? "text-white/80" : "text-[#8a9aa8]"}`}>
        {unknownLabel ? `${unknownLabel} — mở Zalo để xem` : `Tin nhắn dạng ${KIND_TEXT[kind] || "không hỗ trợ"} — mở Zalo để xem`}
      </div>
    );
  }

  // Ảnh gộp thành lưới (album Zalo), các loại khác xếp dọc từng thẻ.
  const images = attachments.filter((a) => a.kind === "image" || a.kind === "gif");
  const others = attachments.filter((a) => a.kind !== "image" && a.kind !== "gif");

  return (
    <div className="flex flex-col gap-1.5">
      {images.length > 0 ? <ImageGrid items={images} onLoad={onMediaLoad} onOpenGallery={onOpenGallery} /> : null}
      {others.map((a, i) => {
        switch (a.kind) {
          case "video":
            return <VideoBubble key={i} a={a} onLoad={onMediaLoad} />;
          case "voice":
            return <VoiceBubble key={i} a={a} />;
          case "file":
            return <FileBubble key={i} a={a} />;
          case "link":
            return <LinkBubble key={i} a={a} />;
          case "sticker":
            return <StickerBubble key={i} a={a} />;
          case "location":
            return <LocationBubble key={i} a={a} />;
          case "contact":
            return <ContactBubble key={i} a={a} onContactMessage={onContactMessage} />;
          case "bankcard":
            return <BankcardBubble key={i} a={a} mine={mine} onOpenGallery={onOpenGallery} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

const KIND_TEXT: Record<string, string> = {
  image: "hình ảnh",
  gif: "ảnh động",
  video: "video",
  voice: "tin nhắn thoại",
  file: "tệp đính kèm",
  link: "liên kết",
  sticker: "nhãn dán",
  location: "vị trí",
  contact: "danh thiếp",
  bankcard: "tài khoản ngân hàng",
  unknown: "đặc biệt",
};
