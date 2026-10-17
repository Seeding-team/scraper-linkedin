import { useState } from "react";
import { Avatar } from "@/components/all-platform/telegram/telegram-ui";

export { formatMessageTime } from "@/components/all-platform/telegram/telegram-ui";

/** Avatar có ảnh (Viber gửi kèm URL ảnh đại diện) — lỗi tải ảnh thì quay về chữ cái đầu. */
export function ViberAvatar({ name, url, size = 40 }: { name: string | null | undefined; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        className="rounded-full object-cover shrink-0 bg-muted"
        style={{ width: size, height: size }}
      />
    );
  }
  return <Avatar name={name} size={size} />;
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;

/** Hiển thị text với link bấm được (gửi link qua Viber là use-case chính của sale). */
export function LinkifiedText({ text, outgoing }: { text: string; outgoing: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className={outgoing ? "underline text-white" : "underline text-primary"}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
