'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type AiReviewComparisonRow,
  type AiRiskClause,
  confirmContractAiReview,
  fetchAiReviewHighlightPreviewPdf,
  fetchExternalDocumentPreviewPdf,
  getLatestAiReview,
  retryContractDriveSync,
  runContractAiReviewFull,
} from '../repositories/contractDocs';

const RISK_CATEGORY_LABEL: Record<string, string> = {
  default_acceptance: 'Nghiệm thu mặc định', deadline: 'Thời hạn', penalty_liability: 'Phạt vi phạm/Trách nhiệm',
  renewal_termination: 'Gia hạn/Chấm dứt', warranty_confidentiality: 'Bảo hành/Bảo mật', rights_obligations: 'Quyền & nghĩa vụ',
};
const RISK_SEVERITY_LABEL: Record<string, string> = { warn: 'Cần chú ý', info: 'Lưu ý' };
const RISK_SEVERITY_BG: Record<string, string> = { warn: '#ffe8d1', info: '#e2e8f0' };
const RISK_SEVERITY_TEXT: Record<string, string> = { warn: '#9a3412', info: '#475569' };

/** (2026-10-26/27, Phan B6 — thiet ke lai theo gop y UX "workspace rong, viewer trai 60% + ket
 * qua AI phai 40%, xem truoc Highlight that truoc khi xac nhan"). Tab RIENG, KHONG dung chung
 * logic tab "AI rui ro" cu cua AI Copilot (tranh regression). */

const VERDICT_LABEL: Record<string, string> = {
  match: 'Khớp', mismatch: 'Không khớp', needs_review: 'Cần kiểm tra', insufficient_data: 'Không đủ dữ liệu',
  not_extracted: 'Chưa trích xuất (cần AI thật)',
};
const VERDICT_BG: Record<string, string> = {
  match: '#d9f2d9', mismatch: '#fadbd8', needs_review: '#fff3c4', insufficient_data: '#f1f5f9', not_extracted: '#e2e8f0',
};
const VERDICT_TEXT: Record<string, string> = {
  match: '#166534', mismatch: '#b91c1c', needs_review: '#92400e', insufficient_data: '#64748b', not_extracted: '#475569',
};

function usePdfBlobUrl(): [string | null, boolean, string, (fn: () => Promise<Blob>) => void] {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const objectUrlRef = useRef<string | null>(null);

  function load(fn: () => Promise<Blob>) {
    setLoading(true);
    setError('');
    fn()
      .then(blob => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const next = URL.createObjectURL(blob);
        objectUrlRef.current = next;
        setUrl(next);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Không xem trước được.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);
  return [url, loading, error, load];
}

export function ContractAiReviewPanel({
  contractId, driveSyncStatus, fileUrl, contractNumber, autoRunIfMissing, onAutoRunHandled,
}: {
  contractId: string; driveSyncStatus?: string; fileUrl?: string | null; contractNumber?: string | null;
  /** Mo tu nut "✦ AI Review" o danh sach hop dong (chua tung chay) - tu dong chay AI NGAY lan
   * mo dau tien, khong bat Sale bam them "Chay AI Review" (gop y UX 2026-10-27). CHI ap dung 1
   * LAN duy nhat moi lan mo chi tiet hop dong - xem onAutoRunHandled. */
  autoRunIfMissing?: boolean;
  /** Bao cho component cha biet DA quyet dinh xong (chay hoac khong) - tranh tu dong chay AI
   * lai moi lan component nay remount (vd doi tab roi quay lai) trong cung 1 lan mo hop dong. */
  onAutoRunHandled?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rows, setRows] = useState<AiReviewComparisonRow[] | null>(null);
  const [riskClauses, setRiskClauses] = useState<AiRiskClause[]>([]);
  const [riskClauseMethod, setRiskClauseMethod] = useState<'ai' | 'heuristic_candidate' | undefined>(undefined);
  const [fromCache, setFromCache] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [stale, setStale] = useState(false);
  const [highlightAvailable, setHighlightAvailable] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  const [extractionMethod, setExtractionMethod] = useState<'ai' | 'heuristic' | undefined>(undefined);
  const [locatedCount, setLocatedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [confirmResult, setConfirmResult] = useState<{ fileName: string; driveFileId?: string | null } | null>(null);
  const [view, setView] = useState<'original' | 'highlight'>('original');
  const [activeExcerpt, setActiveExcerpt] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);

  const [pdfUrl, pdfLoading, pdfError, loadPdf] = usePdfBlobUrl();

  function loadOriginal() {
    if (!fileUrl) return;
    loadPdf(() => fetchExternalDocumentPreviewPdf(contractId, fileUrl));
  }

  function loadHighlight(rId: string) {
    loadPdf(() => fetchAiReviewHighlightPreviewPdf(contractId, rId));
  }

  function applyResult(result: Awaited<ReturnType<typeof runContractAiReviewFull>>, opts: { loadPreview: boolean }) {
    setReviewId(result.reviewId || null);
    setRows(result.comparison || []);
    setRiskClauses(result.riskClauses || []);
    setRiskClauseMethod(result.riskClauseMethod);
    setFromCache(Boolean(result.fromCache));
    setConfirmed(Boolean(result.confirmed));
    setStale(Boolean(result.stale));
    setHighlightAvailable(Boolean(result.highlightAvailable));
    setHighlightError(result.highlightError || null);
    setExtractionMethod(result.extractionMethod);
    setLocatedCount(result.highlightLocatedCount || 0);
    setTotalCount(result.highlightTotalCount || 0);
    if (result.confirmed && result.driveFileId) setConfirmResult({ fileName: '', driveFileId: result.driveFileId });
    setJumpPage(null);
    if (!opts.loadPreview) return;
    if (result.highlightAvailable && result.reviewId) {
      setView('highlight');
      loadHighlight(result.reviewId);
    } else {
      setView('original');
      loadOriginal();
    }
  }

  async function runReview() {
    setLoading(true);
    setError('');
    try {
      const result = await runContractAiReviewFull(contractId);
      if (result.status === 'no_file') {
        setError(result.message || 'Hợp đồng chưa có file/link để chạy AI Review.');
        setRows(null);
      } else {
        applyResult(result, { loadPreview: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không chạy được AI Review.');
    } finally {
      setLoading(false);
    }
  }

  // (2026-10-27, fix bug "mat trang thai khi dong/mo lai panel") Lan mo dau tien CHI doc phien
  // da luu (KHONG goi AI) - khoi phuc dung ket qua + Highlight nhap + trang thai xac nhan du da
  // dong panel/doi tab/F5/dang nhap lai. CHI tu dong chay AI khi `autoRunIfMissing` (mo tu nut
  // ✦ o danh sach) VA thuc su CHUA tung chay (status 'none').
  const autoRunDecidedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    getLatestAiReview(contractId)
      .then(result => {
        if (!alive) return;
        const shouldAutoRun = result.status === 'none' && autoRunIfMissing && !autoRunDecidedRef.current;
        if (autoRunIfMissing && !autoRunDecidedRef.current) { autoRunDecidedRef.current = true; onAutoRunHandled?.(); }
        if (shouldAutoRun) { void runReview(); return; }
        if (result.status !== 'none') applyResult(result, { loadPreview: true });
      })
      .catch(() => { /* chua tung chay hoac loi tam thoi - de Sale tu bam "Chạy AI Review" */ })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  function jumpToExcerpt(excerpt: string | null | undefined, page: number | null | undefined) {
    setActiveExcerpt(excerpt || null);
    if (page) { setJumpPage(page); if (view !== 'highlight' && highlightAvailable) switchView('highlight'); }
  }

  function switchView(next: 'original' | 'highlight') {
    setView(next);
    if (next === 'original') { setJumpPage(null); loadOriginal(); }
    else if (reviewId) loadHighlight(reviewId);
  }

  async function confirmHighlight() {
    if (!reviewId) return;
    setConfirming(true);
    setError('');
    try {
      const result = await confirmContractAiReview(contractId, reviewId);
      setConfirmed(true);
      setConfirmResult({ fileName: result.fileName, driveFileId: result.driveFileId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được bản Highlight.');
    } finally {
      setConfirming(false);
    }
  }

  async function retryDrive() {
    try {
      await retryContractDriveSync(contractId);
    } catch {
      /* best-effort, khong chan UI */
    }
  }

  if (restoring) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}><p style={{ fontSize: '0.84rem', color: '#64748b' }}>Đang khôi phục kết quả AI Review đã lưu…</p></div>;
  }

  if (!rows) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 320 }}>
        {error ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', maxWidth: 480, textAlign: 'center' }}>{error}</p> : null}
        {driveSyncStatus === 'error' ? (
          <button type="button" className="cp-btn small" onClick={() => void retryDrive()}>↻ Đồng bộ lại file gốc trước</button>
        ) : null}
        <button type="button" className="cp-btn primary" disabled={loading} onClick={() => void runReview()}>
          {loading ? 'Đang chạy AI…' : '✦ Chạy AI Review'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 60%) minmax(0, 40%)', gap: 16, alignItems: 'start' }}>
      {/* ───── Viewer (60%) ───── */}
      <section className="cp-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 'min(80vh, 920px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="cp-tabs" role="tablist" style={{ padding: 0, border: 0 }}>
            <button type="button" className={`cp-tab ${view === 'original' ? 'is-active' : ''}`} onClick={() => switchView('original')}>Hợp đồng gốc</button>
            <button
              type="button" className={`cp-tab ${view === 'highlight' ? 'is-active' : ''}`}
              disabled={!highlightAvailable} title={!highlightAvailable ? 'Chưa có bản Highlight (định dạng chưa hỗ trợ hoặc AI Review lỗi)' : undefined}
              onClick={() => switchView('highlight')}
            >
              Bản AI Highlight
            </button>
          </div>
          {fileUrl ? (
            <a className="cp-btn small" href={view === 'highlight' ? '#' : fileUrl} target="_blank" rel="noreferrer" style={{ pointerEvents: view === 'highlight' ? 'none' : undefined, opacity: view === 'highlight' ? 0.4 : 1 }}>
              ↗ Mở rộng
            </a>
          ) : null}
        </div>
        {pdfLoading ? (
          <p style={{ fontSize: '0.82rem', color: '#64748b' }}>Đang tải tài liệu…</p>
        ) : pdfError ? (
          <p style={{ fontSize: '0.82rem', color: '#b45309' }}>{pdfError}</p>
        ) : pdfUrl ? (
          <iframe title="Xem tài liệu hợp đồng" src={jumpPage && view === 'highlight' ? `${pdfUrl}#page=${jumpPage}` : pdfUrl}
            style={{ flex: 1, minHeight: 'min(80vh, 920px)', width: '100%', border: '1px solid #e2e8f0', borderRadius: 8 }} />
        ) : (
          <p style={{ fontSize: '0.82rem', color: '#64748b' }}>Chưa có bản xem trước.</p>
        )}
      </section>

      {/* ───── Kết quả AI (40%) ───── */}
      <section className="cp-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: '0.92rem' }}>Kết quả AI{contractNumber ? ` · ${contractNumber}` : ''}</b>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: confirmed ? '#d9f2d9' : '#ffe8d1', color: confirmed ? '#166534' : '#9a3412' }}>
            {confirmed ? 'Đã lưu Highlight' : 'Chờ Sale xác nhận'}
          </span>
        </div>

        {stale ? (
          <p style={{ fontSize: '0.78rem', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '6px 8px', margin: 0 }}>
            ⚠ Hợp đồng hoặc báo giá đã thay đổi từ lúc chạy AI Review này — kết quả dưới đây là CŨ (vẫn xem được để đối chiếu lịch sử). Bấm &quot;Chạy lại AI Review&quot; trước khi xác nhận lưu Drive.
          </p>
        ) : null}
        {extractionMethod === 'heuristic' ? (
          <p style={{ fontSize: '0.76rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 8px', margin: 0 }}>
            ⚠ Chưa cấu hình AI thật (Gemini/OpenAI) trên môi trường này — chỉ dùng quy tắc giới hạn (số hợp đồng, ngày ký, số tiền, MST, bảo hành).
            Các dòng "{VERDICT_LABEL.not_extracted}" có thể THẬT SỰ có trong hợp đồng, chỉ là chưa trích xuất tự động được — Sale cần tự đọc lại.
          </p>
        ) : null}
        {highlightError ? (
          <p style={{ color: '#b91c1c', fontSize: '0.78rem', margin: 0 }}>✗ Không tạo được bản Highlight: {highlightError}</p>
        ) : highlightAvailable ? (
          <p style={{ fontSize: '0.76rem', color: totalCount > 0 && locatedCount === 0 ? '#b45309' : '#64748b', margin: 0 }}>
            ✓ Đã tạo bản Highlight — {locatedCount}/{totalCount} điều khoản có trích dẫn được tô màu thành công{totalCount > locatedCount ? `, ${totalCount - locatedCount} không định vị được (chỉ liệt kê trong báo cáo, không tô nhầm)` : ''}.
          </p>
        ) : null}
        {fromCache ? (
          <p style={{ fontSize: '0.76rem', color: '#64748b', margin: 0 }}>(Dùng lại kết quả đã chạy — nội dung chưa đổi, không gọi lại AI.)</p>
        ) : null}
        {error ? <p style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{error}</p> : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'min(60vh, 640px)', overflowY: 'auto' }}>
          {rows.map(row => (
            <button
              key={row.field}
              type="button"
              onClick={() => jumpToExcerpt(row.sourceExcerpt, row.highlightPage)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: activeExcerpt === row.sourceExcerpt && row.sourceExcerpt ? '#fdf2f8' : '#fff', cursor: row.sourceExcerpt ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: '#0f172a' }}>
                {row.label}{row.located ? ' 🎨' : ''}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: VERDICT_BG[row.verdict], color: VERDICT_TEXT[row.verdict] }}>
                {VERDICT_LABEL[row.verdict] || row.verdict}
              </span>
            </button>
          ))}
        </div>

        {riskClauses.length > 0 ? (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b style={{ fontSize: '0.84rem' }}>⚠ Điều khoản quan trọng & rủi ro</b>
              {riskClauseMethod === 'heuristic_candidate' ? (
                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#e2e8f0', color: '#475569' }} title="Phát hiện bằng từ khoá, chưa qua AI thật xác nhận">
                  Chưa xác thực bằng AI
                </span>
              ) : null}
            </div>
            {riskClauseMethod === 'heuristic_candidate' ? (
              <p style={{ fontSize: '0.74rem', color: '#92400e', margin: '0 0 8px' }}>
                Chưa cấu hình AI thật nên chỉ dò được vài cụm từ khoá phổ biến — có thể bỏ sót điều khoản rủi ro khác. Sale/pháp chế nên tự đọc kỹ toàn bộ hợp đồng.
              </p>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {riskClauses.map((c, i) => (
                <button
                  key={c.field || i}
                  type="button"
                  onClick={() => jumpToExcerpt(c.sourceExcerpt || c.excerpt, c.highlightPage)}
                  style={{
                    textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                    background: activeExcerpt === (c.sourceExcerpt || c.excerpt) ? '#fdf2f8' : '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>{c.title}{c.located ? ' 🎨' : ''}</span>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: RISK_SEVERITY_BG[c.severity], color: RISK_SEVERITY_TEXT[c.severity], whiteSpace: 'nowrap' }}>
                      {RISK_SEVERITY_LABEL[c.severity] || c.severity}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{RISK_CATEGORY_LABEL[c.category] || c.category}{c.location ? ` · ${c.location}` : ''}</span>
                  <span style={{ fontSize: '0.76rem', color: '#334155' }}>{c.explanation}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {activeExcerpt ? (
          <div className="cp-card" style={{ background: '#f8fafc', fontSize: '0.78rem', color: '#334155' }}>
            <b style={{ fontSize: '0.72rem', color: '#64748b' }}>Trích dẫn trong hợp đồng:</b>
            <p style={{ margin: '4px 0 0' }}>{activeExcerpt}</p>
          </div>
        ) : null}

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {confirmed ? (
            <p style={{ fontSize: '0.82rem', color: '#166534', margin: 0 }}>
              ✓ Đã lưu lên Drive{confirmResult?.fileName ? `: ${confirmResult.fileName}` : ''}.{' '}
              {confirmResult?.driveFileId ? <a href={`https://drive.google.com/file/d/${confirmResult.driveFileId}/view`} target="_blank" rel="noreferrer">↗ Mở trên Drive</a> : null}
            </p>
          ) : (
            <button
              type="button" className="cp-btn primary" disabled={confirming || !reviewId || !highlightAvailable || stale}
              title={stale ? 'Hợp đồng/báo giá đã đổi — chạy lại AI Review trước' : !highlightAvailable ? 'Chưa có bản Highlight để xác nhận (xem bên viewer)' : undefined}
              onClick={() => void confirmHighlight()}
            >
              {confirming ? 'Đang lưu…' : '✓ Xác nhận & lưu Highlight lên Drive'}
            </button>
          )}
          <button type="button" className="cp-btn small" disabled={loading} onClick={() => void runReview()}>
            {loading ? 'Đang chạy lại…' : '↻ Chạy lại AI Review'}
          </button>
        </div>
      </section>
    </div>
  );
}
