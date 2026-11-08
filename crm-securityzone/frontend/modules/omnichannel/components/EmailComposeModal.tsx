"use client";

import React, { useState, useRef } from "react";
import { X, Send, Paperclip, Loader2, Mail } from "lucide-react";
import { omnichannelRepository } from "../repositories/OmnichannelRepository";
import type { OutgoingEmailAttachment, ConversationItem, ChannelAccount } from "../types";

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderEmail?: string;
  senderName?: string;
  accounts?: ChannelAccount[];
  onSuccess: (newConv: ConversationItem) => void;
}

export const EmailComposeModal: React.FC<EmailComposeModalProps> = ({
  isOpen,
  onClose,
  senderEmail,
  senderName,
  accounts,
  onSuccess,
}) => {
  const emailAccounts = (accounts || []).filter((a) => a.channel === "email");
  const [selectedFromEmail, setSelectedFromEmail] = useState<string>(
    senderEmail || emailAccounts[0]?.email || ""
  );
  const [recipient, setRecipient] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [ccInput, setCcInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<OutgoingEmailAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedFromEmail if props change
  React.useEffect(() => {
    if (senderEmail) {
      setSelectedFromEmail(senderEmail);
    } else if (emailAccounts.length > 0 && !selectedFromEmail) {
      setSelectedFromEmail(emailAccounts[0].email || "");
    }
  }, [senderEmail, emailAccounts]);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    const maxFileBytes = 20 * 1024 * 1024;
    const maxMessageBytes = 25 * 1024 * 1024;
    const existingBytes = attachments.reduce((sum, item) => sum + item.size_bytes, 0);

    if (files.some((f) => f.size > maxFileBytes) || existingBytes + files.reduce((s, f) => s + f.size, 0) > maxMessageBytes) {
      setError("File đính kèm vượt quá giới hạn 20 MB/file hoặc 25 MB/email.");
      return;
    }

    try {
      const encoded = await Promise.all(
        files.map(async (file): Promise<OutgoingEmailAttachment> => {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          const contentType = file.type || "application/octet-stream";
          return {
            name: file.name,
            size:
              file.size >= 1024 * 1024
                ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.max(1, Math.round(file.size / 1024))} KB`,
            type: contentType === "application/pdf" ? "pdf" : contentType.startsWith("image/") ? "image" : "file",
            content_type: contentType,
            size_bytes: file.size,
            content_base64: dataUrl.split(",", 2)[1] || "",
          };
        })
      );
      setAttachments((prev) => [...prev, ...encoded]);
      setError(null);
    } catch {
      setError("Không thể đọc file đính kèm.");
    }
  };

  const handleSend = async () => {
    if (!recipient.trim()) {
      setError("Vui lòng nhập địa chỉ email người nhận.");
      return;
    }
    if (!recipient.includes("@")) {
      setError("Địa chỉ email người nhận không hợp lệ.");
      return;
    }
    if (!subject.trim()) {
      setError("Vui lòng nhập tiêu đề email.");
      return;
    }
    if (!body.trim()) {
      setError("Vui lòng nhập nội dung email.");
      return;
    }

    setLoading(true);
    setError(null);

    const ccList = ccInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"));

    const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await omnichannelRepository.composeEmail({
      recipient_email: recipient.trim().toLowerCase(),
      cc_emails: ccList.length > 0 ? ccList : undefined,
      subject: subject.trim(),
      text: body.trim(),
      from_email: selectedFromEmail || undefined,
      idempotency_key: idempotencyKey,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    setLoading(false);

    if (result.ok && result.conversation) {
      onSuccess(result.conversation);
      onClose();
    } else {
      setError(result.error || "Không thể gửi email. Vui lòng thử lại.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4 select-none font-sans">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-[var(--color-markee-primary,#c2185b)]">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">Soạn thư mới</h3>
              <p className="text-[10px] text-slate-500">
                Gửi từ:{" "}
                <span className="font-semibold text-slate-700">
                  {selectedFromEmail || (senderName ? `${senderName} <${senderEmail}>` : senderEmail || "Hộp thư hệ thống")}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex flex-col p-4 space-y-3">
          {emailAccounts.length > 1 && (
            <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5 text-xs">
              <span className="w-16 font-semibold text-slate-500 shrink-0">Từ (From):</span>
              <select
                value={selectedFromEmail}
                onChange={(e) => setSelectedFromEmail(e.target.value)}
                className="flex-1 bg-transparent text-slate-800 font-medium focus:outline-none cursor-pointer"
              >
                {emailAccounts.map((acc) => (
                  <option key={acc.id} value={acc.email || ""}>
                    {acc.email || acc.name} {acc.isDefault ? "(Mặc định)" : ""} {acc.providerType === "google_oauth" ? "[Gmail]" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          {/* Recipient To */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5 text-xs">
            <span className="w-16 font-semibold text-slate-500 shrink-0">Đến:</span>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="nguoinhan@domain.com"
              className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none"
              autoFocus
            />
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Cc
              </button>
            )}
          </div>

          {/* CC field */}
          {showCc && (
            <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5 text-xs animate-in fade-in duration-100">
              <span className="w-16 font-semibold text-slate-500 shrink-0">Cc:</span>
              <input
                type="text"
                value={ccInput}
                onChange={(e) => setCcInput(e.target.value)}
                placeholder="email1@domain.com, email2@domain.com"
                className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none"
              />
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5 text-xs">
            <span className="w-16 font-semibold text-slate-500 shrink-0">Tiêu đề:</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Tiêu đề email..."
              className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none font-medium"
            />
          </div>

          {/* Attachments List */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                >
                  <span className="truncate max-w-[200px] font-medium">{att.name}</span>
                  <span className="text-[10px] text-slate-400">({att.size})</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-1 text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Body Textarea */}
          <div className="pt-1">
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Soạn nội dung thư..."
              className="w-full resize-none rounded-xl border border-slate-200 p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none leading-relaxed"
            />
          </div>

          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-4 py-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <Paperclip className="h-3.5 w-3.5 text-slate-500" />
            <span>Đính kèm file</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || !recipient.trim() || !subject.trim() || !body.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#a3134c] transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang gửi...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Gửi thư</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
