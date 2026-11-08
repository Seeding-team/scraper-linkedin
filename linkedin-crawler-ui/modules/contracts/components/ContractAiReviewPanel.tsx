'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { hasFullCrmAccess } from '@/modules/crm/constants/crmConfig';
import {
  type AiReviewComparisonRow,
  type AiRiskClause,
  type ContractAmendment,
  type EditSessionStatus,
  type HighlightAnnotation,
  type OnlyOfficeEditorConfig,
  approveAmendment,
  confirmContractAiReview,
  discardEditSession,
  fetchAiReviewHighlightPreviewPdf,
  fetchExternalDocumentPreviewPdf,
  getEditSessionStatus,
  getLatestAiReview,
  listEditAnnotations,
  patchEditAnnotation,
  rejectAmendment,
  requestEditForcesave,
  retryContractDriveSync,
  runContractAiReviewFull,
  saveEditVersion,
  startEditSession,
  submitAmendment,
} from '../repositories/contractDocs';
import { loadOnlyOfficeApi, useWordEditorBridge } from './useWordEditorBridge';

const ANNOTATION_SOURCE_LABEL: Record<string, string> = { ai: 'AI', sale: 'Sale' };
const ANNOTATION_SOURCE_BG: Record<string, string> = { ai: '#ede9fe', sale: '#dbeafe' };
const ANNOTATION_SOURCE_TEXT: Record<string, string> = { ai: '#5b21b6', sale: '#1d4ed8' };
const ANNOTATION_STATUS_LABEL: Record<string, string> = { active: 'Đang hiển thị', dismissed: 'Đã bỏ qua cảnh báo', removed: 'Đã xoá highlight' };
const AMENDMENT_STATUS_LABEL: Record<string, string> = { draft: 'Nháp', pending_approval: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };

function formatTimeHm(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

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
  // (2026-10-28, "Hybrid Regex + AI thật") AI ĐÃ CHẠY thật nhưng không thấy nội dung này trong văn
  // bản — khác "not_extracted" (AI chưa chạy) và "insufficient_data" (thiếu dữ liệu phía báo giá).
  not_found_in_document: 'Không tìm thấy trong tài liệu',
};
const VERDICT_BG: Record<string, string> = {
  match: '#d9f2d9', mismatch: '#fadbd8', needs_review: '#fff3c4', insufficient_data: '#f1f5f9', not_extracted: '#e2e8f0',
  not_found_in_document: '#f1f5f9',
};
const VERDICT_TEXT: Record<string, string> = {
  match: '#166534', mismatch: '#b91c1c', needs_review: '#92400e', insufficient_data: '#64748b', not_extracted: '#475569',
  not_found_in_document: '#64748b',
};

function usePdfBlobUrl(): [string | null, boolean, string, (fn: () => Promise<Blob>) => void] {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const objectUrlRef = useRef<string | null>(null);
  // BUG THAT DA GAP (sep bao PDF trang khi doi tab nhanh, 2026-10-27): load() truoc day khong co
  // gi chan cac lan goi chong cheo - bam nhanh "Hop dong goc" <-> "Ban AI Highlight" ban nhieu
  // fetch song song, request CU co the ve SAU request MOI (mang/thu tu khong dam bao) va de len
  // url dung, hoac revoke nham blob URL dang hien thi -> iframe trang. Dung generation counter:
  // chi KET QUA cua lan goi load() GAN NHAT (requestIdRef) moi duoc ap dung, ket qua cu hon bi
  // bo qua hoan toan (khong setUrl, khong revoke gi ca - tranh dung nham URL dang song).
  const requestIdRef = useRef(0);

  function load(fn: () => Promise<Blob>) {
    const myId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    fn()
      .then(blob => {
        if (requestIdRef.current !== myId) return; // co request moi hon da bat dau sau, bo qua ket qua cu nay
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const next = URL.createObjectURL(blob);
        objectUrlRef.current = next;
        setUrl(next);
      })
      .catch(e => {
        if (requestIdRef.current !== myId) return;
        setError(e instanceof Error ? e.message : 'Không xem trước được.');
      })
      .finally(() => {
        if (requestIdRef.current === myId) setLoading(false);
      });
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
  const [view, setView] = useState<'original' | 'highlight' | 'editor'>('original');
  const [activeExcerpt, setActiveExcerpt] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState<number | null>(null);
  const [jumpTick, setJumpTick] = useState(0);

  // ───────── Split layout 60/40 + Resizable splitter + Viewport height ─────────
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [leftRatio, setLeftRatio] = useState<number>(60);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [splitCommitTick, setSplitCommitTick] = useState(0);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  const [pdfUrl, pdfLoading, pdfError, loadPdf] = usePdfBlobUrl();

  // ───────── Word Editor (OnlyOffice, 2026-10-27 — xem proud-stargazing-pixel.md) ─────────
  const { user } = useAppAuth();
  const canApprove = hasFullCrmAccess(user);
  const { pluginReady, sendCommand, reset: resetBridge } = useWordEditorBridge();
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const docEditorRef = useRef<{ destroyEditor?: () => void } | null>(null);
  const [editorStarting, setEditorStarting] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<EditSessionStatus | null>(null);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);

  // BUG THẬT ĐÃ GẶP (xem chi tiết ở startEditor() - OnlyOffice "đóng băng" kích thước iframe lúc
  // mount, không tự responsive) - khi Sale bấm "Mở rộng toàn màn hình"/"Thu nhỏ", bật/tắt panel
  // AI, hoặc kéo thanh chia cột (splitCommitTick), PHẢI remount lại OnlyOffice để nó đo lại kích
  // thước mới, không chỉ đổi CSS suông (sẽ giữ nguyên kích thước cũ đã "đóng băng" từ lần mount trước).
  const editorConfigRef = useRef<OnlyOfficeEditorConfig | null>(null);
  useEffect(() => {
    if (view !== 'editor' || !editSessionId || !editorConfigRef.current) return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!cancelled && editorConfigRef.current) await mountOnlyOfficeEditor(editorConfigRef.current);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFullscreen, aiPanelCollapsed, splitCommitTick]);
  const [pendingSave, setPendingSave] = useState(false);
  const [forcesaveFailed, setForcesaveFailed] = useState(false);
  const [annotations, setAnnotations] = useState<HighlightAnnotation[]>([]);
  const [annotationBusyId, setAnnotationBusyId] = useState<string | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [savingVersion, setSavingVersion] = useState(false);
  const [saveVersionError, setSaveVersionError] = useState('');
  const [showAmendmentModal, setShowAmendmentModal] = useState(false);
  const [amendmentNoteDraft, setAmendmentNoteDraft] = useState('');
  const [showRerunBanner, setShowRerunBanner] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [amendmentActionBusyId, setAmendmentActionBusyId] = useState<string | null>(null);

  async function refreshAnnotations() {
    try {
      const list = await listEditAnnotations(contractId);
      setAnnotations(list);
    } catch {
      /* best-effort — giữ danh sách cũ nếu lỗi tạm thời */
    }
  }

  // Poll trạng thái phiên sửa (badge autosave) + annotation — chỉ sau khi đã có kết quả AI Review
  // (nhất quán với phần còn lại của cột phải). Annotation chỉ refetch khi KHÔNG đang 'syncing' —
  // tránh FE đọc dữ liệu nửa chừng lúc backend đang quét lại sau autosave (yêu cầu sếp).
  useEffect(() => {
    if (!rows) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prevAutosavedAt = { current: null as string | null };

    async function poll() {
      try {
        const status = await getEditSessionStatus(contractId);
        if (!alive) return;
        setEditStatus(status);
        const syncing = status.session?.annotations_sync_status === 'syncing';
        const autosavedAt = status.session?.last_autosaved_at || null;
        if (autosavedAt && autosavedAt !== prevAutosavedAt.current) {
          prevAutosavedAt.current = autosavedAt;
          setPendingSave(false);
          setForcesaveFailed(false);
        }
        if (!syncing) await refreshAnnotations();
      } catch {
        /* best-effort */
      }
      if (alive) timer = setTimeout(poll, 8000);
    }
    void poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, rows]);

  // GIỚI HẠN THẬT CHƯA GIẢI QUYẾT XONG (2026-10-27, điều tra sâu bằng Playwright nhiều vòng —
  // xem báo cáo QA Word Editor): OnlyOffice Command Service "forcesave" (backend gọi HTTP
  // server-to-server) LUÔN trả "error 4" (không có gì để lưu) dù Sale vừa gõ chữ thật và nhìn
  // thấy trên màn hình. Đã thử 3 hướng để tự động hoá việc lưu mà Sale không cần bấm gì:
  //   1) Dispatch KeyboardEvent Ctrl+S qua plugin bridge (callCommand) — THẤT BẠI, callCommand
  //      chỉ chạy được Automation API (Api.*) thao tác nội dung, không có `document`/KeyboardEvent
  //      DOM thật trong ngữ cảnh đó (xác nhận qua search tài liệu chính thức OnlyOffice: không có
  //      API plugin nào trigger save, chỉ có Command Service).
  //   2) Dispatch Ctrl+S trực tiếp từ trang host vào `iframe.contentDocument` — bị Same-Origin
  //      Policy chặn vì OnlyOffice khác origin (cổng 8095) với trang host.
  //   3) Proxy OnlyOffice qua CÙNG ORIGIN với trang host (nginx) để vượt qua #2 — DOM access +
  //      websocket đều hoạt động đúng sau khi proxy (đã verify), nhưng dispatch Ctrl+S sau đó
  //      KHÔNG còn kích hoạt lưu thật nữa (đã loại trừ nguyên nhân do stale lock bằng cách restart
  //      sạch container OnlyOffice, vẫn không lại được) — ĐÃ REVERT proxy này vì không giải quyết
  //      được vấn đề mà có thể gây hiệu ứng phụ khác (xem nginx.conf, đã gỡ location /onlyoffice-ds/).
  // KẾT LUẬN: tự động lưu nháp hoàn toàn không cần Sale thao tác gì KHÔNG khả thi với OnlyOffice
  // Community self-host bằng các cơ chế công khai hiện có. Ctrl+S THẬT (Sale tự bấm, OS-level) vẫn
  // lưu được tin cậy trong ~1s — UI dưới đây nhắc rõ Sale bấm Ctrl+S định kỳ; `requestEditForcesave`
  // (Command Service) vẫn được gọi thêm vì vô hại, nhưng không phải nguồn lưu chính. Backend vẫn
  // giữ nguyên lớp an toàn: "Lưu phiên bản mới" TỪ CHỐI nếu phiên chưa từng có 1 lần autosave thật
  // nào — không bao giờ âm thầm lưu nhầm bản cũ.
  async function bestEffortForcesave() {
    if (!editSessionId) return;
    try {
      await requestEditForcesave(contractId);
    } catch {
      /* best-effort — không chặn UI */
    }
  }

  // Gọi Command Service forcesave định kỳ ~15s — vô hại, thỉnh thoảng có thể bắt kịp, nhưng
  // KHÔNG phải nguồn lưu chính đáng tin cậy (xem ghi chú "GIỚI HẠN THẬT" ở trên). Nguồn lưu thật
  // là Sale tự bấm Ctrl+S trong khung soạn thảo — UI nhắc qua banner `pendingSave` phía dưới.
  useEffect(() => {
    if (!editSessionId || view !== 'editor') return;
    const interval = setInterval(() => { void requestEditForcesave(contractId); }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSessionId, view, contractId]);

  // Forcesave lúc đóng tab trình duyệt/đổi trang — KHÔNG đảm bảo hoàn tất (giới hạn beforeunload),
  // chỉ là 1 cú "nhắc" thêm.
  useEffect(() => {
    if (!editSessionId) return;
    const handler = () => { void requestEditForcesave(contractId); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void bestEffortForcesave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSessionId, contractId]);

  async function startEditor() {
    setEditorStarting(true);
    setEditorError('');
    try {
      const result = await startEditSession(contractId);
      setEditSessionId(result.sessionId);
      editorConfigRef.current = result.editorConfig;
      setView('editor');
      // BUG THẬT ĐÃ GẶP (xác nhận qua đo DOM thật bằng Playwright): OnlyOffice đo kích thước
      // #word-editor-container NGAY LÚC mount và set CỨNG kích thước đó cho iframe nó tạo ra
      // (không tự responsive theo CSS sau này) — nếu `setView('editor')` (chuyển display:none ->
      // flex) chưa kịp commit/layout xong trước khi mountOnlyOfficeEditor() chạy (loadOnlyOfficeApi
      // có thể resolve gần như ngay lập tức nếu script đã cache, không đủ thời gian cho 1 lần
      // render+layout thật) thì OnlyOffice đo trúng container cao ~150px (giữa chừng layout) và
      // "đóng băng" luôn giá trị đó — toolbar hiện đủ nhưng phần nội dung trống trơn. Ép đợi đúng
      // 2 animation frame (double rAF — kỹ thuật chuẩn để đảm bảo 1 lần layout/paint thật đã xảy ra)
      // trước khi mount, đảm bảo OnlyOffice đo ĐÚNG kích thước cuối cùng.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await loadOnlyOfficeApi(result.onlyofficeApiUrl);
      await mountOnlyOfficeEditor(result.editorConfig);
      if (result.convertedFromPdf) {
        setEditorError('Lưu ý: hợp đồng gốc là PDF — đã chuyển đổi tạm sang DOCX để sửa, kiểm tra kỹ bố cục trước khi lưu phiên bản mới.');
      }
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Không mở được trình chỉnh sửa.');
    } finally {
      setEditorStarting(false);
    }
  }

  async function mountOnlyOfficeEditor(config: OnlyOfficeEditorConfig) {
    if (!editorContainerRef.current) return;
    const DocsAPI = (window as unknown as { DocsAPI: { DocEditor: new (id: string, cfg: Record<string, unknown>) => { destroyEditor?: () => void } } }).DocsAPI;
    docEditorRef.current?.destroyEditor?.();
    const mergedConfig = {
      ...config,
      events: {
        onDocumentReady: () => setEditorError(current => (
          current.startsWith('OnlyOffice báo lỗi') ? '' : current
        )),
        onDocumentStateChange: (ev: { data?: boolean }) => { if (ev?.data) setPendingSave(true); },
        onError: () => setEditorError('OnlyOffice báo lỗi trong lúc chỉnh sửa — thử tải lại.'),
      },
    };
    docEditorRef.current = new DocsAPI.DocEditor('word-editor-container', mergedConfig);
  }

  function switchViewFromEditor(next: 'original' | 'highlight') {
    if (view === 'editor') void bestEffortForcesave();
    switchView(next);
  }

  async function handleSaveVersion(withAmendment?: { note: string }) {
    setSavingVersion(true);
    setSaveVersionError('');
    // Gọi forcesave (vô hại, có thể không bắt kịp — xem ghi chú "GIỚI HẠN THẬT") trước khi gọi
    // save-version; backend tự từ chối nếu phiên chưa từng có autosave thật nào (an toàn).
    try { await requestEditForcesave(contractId); } catch { /* best-effort */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await saveEditVersion(contractId, withAmendment ? { confirmAmendment: true, note: withAmendment.note } : {});
      setShowAmendmentModal(false);
      setAmendmentNoteDraft('');
      setShowRerunBanner(true);
      await refreshAnnotations();
      try {
        const status = await getEditSessionStatus(contractId);
        setEditStatus(status);
      } catch { /* best-effort */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không lưu được phiên bản mới.';
      if (!withAmendment && /đã ký|phụ lục|sửa đổi/i.test(msg)) {
        setShowAmendmentModal(true);
      } else {
        setSaveVersionError(msg);
      }
    } finally {
      setSavingVersion(false);
    }
  }

  async function handleDiscardSession() {
    setDiscarding(true);
    try {
      await discardEditSession(contractId);
      docEditorRef.current?.destroyEditor?.();
      docEditorRef.current = null;
      resetBridge();
      setEditSessionId(null);
      setPendingSave(false);
      switchView('highlight');
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Không huỷ được bản nháp.');
    } finally {
      setDiscarding(false);
    }
  }

  async function handleAnnotationAction(ann: HighlightAnnotation, action: 'dismiss_warning' | 'remove_highlight' | 'clear_note') {
    setAnnotationBusyId(ann.id);
    try {
      let alreadyAppliedLive = false;
      if (action === 'remove_highlight') {
        const m = /^p(\d+)$/.exec(ann.paragraph_anchor || '');
        if (view === 'editor' && pluginReady && m) {
          const res = await sendCommand('removeHighlightRange', {
            paragraphIndex: Number(m[1]), start: ann.char_start ?? 0, end: ann.char_end ?? -1,
          });
          alreadyAppliedLive = res.ok;
        }
      }
      await patchEditAnnotation(contractId, ann.id, action, alreadyAppliedLive);
      await refreshAnnotations();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Không thực hiện được thao tác trên highlight.');
    } finally {
      setAnnotationBusyId(null);
    }
  }

  async function jumpToAnnotation(ann: HighlightAnnotation) {
    setActiveAnnotationId(ann.id);
    setActiveExcerpt(ann.excerpt || null);
    const paraMatch = /^p(\d+)$/.exec(ann.paragraph_anchor || '');
    if (view === 'editor' && pluginReady && paraMatch) {
      // Phiên OnlyOffice đang mở sống -> nhảy bằng bookmark đã chèn theo paragraph_anchor.
      await sendCommand('selectBookmark', { name: `ann_${ann.id.replace(/-/g, '_')}` });
      return;
    }
    // Tab "Bản AI Highlight" (PDF tĩnh) -> dùng `highlight_page` (số trang THẬT đã tính sẵn lúc
    // AI Review chạy, cho CẢ nguồn DOCX lẫn PDF — KHÔNG suy ra từ paragraph_anchor dạng "pN", vì
    // đó là chỉ số đoạn DOCX, không phải số trang PDF. Bug cũ: parse "page:N" từ paragraph_anchor
    // chỉ khớp khi is_pdf=True lúc seed, nên annotation nguồn DOCX (đa số) không bao giờ nhảy được.
    const pageMatch = /^page:(\d+)$/.exec(ann.paragraph_anchor || '');
    const page = ann.highlight_page ?? (pageMatch ? Number(pageMatch[1]) : null);
    if (page) {
      jumpToExcerpt(ann.excerpt, page);
    }
  }

  /** Nối annotation THẬT (nguồn dữ liệu duy nhất: GET .../edit/annotations) với bảng đối chiếu/
   * rủi ro ĐÃ TẢI SẴN trong state này — chỉ để lấy tiêu đề/mức độ quan trọng dễ đọc hơn
   * (annotation.category khớp với row.field hoặc riskClause.field do cách seed_ai_annotations()
   * lưu — xem backend), KHÔNG tạo/suy luận thêm annotation nào ngoài danh sách backend trả về. */
  function enrichAnnotation(a: HighlightAnnotation): { title: string; severity?: 'warn' | 'info'; locationLabel: string | null } {
    if (a.source === 'ai' && a.category) {
      const riskMatch = riskClauses.find(c => c.field === a.category);
      if (riskMatch) return { title: riskMatch.title, severity: riskMatch.severity, locationLabel: riskMatch.location || null };
      const rowMatch = rows?.find(r => r.field === a.category);
      if (rowMatch) return { title: rowMatch.label, locationLabel: rowMatch.sourceLocation || null };
    }
    const paraMatch = /^p(\d+)$/.exec(a.paragraph_anchor || '');
    const fallbackLocation = a.highlight_page ? `Trang ${a.highlight_page}` : paraMatch ? `Đoạn ${paraMatch[1]}` : null;
    return { title: a.source === 'ai' ? 'Nội dung AI phát hiện' : 'Sale tô vàng thủ công', locationLabel: fallbackLocation };
  }

  async function handleAmendmentAction(amendmentId: string, action: 'submit' | 'approve' | 'reject') {
    setAmendmentActionBusyId(amendmentId);
    try {
      if (action === 'submit') await submitAmendment(contractId, amendmentId);
      else if (action === 'approve') await approveAmendment(contractId, amendmentId);
      else await rejectAmendment(contractId, amendmentId);
      const status = await getEditSessionStatus(contractId);
      setEditStatus(status);
      if (action === 'approve') setShowRerunBanner(true);
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Không thực hiện được thao tác trên bản sửa đổi.');
    } finally {
      setAmendmentActionBusyId(null);
    }
  }

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
        void refreshAnnotations();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không chạy được AI Review.');
    } finally {
      setLoading(false);
    }
  }

  // (2026-10-27, fix bug "mat trang thai khi dong/mo lai panel") Lan mo dau tien CHI doc phien
  // da luu (KHONG goi AI) - khoi phuc dung ket qua + Highlight nhap + trang thai xac nhan du da
  // dong panel/doi tab/F5/dang nhap lai. Tu dong chay AI khi `autoRunIfMissing` (mo tu nut
  // ✦ o danh sach) VA thuc su CHUA tung chay (status 'none'), HOAC khi review cu chua xac nhan
  // nhung da stale (doi quy tac RULES_VERSION hoac noi dung).
  const autoRunDecidedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    getLatestAiReview(contractId)
      .then(result => {
        if (!alive) return;
        const shouldAutoRun =
          (result.status === 'none' && autoRunIfMissing && !autoRunDecidedRef.current) ||
          Boolean(result.stale && !result.confirmed);
        if (autoRunIfMissing && !autoRunDecidedRef.current) { autoRunDecidedRef.current = true; onAutoRunHandled?.(); }
        if (shouldAutoRun) { void runReview(); return; }
        if (result.status !== 'none') {
          applyResult(result, { loadPreview: true });
          void refreshAnnotations();
        }
      })
      .catch(() => { /* chua tung chay hoac loi tam thoi - de Sale tu bam "Chạy AI Review" */ })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  function jumpToExcerpt(
    excerpt: string | null | undefined,
    page: number | null | undefined,
    field?: string | null,
  ) {
    setActiveExcerpt(excerpt || null);
    const matchedAnn = annotations.find(
      a =>
        a.status !== 'removed' &&
        ((field && a.category === field) || (excerpt && a.excerpt === excerpt)),
    );
    if (matchedAnn) {
      setActiveAnnotationId(matchedAnn.id);
      const paraMatch = /^p(\d+)$/.exec(matchedAnn.paragraph_anchor || '');
      if (view === 'editor' && pluginReady && paraMatch) {
        void sendCommand('selectBookmark', { name: `ann_${matchedAnn.id.replace(/-/g, '_')}` });
        return;
      }
    }
    const pageFromAnchor = matchedAnn?.paragraph_anchor
      ? /^page:(\d+)$/.exec(matchedAnn.paragraph_anchor)
      : null;
    const effectivePage =
      page ?? matchedAnn?.highlight_page ?? (pageFromAnchor ? Number(pageFromAnchor[1]) : null);
    if (effectivePage) {
      setJumpPage(effectivePage);
      setJumpTick(t => t + 1);
      if (view !== 'highlight' && highlightAvailable) switchView('highlight');
    }
  }

  useEffect(() => {
    if (restoring || (!rows && !editSessionId)) return;
    function updateHeight() {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = Math.max(460, Math.floor(window.innerHeight - rect.top - 16));
      setPanelHeight(next);
    }
    updateHeight();
    const rAF = requestAnimationFrame(updateHeight);
    window.addEventListener('resize', updateHeight);
    return () => {
      cancelAnimationFrame(rAF);
      window.removeEventListener('resize', updateHeight);
    };
  }, [rows, editSessionId, restoring]);

  function startSplitDrag(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    setIsDraggingSplit(true);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rawPct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(78, Math.max(35, Math.round(rawPct * 10) / 10));
      setLeftRatio(clamped);
    }

    function onUp() {
      setIsDraggingSplit(false);
      setSplitCommitTick(t => t + 1);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function switchView(next: 'original' | 'highlight') {
    setView(next);
    if (next === 'original') { setJumpPage(null); loadOriginal(); }
    else if (reviewId) loadHighlight(reviewId);
  }

  function onEditorTabClick() {
    if (editSessionId) { if (view === 'editor') return; setView('editor'); return; }
    void startEditor();
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

  if (!rows && !editSessionId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 320 }}>
        {error ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', maxWidth: 480, textAlign: 'center' }}>{error}</p> : null}
        {driveSyncStatus === 'error' ? (
          <button type="button" className="cp-btn small" onClick={() => void retryDrive()}>↻ Đồng bộ lại file gốc trước</button>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="cp-btn primary" disabled={loading} onClick={() => void runReview()}>
            {loading ? 'Đang chạy AI…' : '✦ Chạy AI Review'}
          </button>
          {/* (2026-10-27) Sale khong bat buoc phai chay AI Review truoc moi mo sua duoc Word - chi
           * can hop dong co file DOCX/PDF hop le (yeu cau #8 cua plan + bug report "go gate"). */}
          <button type="button" className="cp-btn" disabled={editorStarting} onClick={() => void startEditor()}>
            {editorStarting ? 'Đang mở…' : '✎ Chỉnh sửa hợp đồng (Word)'}
          </button>
        </div>
        {editorError ? <p style={{ color: '#b91c1c', fontSize: '0.8rem', maxWidth: 480, textAlign: 'center' }}>{editorError}</p> : null}
      </div>
    );
  }

  const showRightPanel = Boolean(rows && !(view === 'editor' && aiPanelCollapsed));
  const resolvedHeight = panelHeight ? `${panelHeight}px` : 'calc(100vh - 180px)';

  return (
    <div
      ref={splitContainerRef}
      data-testid="ai-review-split-layout"
      style={{
        display: 'grid',
        gridTemplateColumns: showRightPanel
          ? `minmax(0, ${leftRatio}fr) 12px minmax(0, ${Math.round((100 - leftRatio) * 10) / 10}fr)`
          : '1fr',
        alignItems: 'stretch',
        height: resolvedHeight,
        maxHeight: resolvedHeight,
        minHeight: 460,
        overflow: 'hidden',
      }}
    >
      {/* ───── Viewer (mặc định 60%, cố định theo chiều cao viewport, không để khoảng trắng dưới PDF) ───── */}
      <section
        className="cp-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
          <div className="cp-tabs" role="tablist" style={{ padding: 0, border: 0 }}>
            <button type="button" className={`cp-tab ${view === 'original' ? 'is-active' : ''}`} onClick={() => switchViewFromEditor('original')}>Hợp đồng gốc</button>
            <button
              type="button" className={`cp-tab ${view === 'highlight' ? 'is-active' : ''}`}
              disabled={!highlightAvailable} title={!highlightAvailable ? 'Chưa có bản Highlight (định dạng chưa hỗ trợ hoặc AI Review lỗi)' : undefined}
              onClick={() => switchViewFromEditor('highlight')}
            >
              Bản AI Highlight
            </button>
            <button
              type="button" className={`cp-tab ${view === 'editor' ? 'is-active' : ''}`}
              disabled={editorStarting} onClick={onEditorTabClick}
            >
              {editorStarting ? 'Đang mở…' : '✎ Chỉnh sửa (Word)'}
            </button>
          </div>
          {fileUrl && view !== 'editor' ? (
            <a className="cp-btn small" href={view === 'highlight' ? '#' : fileUrl} target="_blank" rel="noreferrer" style={{ pointerEvents: view === 'highlight' ? 'none' : undefined, opacity: view === 'highlight' ? 0.4 : 1 }}>
              ↗ Mở rộng
            </a>
          ) : null}
        </div>
        {editorError && view !== 'editor' ? (
          <div
            role="alert"
            data-testid="word-editor-start-error"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 8,
              background: '#fef2f2', color: '#b91c1c', fontSize: '0.78rem', flexShrink: 0,
            }}
          >
            <span>{editorError}</span>
            <button type="button" className="cp-btn small" disabled={editorStarting} onClick={() => void startEditor()}>
              {editorStarting ? 'Đang thử lại…' : 'Thử lại'}
            </button>
          </div>
        ) : null}
        {view !== 'editor' ? (
          pdfLoading ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>Đang tải tài liệu…</p>
            </div>
          ) : pdfError ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '0.82rem', color: '#b45309', margin: 0 }}>{pdfError}</p>
            </div>
          ) : pdfUrl ? (
            <iframe
              key={`${pdfUrl}#${view === 'highlight' ? `${jumpPage ?? 'base'}-${jumpTick}` : 'base'}`}
              title="Xem tài liệu hợp đồng"
              src={jumpPage && view === 'highlight' ? `${pdfUrl}#page=${jumpPage}` : pdfUrl}
              style={{
                flex: 1,
                minHeight: 0,
                height: '100%',
                width: '100%',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                pointerEvents: isDraggingSplit ? 'none' : undefined,
              }}
            />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>Chưa có bản xem trước.</p>
            </div>
          )
        ) : null}

        {/* Luôn mount (chỉ ẩn/hiện bằng display) để giữ phiên OnlyOffice sống khi đổi tab xem
         * sang "Hợp đồng gốc"/"Bản AI Highlight" rồi quay lại — tránh mất nháp/annotation sống.
         * Khi editorFullscreen=true, nổi lên full viewport (position:fixed) để Sale có đủ chỗ
         * soạn thảo thật — không đụng tới kích thước chung .cd-panel (58vw, đã chốt riêng). */}
        <div
          className="word-editor-shell"
          style={
            editorFullscreen
              ? { position: 'fixed', inset: 0, zIndex: 99995, background: '#fff', display: view === 'editor' ? 'flex' : 'none', flexDirection: 'column', gap: 8, padding: 16 }
              : { display: view === 'editor' ? 'flex' : 'none', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, height: '100%', pointerEvents: isDraggingSplit ? 'none' : undefined }
          }
        >
          {editorError ? <p style={{ fontSize: '0.78rem', color: '#b45309', margin: 0, flexShrink: 0 }}>{editorError}</p> : null}
          {editSessionId ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.74rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: forcesaveFailed ? '#fadbd8' : pendingSave ? '#fff3c4' : '#d9f2d9',
                  color: forcesaveFailed ? '#b91c1c' : pendingSave ? '#92400e' : '#166534',
                }}>
                  {forcesaveFailed ? 'Lưu thất bại' : pendingSave ? 'Đang lưu…' : editStatus?.session?.last_autosaved_at ? `Đã lưu lúc ${formatTimeHm(editStatus.session.last_autosaved_at)}` : 'Chưa có thay đổi'}
                </span>
                {pendingSave ? (
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }} title="Tự động lưu định kỳ (~10-30s/lần). Nếu cần chắc chắn lưu ngay, có thể bấm Ctrl+S trong khung soạn thảo.">
                    Tự động lưu định kỳ — Ctrl+S nếu muốn lưu ngay
                  </span>
                ) : null}
                <div style={{ display: 'flex', gap: 6 }}>
                  {rows ? (
                    <button type="button" className="cp-btn small" onClick={() => setAiPanelCollapsed((v) => !v)}>
                      {aiPanelCollapsed ? '◧ Hiện kết quả AI' : '◨ Ẩn kết quả AI'}
                    </button>
                  ) : null}
                  <button type="button" className="cp-btn small" onClick={() => setEditorFullscreen((v) => !v)}>
                    {editorFullscreen ? '✕ Thu nhỏ' : '⤢ Mở rộng toàn màn hình'}
                  </button>
                  <button type="button" className="cp-btn small" disabled={discarding} onClick={() => void handleDiscardSession()}>
                    {discarding ? 'Đang huỷ…' : 'Huỷ nháp'}
                  </button>
                  <button type="button" className="cp-btn primary small" disabled={savingVersion} onClick={() => void handleSaveVersion()}>
                    {savingVersion ? 'Đang lưu…' : 'Lưu phiên bản mới'}
                  </button>
                </div>
              </div>
              {saveVersionError ? <p style={{ fontSize: '0.76rem', color: '#b91c1c', margin: 0 }}>{saveVersionError}</p> : null}
            </div>
          ) : null}
          {/* KHÔNG đặt height/minHeight cụ thể ở đây bằng inline style - OnlyOffice THAY THẾ HẲN
           * phần tử này bằng markup riêng của nó lúc mount (mất hết inline style gốc, xem bug đã
           * ghi trong copilot.css) - chiều cao thật được ép bằng CSS `.word-editor-shell > div:
           * last-child` (ăn theo VỊ TRÍ trong DOM, không phụ thuộc node gốc còn sống hay không). */}
          <div ref={editorContainerRef} id="word-editor-container" style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8 }} />
        </div>
      </section>

      {showRightPanel ? (
        <>
          {/* ───── Thanh kéo chia tỷ lệ cột (mặc định 60% / 40%, nhấp đúp để reset về 60/40) ───── */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Kéo để thay đổi tỷ lệ hai cột (nhấp đúp để đặt lại 60/40)"
            title="Kéo để thay đổi tỷ lệ 2 cột · Nhấp đúp để đặt lại 60% / 40%"
            data-testid="ai-review-splitter"
            onMouseDown={startSplitDrag}
            onDoubleClick={() => { setLeftRatio(60); setSplitCommitTick(t => t + 1); }}
            style={{
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              height: '100%',
            }}
          >
            <span
              style={{
                width: 4,
                height: 44,
                borderRadius: 999,
                background: isDraggingSplit ? '#be1e4b' : '#cbd5e1',
                transition: 'background 0.15s ease',
              }}
            />
          </div>

          {/* ───── Kết quả AI (mặc định 40%, cùng chiều cao viewport với cột trái, tự cuộn độc lập) ───── */}
          <section
            className="cp-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <b style={{ fontSize: '0.92rem' }}>Kết quả AI{contractNumber ? ` · ${contractNumber}` : ''}</b>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: confirmed ? '#d9f2d9' : '#ffe8d1', color: confirmed ? '#166534' : '#9a3412' }}>
                {confirmed ? 'Đã lưu Highlight' : 'Chờ Sale xác nhận'}
              </span>
            </div>

            {/* Vùng cuộn độc lập của cột Kết quả AI */}
            <div
              data-testid="ai-review-right-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                paddingRight: 4,
              }}
            >
              {stale ? (
                <p style={{ fontSize: '0.78rem', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '6px 8px', margin: 0 }}>
                  ⚠ Hợp đồng hoặc báo giá đã thay đổi từ lúc chạy AI Review này — kết quả dưới đây là CŨ (vẫn xem được để đối chiếu lịch sử). Bấm &quot;Chạy lại AI Review&quot; trước khi xác nhận lưu Drive.
                </p>
              ) : null}
              {extractionMethod === 'heuristic' ? (
                <p style={{ fontSize: '0.76rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 8px', margin: 0 }}>
                  ⚠ Chưa cấu hình AI thật (Gemini/OpenAI) trên môi trường này — chỉ dùng quy tắc giới hạn (số hợp đồng, ngày ký, số tiền, MST, bảo hành).
                  Các dòng &quot;{VERDICT_LABEL.not_extracted}&quot; có thể THẬT SỰ có trong hợp đồng, chỉ là chưa trích xuất tự động được — Sale cần tự đọc lại.
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
              {error ? <p style={{ color: '#b91c1c', fontSize: '0.8rem', margin: 0 }}>{error}</p> : null}

              {/* "Thông tin quan trọng đã Highlight" — dữ liệu THẬT duy nhất từ GET .../edit/annotations
               * (AI + Sale), đặt NGAY SAU banner tóm tắt và TRƯỚC bảng đối chiếu báo giá (ưu tiên hiển
               * thị cao hơn — yêu cầu sếp 2026-10-27) — KHÔNG trộn với bảng đối chiếu bên dưới. */}
              {annotations.filter(a => a.status !== 'removed').length > 0 ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <b style={{ fontSize: '0.84rem' }}>🖍 Thông tin quan trọng đã Highlight</b>
                    {editStatus?.session?.annotations_sync_status === 'syncing' ? (
                      <span style={{ fontSize: '0.68rem', color: '#64748b' }}>đang đồng bộ…</span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: editStatus?.session?.annotations_sync_status === 'syncing' ? 0.5 : 1, pointerEvents: editStatus?.session?.annotations_sync_status === 'syncing' ? 'none' : undefined }}>
                    {annotations.filter(a => a.status !== 'removed').map(a => {
                      const info = enrichAnnotation(a);
                      return (
                        <div
                          key={a.id}
                          style={{
                            border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
                            background: activeAnnotationId === a.id ? '#fdf2f8' : '#fff',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => void jumpToAnnotation(a)}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>{info.title}</span>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                              {info.severity ? (
                                <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: RISK_SEVERITY_BG[info.severity], color: RISK_SEVERITY_TEXT[info.severity] }}>
                                  {RISK_SEVERITY_LABEL[info.severity] || info.severity}
                                </span>
                              ) : null}
                              <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: ANNOTATION_SOURCE_BG[a.source], color: ANNOTATION_SOURCE_TEXT[a.source] }}>
                                {ANNOTATION_SOURCE_LABEL[a.source] || a.source}
                              </span>
                            </div>
                          </div>
                          {info.locationLabel ? <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{info.locationLabel} · {ANNOTATION_STATUS_LABEL[a.status] || a.status}</span> : (
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{ANNOTATION_STATUS_LABEL[a.status] || a.status}</span>
                          )}
                          <p style={{ fontSize: '0.78rem', color: '#334155', margin: 0, cursor: 'pointer' }} onClick={() => void jumpToAnnotation(a)}>{a.excerpt}</p>
                          {a.note ? <p style={{ fontSize: '0.74rem', color: '#64748b', margin: 0 }}>Ghi chú: {a.note}</p> : null}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {a.source === 'ai' && a.status === 'active' ? (
                              <button type="button" className="cp-btn small" disabled={annotationBusyId === a.id} onClick={() => void handleAnnotationAction(a, 'dismiss_warning')}>
                                Bỏ qua cảnh báo
                              </button>
                            ) : null}
                            {a.status === 'active' ? (
                              <button type="button" className="cp-btn small" disabled={annotationBusyId === a.id} onClick={() => void handleAnnotationAction(a, 'remove_highlight')}>
                                Xoá Highlight
                              </button>
                            ) : null}
                            {a.note ? (
                              <button type="button" className="cp-btn small" disabled={annotationBusyId === a.id} onClick={() => void handleAnnotationAction(a, 'clear_note')}>
                                Xoá ghi chú
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(rows || []).map(row => (
                  <button
                    key={row.field}
                    type="button"
                    onClick={() => jumpToExcerpt(row.sourceExcerpt, row.highlightPage, row.field)}
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
                        onClick={() => jumpToExcerpt(c.sourceExcerpt || c.excerpt, c.highlightPage, c.field)}
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

              {editStatus?.pendingAmendments && editStatus.pendingAmendments.length > 0 ? (
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                  <b style={{ fontSize: '0.84rem' }}>📄 Bản sửa đổi — chờ duyệt</b>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    {editStatus.pendingAmendments.map((a: ContractAmendment) => (
                      <div key={a.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{a.version_id}</span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: '#fff3c4', color: '#92400e' }}>
                            {AMENDMENT_STATUS_LABEL[a.status] || a.status}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.78rem', color: '#334155', margin: 0 }}>{a.note}</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {a.status === 'draft' ? (
                            <button type="button" className="cp-btn small" disabled={amendmentActionBusyId === a.id} onClick={() => void handleAmendmentAction(a.id, 'submit')}>
                              Gửi duyệt
                            </button>
                          ) : null}
                          {a.status === 'pending_approval' && canApprove ? (
                            <>
                              <button type="button" className="cp-btn small primary" disabled={amendmentActionBusyId === a.id} onClick={() => void handleAmendmentAction(a.id, 'approve')}>
                                Duyệt
                              </button>
                              <button type="button" className="cp-btn small" disabled={amendmentActionBusyId === a.id} onClick={() => void handleAmendmentAction(a.id, 'reject')}>
                                Từ chối
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.72rem', color: '#9a3412', margin: '6px 0 0' }}>
                    ⚠ Hợp đồng đã ký — bản sửa đổi này CHƯA phải nguồn hiệu lực. AI Review/viewer mặc định vẫn dùng bản đã ký cho tới khi được duyệt.
                  </p>
                </div>
              ) : null}

              {showRerunBanner ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: '0.78rem', color: '#1d4ed8' }}>Nội dung vừa thay đổi — kết quả AI Review cũ đã cũ (stale).</span>
                  <button type="button" className="cp-btn small primary" onClick={() => { setShowRerunBanner(false); void runReview(); }}>Chạy lại AI Review</button>
                </div>
              ) : null}

              {activeExcerpt ? (
                <div className="cp-card" style={{ background: '#f8fafc', fontSize: '0.78rem', color: '#334155' }}>
                  <b style={{ fontSize: '0.72rem', color: '#64748b' }}>Trích dẫn trong hợp đồng:</b>
                  <p style={{ margin: '4px 0 0' }}>{activeExcerpt}</p>
                </div>
              ) : null}
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
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
        </>
      ) : null}

      {showAmendmentModal ? createPortal(
        <div className="crm-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !savingVersion) setShowAmendmentModal(false); }}>
          <div className="crm-modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 520 }}>
            <header className="crm-modal-header">
              <div>
                <h2 className="crm-modal-title">Tạo bản phụ lục / sửa đổi</h2>
                <p className="crm-modal-subtitle">
                  Hợp đồng này đã ký — phiên bản mới sẽ là 1 bản phụ lục/sửa đổi ở trạng thái NHÁP, cần được duyệt
                  trước khi trở thành nguồn hiệu lực. Bản gốc đã ký KHÔNG bị thay thế.
                </p>
              </div>
              <button type="button" className="crm-modal-close" onClick={() => setShowAmendmentModal(false)} disabled={savingVersion} aria-label="Đóng">×</button>
            </header>
            <div className="crm-modal-body">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
                Ghi chú lý do sửa đổi *
                <textarea
                  value={amendmentNoteDraft} onChange={e => setAmendmentNoteDraft(e.target.value)} rows={4} required
                  style={{ fontWeight: 400, padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
                  placeholder="VD: Gia hạn thời gian nghiệm thu từ 03 ngày lên 05 ngày theo yêu cầu khách hàng."
                />
              </label>
              {saveVersionError ? <p style={{ fontSize: '0.78rem', color: '#b91c1c' }}>{saveVersionError}</p> : null}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px 16px' }}>
              <button type="button" className="cp-btn small" disabled={savingVersion} onClick={() => setShowAmendmentModal(false)}>Huỷ</button>
              <button
                type="button" className="cp-btn primary small" disabled={savingVersion || !amendmentNoteDraft.trim()}
                onClick={() => void handleSaveVersion({ note: amendmentNoteDraft.trim() })}
              >
                {savingVersion ? 'Đang lưu…' : 'Xác nhận tạo bản phụ lục'}
              </button>
            </footer>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
