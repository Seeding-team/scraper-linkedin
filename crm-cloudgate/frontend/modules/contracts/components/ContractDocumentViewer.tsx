'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchExternalDocumentPreviewPdf } from '../repositories/contractDocs';

/** Nhan dien loi "khong co quyen truy cap" (401/403 tu backend proxy, hoac domain Google Docs/
 * Drive/Sheets/Slides - cac link nay thuong yeu cau dang nhap dung tai khoan duoc chia se) de hien
 * thong bao than thien "tai lieu rieng tu" thay vi nem nguyen van loi ky thuat httpx cho nguoi dung. */
function isPrivateAccessError(error: string, fileUrl: string): boolean {
  const lower = error.toLowerCase();
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return true;
  }
  return /docs\.google\.com|drive\.google\.com|sheets\.google\.com|slides\.google\.com/i.test(fileUrl);
}

/** Xem file hop dong "ghi nhan ngoai" (contract.fileUrl) ngay trong panel chi tiet, khong chi mo
 * tab moi - theo yeu cau sep 2026-10-23 "File hien thi ngay tren web ke ben sidebar phai, co cuon
 * trang, zoom, tai xuong, mo rieng". PDF: proxy qua backend roi <iframe> (trinh duyet tu co
 * cuon/zoom/tai xuong) - KHONG <iframe src={fileUrl}> truc tiep vi domain ngoai co the chan
 * X-Frame-Options/CORS. DOCX: backend convert sang PDF bang dung engine da dung cho cac phien ban
 * luu trong bucket (contract_docx_engine/LibreOffice, xem contract_versions.py) roi xem nhu PDF.
 * Link khong doan duoc dinh dang (vd Google Drive) -> khong co preview, chi con nut "Mo link". */
export function ContractDocumentViewer({ contractId, fileUrl, fileName }: { contractId: string; fileUrl: string; fileName?: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setPdfUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    fetchExternalDocumentPreviewPdf(contractId, fileUrl)
      .then(blob => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không xem trước được tài liệu này.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contractId, fileUrl]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  return (
    <div className="cp-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, minHeight: 'min(85vh, 1100px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, width: '100%' }}>
        <b style={{ fontSize: '0.9rem' }}>{fileName || 'Tài liệu hợp đồng'}</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="cp-btn small" href={fileUrl} download target="_blank" rel="noreferrer">↓ Tải xuống</a>
          <a className="cp-btn small" href={fileUrl} target="_blank" rel="noreferrer">↗ Mở riêng</a>
        </div>
      </div>
      {loading ? (
        <p style={{ fontSize: '0.82rem', color: '#64748b' }}>Đang tải tài liệu để xem trước…</p>
      ) : pdfUrl ? (
        <iframe
          className="cp-pdf"
          title="Xem trước tài liệu hợp đồng"
          src={pdfUrl}
          style={{ flex: 1, minHeight: 'min(85vh, 1100px)', width: '100%', maxWidth: 900, margin: '0 auto', border: '1px solid #e2e8f0', borderRadius: 8 }}
        />
      ) : isPrivateAccessError(error, fileUrl) ? (
        <p style={{ fontSize: '0.82rem', color: '#b45309' }}>
          Link này là tài liệu <b>riêng tư</b> (cần quyền truy cập) — hệ thống không có quyền mở để
          xem trước. Dùng nút &quot;Mở riêng&quot; để tự đăng nhập đúng tài khoản được cấp quyền, hoặc
          yêu cầu quyền truy cập từ chủ sở hữu tài liệu.
        </p>
      ) : (
        <p style={{ fontSize: '0.82rem', color: '#b45309' }}>
          {error || 'Không xem trước được định dạng file này.'} — dùng nút &quot;Mở riêng&quot; để xem trực tiếp.
        </p>
      )}
    </div>
  );
}
