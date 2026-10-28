'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { seedingContractRepository } from '../repositories/SeedingContractRepository';
import { contractStatusClass, contractStatusLabel, CONTRACT_STATUS_TRANSITIONS, extractPaymentTermsFromClauses } from '../constants/contractConfig';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import type { Contract, ContractClause, ContractStatus } from '../types';
import { CurrencyInput } from '@/components/CurrencyInput';
import { seedingQuoteRepository } from '@/modules/quotes';
import { ContractAIWizard } from '@/modules/crm/integrations/contracts/ContractAIWizard';
import {
  docxFromClauses, fetchVersionBlob, getContractReadiness, importContractDriveDocument, listContractActivity, listContractVersionsFull,
  runVersionRisk, saveBlobAs, saveContractVersionFull, uploadContractDocument,
} from '../repositories/contractDocs';
import { ContractDocumentViewer } from './ContractDocumentViewer';
import { ContractAiReviewPanel } from './ContractAiReviewPanel';
import type { ActivityEntry, DocVersion, Readiness } from '../repositories/contractDocs';
import { base64ToBlob } from '../repositories/contractDocs';
import '@/modules/crm/styles/copilot.css';
import { useLayeredDrawerClose } from '@/modules/crm/hooks/useLayeredDrawerClose';
import { UnsavedChangesDialog } from '@/modules/crm/components/UnsavedChangesDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type Tab = 'overview' | 'docs' | 'risk' | 'aiReviewV2' | 'approval' | 'history';

const FLOW: ContractStatus[] = ['draft', 'pending_legal', 'pending_signature', 'signed', 'active', 'completed'];
const ACTION_LABELS: Record<string, string> = {
  created: 'Tạo hợp đồng', updated: 'Cập nhật thông tin', document_version_saved: 'Lưu phiên bản tài liệu', risk_analyzed: 'AI kiểm tra rủi ro',
  'approval:pending_legal': 'Gửi pháp chế duyệt', 'approval:pending_signature': 'Pháp chế duyệt → chờ ký',
};

function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action.startsWith('status_changed:')) return `Đổi trạng thái → ${contractStatusLabel(action.split(':')[1])}`;
  if (action.startsWith('approval:')) return `Duyệt/ký → ${contractStatusLabel(action.split(':')[1])}`;
  return action;
}

function when(v?: string | null) {
  return v ? new Date(v).toLocaleString('vi-VN') : '—';
}

export type ContractDetailTab = Tab;

/** Nội dung chi tiết hợp đồng DÙNG CHUNG cho trang /all-platform/contracts/[id] (variant 'page') và drawer trong Customer 360 (variant 'drawer'). */
export function ContractDetailContent({
  contractId, variant = 'page', onClose, onBack, backLabel, onChanged, onDirtyChange, initialTab = 'overview', focusEdit = false, onOpenLegacyEdit,
}: {
  contractId: string;
  variant?: 'page' | 'drawer';
  onClose?: () => void;
  onBack?: () => void;
  backLabel?: string;
  /** Gọi sau mỗi thay đổi đã lưu (để danh sách bên ngoài tải lại). */
  onChanged?: () => void;
  /** Báo có dữ liệu chưa lưu (drawer cảnh báo khi đóng). */
  onDirtyChange?: (dirty: boolean) => void;
  initialTab?: Tab;
  /** Mở bằng nút "Sửa": cuộn tới khối chỉnh sửa thông tin. */
  focusEdit?: boolean;
  /** Mở form ghi nhận đầy đủ hiện có (liên hệ, file/link, nguồn…) - không đổi luồng cũ. */
  onOpenLegacyEdit?: () => void;
}) {
  const isDrawer = variant === 'drawer';
  const editCardRef = useRef<HTMLDivElement | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  // Mo thang tu nut "✦ AI Review" o danh sach hop dong (initialTab='aiReviewV2') -> tu dong chay
  // AI NGAY lan dau neu chua tung chay (xem ContractAiReviewPanel.autoRunIfMissing). Dung ref
  // (khong phai state) de KHONG bi reset ve true moi lan panel AI Review unmount/remount do doi
  // tab qua lai trong CUNG 1 lan mo chi tiet hop dong nay.
  const autoRunAiReviewRef = useRef(initialTab === 'aiReviewV2');
  const [saving, setSaving] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [paymentCollectedPercent, setPaymentCollectedPercent] = useState(0);
  const [contractValue, setContractValue] = useState<number | null>(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [quoteNumber, setQuoteNumber] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [riskBusy, setRiskBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // sửa nội dung -> phiên bản mới: mở LẠI đúng popup AI Contract Copilot Bước 3 (xem ContractAIWizard's `editVersion`
  // prop) thay vì 1 editor riêng - Sale có đủ Preview/so sánh/AI rủi ro/Legal Check như lúc soạn hợp đồng.
  const [editWizardOpen, setEditWizardOpen] = useState(false);
  // Legal Check "Xem & xử lý" bấm từ tab Rủi ro - mở wizard sửa kèm đúng điều khoản cần xem (xem openToClause).
  const [jumpClause, setJumpClause] = useState<string | null>(null);
  const pdfRef = useRef<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [generatingDoc, setGeneratingDoc] = useState(false);
  // Tai lieu: upload tu may / nhap link Google Drive co san (2026-10-27, gop y UX "hoan thien tab Tai lieu").
  const [uploadBusy, setUploadBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [docMsg, setDocMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await seedingContractRepository.getContract(contractId);
      setContract(data);
      setClauses(data.clauses);
      setProgressPercent(data.progressPercent);
      setPaymentCollectedPercent(data.paymentCollectedPercent);
      setContractValue(data.contractValue);
      setStartDate(data.startDate || '');
      setEndDate(data.endDate || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được hợp đồng.');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  const loadVersions = useCallback(async () => {
    try {
      const v = await listContractVersionsFull(contractId);
      setVersions(v);
      setSelected(prev => (prev && v.some(x => x.version === prev) ? prev : v.length ? v[v.length - 1].version : null));
    } catch { setVersions([]); }
  }, [contractId]);

  const loadActivity = useCallback(() => { listContractActivity(contractId).then(setActivity).catch(() => setActivity([])); }, [contractId]);
  const loadReadiness = useCallback(() => { getContractReadiness(contractId).then(setReadiness).catch(() => setReadiness(null)); }, [contractId]);
  const [confirmRepBusy, setConfirmRepBusy] = useState(false);
  // Xac nhan nhanh ngay tren danh sach "Dieu kien gui duyet" (cung 1 action "confirm_representative" nhu Step-3 cua
  // AI Copilot wizard - trang chi tiet hop dong nay la noi THU HAI render cung checklist nen can wiring rieng).
  async function confirmRepresentative() {
    setConfirmRepBusy(true); setError('');
    try {
      await seedingContractRepository.updateContract(contractId, { representativeConfirmed: true });
      loadReadiness();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xác nhận được người đại diện.');
    } finally {
      setConfirmRepBusy(false);
    }
  }

  useEffect(() => { void load(); void loadVersions(); loadActivity(); loadReadiness(); }, [load, loadVersions, loadActivity, loadReadiness]);

  useEffect(() => {
    if (!contract?.quoteId) { setQuoteNumber(null); return; }
    let alive = true;
    seedingQuoteRepository.getQuote(contract.quoteId).then(q => { if (alive) setQuoteNumber(q.quoteNumber); }).catch(() => { if (alive) setQuoteNumber(null); });
    return () => { alive = false; };
  }, [contract?.quoteId]);

  // PDF của ĐÚNG phiên bản đang chọn (chuyển từ chính DOCX đó)
  useEffect(() => {
    if (pdfRef.current) { URL.revokeObjectURL(pdfRef.current); pdfRef.current = null; }
    setPdfUrl(null); setPdfError('');
    if (!selected || tab !== 'docs') return undefined;
    let alive = true;
    fetchVersionBlob(contractId, selected, 'pdf').then(b => { if (alive) { pdfRef.current = URL.createObjectURL(b); setPdfUrl(pdfRef.current); } })
      .catch(err => { if (alive) setPdfError(err instanceof Error ? err.message : 'Không xem được PDF.'); });
    return () => { alive = false; };
  }, [contractId, selected, tab, versions.length]);
  useEffect(() => () => { if (pdfRef.current) URL.revokeObjectURL(pdfRef.current); }, []);

  const current = useMemo(() => versions.find(v => v.version === selected) || null, [versions, selected]);
  const latest = versions.length ? versions[versions.length - 1] : null;
  const hasDocs = versions.length > 0;
  // Fix bug mapping tai lieu (2026-10-23, yeu cau sep): hop dong "ghi nhan ngoai" (source=external)
  // chi co `contract.fileUrl` (link/file nguoi dung tu nhap), KHONG BAO GIO co "version" that trong
  // bucket contract-documents (versions chi ton tai qua luong AI Copilot/tao tai lieu trong CRM) -
  // truoc day hasDocs=false khien ca badge/tab deu bao sai "Chua co tai lieu" du fileUrl co gia tri
  // that. Coi fileUrl nhu 1 nguon tai lieu hop le rieng, DOC LAP voi `versions`/`hasDocs`.
  const hasExternalFile = !hasDocs && !!contract?.fileUrl;

  async function saveInfo() {
    if (!contract) return;
    setSaving(true); setMsg('');
    try {
      const patch: Parameters<typeof seedingContractRepository.updateContract>[1] = {
        progressPercent, paymentCollectedPercent, contractValue: contractValue ?? 0, startDate: startDate || null, endDate: endDate || null,
      };
      if (!hasDocs) { patch.clauses = clauses; patch.paymentTerms = extractPaymentTermsFromClauses(clauses); }   // chỉ hợp đồng legacy (chưa có tài liệu) sửa điều khoản kiểu cũ
      const updated = await seedingContractRepository.updateContract(contract.id, patch);
      setContract(updated); setMsg('Đã lưu thông tin.'); loadActivity(); loadReadiness(); onChanged?.();
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Không lưu được thay đổi.'); } finally { setSaving(false); }
  }

  async function changeStatus(status: string, confirmLabel?: string) {
    if (!contract) return;
    if (confirmLabel && !window.confirm(`Xác nhận: ${confirmLabel}?`)) return;
    setMsg(''); setStatusBusy(status);
    try {
      const updated = await seedingContractRepository.updateStatus(contract.id, status, undefined, latest?.version);
      setContract(updated); loadActivity(); loadReadiness(); onChanged?.(); setMsg(`✓ Đã chuyển sang "${contractStatusLabel(status)}".`);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Không đổi được trạng thái.'); loadReadiness(); setTab('approval'); } finally { setStatusBusy(null); }
  }

  async function analyze(version: number) {
    setRiskBusy(true); setMsg('');
    try { await runVersionRisk(contractId, version); await loadVersions(); loadActivity(); loadReadiness(); } catch (err) { setMsg(err instanceof Error ? err.message : 'AI kiểm tra rủi ro thất bại.'); } finally { setRiskBusy(false); }
  }

  async function dl(version: number, fmt: 'docx' | 'pdf') {
    try { saveBlobAs(await fetchVersionBlob(contractId, version, fmt), `${(contract?.contractNumber || 'hop-dong').replace(/[\\/:*?"<>|]/g, '-')}-v${version}.${fmt}`); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Không tải được tệp.'); }
  }

  /** In PDF ĐÚNG file đã lưu (không in HTML trang CRM): mở PDF trong tab mới rồi gọi print() của chính tab đó. */
  async function printVersion(version: number) {
    try {
      const url = URL.createObjectURL(await fetchVersionBlob(contractId, version, 'pdf'));
      const win = window.open(url, '_blank');
      if (!win) { setMsg('Trình duyệt chặn mở tab mới — hãy cho phép popup để in PDF.'); return; }
      win.addEventListener('load', () => { win.print(); setTimeout(() => URL.revokeObjectURL(url), 60000); });
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Không mở được PDF để in.'); }
  }

  /** Hợp đồng cũ (legacy) có nội dung điều khoản nhưng CHƯA có DOCX/PDF: tạo tài liệu thật (không phải bản thay thế âm thầm — người dùng bấm rõ
   * ràng) rồi lưu thành phiên bản v1 bằng đúng document engine hiện có (LibreOffice), từ đó có đủ Xem trước/In/Tải như hợp đồng mới. */
  async function generateDocFromClauses() {
    if (!contract) return;
    setGeneratingDoc(true); setMsg('');
    try {
      const doc = await docxFromClauses({
        title: contract.title, contractNumber: contract.contractNumber, clauses, dealId: contract.dealId || undefined,
        quoteId: contract.quoteId || undefined, customerId: contract.customerId || undefined, contractType: contract.templateType,
      });
      const v = await saveContractVersionFull(contract.id, doc.docxBase64, { contractNumber: contract.contractNumber, source: 'manual-edit', note: 'Tạo tài liệu DOCX/PDF từ nội dung điều khoản cũ' });
      await loadVersions(); setSelected(v.version); loadActivity(); loadReadiness(); onChanged?.();
      setMsg(`✓ Đã tạo tài liệu v${v.version} từ nội dung điều khoản.${doc.pdfError ? ` (PDF: ${doc.pdfError})` : ''}`);
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Không tạo được tài liệu.'); } finally { setGeneratingDoc(false); }
  }

  async function onUploadFile(file: File) {
    setUploadBusy(true); setDocMsg('');
    try {
      await uploadContractDocument(contractId, file);
      setDocMsg('✓ Đã tải file lên, đang xếp lịch đồng bộ Drive.');
      await load(); onChanged?.();
    } catch (err) { setDocMsg(err instanceof Error ? err.message : 'Không tải file lên được.'); } finally { setUploadBusy(false); }
  }

  async function onImportDrive() {
    if (!importUrl.trim()) return;
    setImportBusy(true); setDocMsg('');
    try {
      await importContractDriveDocument(contractId, importUrl.trim());
      setDocMsg('✓ Đã nhập file từ Google Drive, đang xếp lịch đồng bộ.');
      setImportUrl(''); setImportOpen(false);
      await load(); onChanged?.();
    } catch (err) { setDocMsg(err instanceof Error ? err.message : 'Không nhập được file từ Drive.'); } finally { setImportBusy(false); }
  }

  // Đóng popup sửa (dù Lưu hay Hủy) -> nạp lại danh sách phiên bản rồi NHẢY THẲNG tới phiên bản mới nhất (nếu wizard
  // vừa lưu thêm 1 phiên bản) - không dùng loadVersions() thường (nó CỐ Ý giữ nguyên lựa chọn cũ nếu còn tồn tại).
  async function onEditWizardClosed() {
    setEditWizardOpen(false);
    const v = await listContractVersionsFull(contractId).catch(() => null);
    if (v) { setVersions(v); setSelected(v.length ? v[v.length - 1].version : null); }
    loadActivity(); loadReadiness(); onChanged?.();
  }

  const infoDirty = !!contract && (
    (contractValue ?? 0) !== contract.contractValue || progressPercent !== contract.progressPercent || paymentCollectedPercent !== contract.paymentCollectedPercent
    || (startDate || '') !== (contract.startDate || '') || (endDate || '') !== (contract.endDate || '')
    || (versions.length === 0 && JSON.stringify(clauses) !== JSON.stringify(contract.clauses))
  );
  // Sửa tài liệu giờ diễn ra trong popup wizard RIÊNG (tự quản lý xác nhận trước khi mất dữ liệu của chính nó) -
  // trang này chỉ còn cần theo dõi "dirty" cho phần Thông tin ở tab Tổng quan.
  const dirty = infoDirty;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (focusEdit && !loading && tab === 'overview') editCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusEdit, loading, tab]);

  {/* "Bam hop dong 1 sang 2 thi k dong sidebar chi doi content nhu lead" (2026-10-23,
   * yeu cau sep): truoc day loading/error fallback LUON dung className "contract-detail-page"
   * (layout trang doc lap, KHONG khop khung .cd-panel) bat ke variant - khi doi contractId
   * (key={contractId} tai ContractDetailDrawer lam remount component nay), panel tam thoi
   * thu nho/sup lai theo layout trang trong luc "Dang tai hop dong..." hien ra, nhin y het
   * nhu dong roi mo lai du .cd-backdrop/.cd-panel (phan tu cha) khong he unmount. Fix: dung
   * dung className "cd-root" (giong nhanh binh thuong ben duoi) khi la drawer, giu nguyen
   * khung/chieu rong panel on dinh trong luc tai du lieu hop dong moi. */}
  if (loading) return <main className={isDrawer ? 'cd-root' : 'contract-detail-page'}><section className="contract-state">Đang tải hợp đồng...</section></main>;
  if (error || !contract) return <main className={isDrawer ? 'cd-root' : 'contract-detail-page'}><section className="contract-state contract-state--error">{error || 'Không tìm thấy hợp đồng.'}</section></main>;

  const nextStatuses = CONTRACT_STATUS_TRANSITIONS[contract.status] || [];
  // Nút chính nổi bật theo ĐÚNG trạng thái hiện tại (không hiện mọi nút ở mọi trạng thái):
  // draft -> "Gửi pháp chế duyệt"; pending_legal -> "Chuyển chờ ký" (chỉ xuất hiện khi đã qua bước gửi duyệt, không cho nhảy cóc từ draft).
  // CONTRACT_STATUS_TRANSITIONS['draft'] kỹ thuật vẫn cho phép ép thẳng sang pending_signature (hợp đồng ngoài ký sẵn) nhưng KHÔNG hiện làm
  // nút chính ở đây để tránh lẫn với luồng duyệt thật - vẫn gọi được qua danh sách "nút phụ" bên dưới nếu cần.
  const primaryStatus = contract.status === 'draft' ? 'pending_legal' : contract.status === 'pending_legal' ? 'pending_signature' : null;
  const secondaryStatuses = nextStatuses.filter(s => s !== primaryStatus && !(s === 'pending_signature' && contract.status !== 'pending_legal'));
  // Danh sách đúng trạng thái hiện tại cho phép chuyển tới (áp dụng NHẤT QUÁN ở cả header và tab "Phê duyệt & ký" - không hiện "Chuyển chờ ký" nhảy cóc từ draft).
  const visibleNextStatuses = [...(primaryStatus ? [primaryStatus] : []), ...secondaryStatuses];
  const typeLabel = ({ service: 'Hợp đồng cung cấp dịch vụ CNTT', principle: 'Hợp đồng nguyên tắc', marketing: 'Hợp đồng dịch vụ Marketing' } as Record<string, string>)[contract.templateType] || contract.templateType;
  const customerName = contract.dealCustomerName || contract.manualCustomerName || '—';
  const approvals = activity.filter(a => a.action.startsWith('approval:'));
  const valueMismatch = !!contract.quoteId && readiness?.checks.find(c => c.key === 'value' && !c.ok);

  return (
    <main className={isDrawer ? 'cd-root' : 'contract-detail-page'} data-testid="contract-detail">
      <div className={isDrawer ? 'cd-head' : undefined}>
      <header className="contract-detail-header" style={{ alignItems: 'flex-start', ...(isDrawer ? { margin: 0, padding: 0 } : {}) }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {!onClose && onBack ? <button type="button" className="contract-button contract-button--secondary" onClick={onBack} style={{ marginBottom: '0.6rem' }}>{backLabel || '← Danh sách hợp đồng'}</button> : null}
          {isDrawer ? (
            <h2 className="cd-title" data-testid="drawer-contract-title" title={contract.title}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</h2>
          ) : null}
          <h1 data-testid="contract-number" style={isDrawer ? { fontSize: '0.95rem', margin: '2px 0 0', color: '#475569' } : undefined}>{contract.contractNumber}</h1>
          {/* Dòng meta: KHÔNG lặp lại contract.title (đã hiện ở <h2> ngay trên khi isDrawer) -
           * trước đây lặp lại title + nhiều phần nối chuỗi dài gây rớt dòng xấu (sếp báo lỗi 2026-10-27). */}
          <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={`${contract.title} · ${formatVnd(contract.contractValue)}${customerName !== '—' ? ` · ${customerName}` : ''}${contract.ownerName ? ` · Phụ trách: ${contract.ownerName}` : ''}`}>
            {!isDrawer ? `${contract.title} · ` : ''}{formatVnd(contract.contractValue)}{customerName !== '—' ? ` · ${customerName}${contract.dealCompanyName ? ` (${contract.dealCompanyName})` : ''}` : ''}{contract.ownerName ? ` · Phụ trách: ${contract.ownerName}` : ''}
          </p>
          {isDrawer ? <span className={`contract-badge ${contractStatusClass(contract.status)}`} data-testid="drawer-status" style={{ display: 'inline-block', marginTop: 6 }}>{contractStatusLabel(contract.status)}</span> : null}
          <div style={{ display: isDrawer ? 'none' : 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }} data-testid="contract-status-flow">
            {FLOW.map(s => (
              <span key={s} className={`contract-badge ${s === contract.status ? contractStatusClass(s) : ''}`} data-testid={`status-chip-${s}`}
                style={s === contract.status ? { fontWeight: 800 } : { opacity: 0.45, background: '#f1f5f9', color: '#475569' }}>{contractStatusLabel(s)}</span>
            ))}
            {!FLOW.includes(contract.status) ? <span className={`contract-badge ${contractStatusClass(contract.status)}`}>{contractStatusLabel(contract.status)}</span> : null}
          </div>
        </div>
        <div className="contract-head-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {primaryStatus ? (
            <button type="button" className="cp-btn primary" data-testid={`action-${primaryStatus}`} disabled={!!statusBusy}
              onClick={() => void changeStatus(primaryStatus, primaryStatus === 'pending_legal' ? 'Gửi pháp chế duyệt' : 'Chuyển sang chờ ký')}>
              {statusBusy === primaryStatus ? 'Đang xử lý…' : primaryStatus === 'pending_legal' ? 'Gửi pháp chế duyệt' : 'Chuyển chờ ký'}
            </button>
          ) : null}
          {secondaryStatuses.map(s => (
            <button key={s} type="button" className="cp-btn" data-testid={`action-${s}`} disabled={!!statusBusy}
              onClick={() => void changeStatus(s, `Chuyển sang "${contractStatusLabel(s)}"`)}>
              {statusBusy === s ? 'Đang xử lý…' : `→ ${contractStatusLabel(s)}`}
            </button>
          ))}
          {hasDocs && latest ? (
            <>
              <button type="button" className="cp-btn" data-testid="action-preview-pdf" onClick={() => { setTab('docs'); setSelected(latest.version); }}>👁 Xem trước PDF</button>
              {/* Gom "In PDF"/"Tải DOCX"/"Tải PDF" vào 1 dropdown - trước đây 4 nút rời làm header
               * tràn/xuống dòng xấu khi có thêm "Mở thư mục Drive" (sếp báo lỗi 2026-10-27). Giữ
               * nguyên đủ 3 hành động, chỉ gọn giao diện. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="cp-btn" data-testid="action-downloads-menu">⬇ Tải xuống ▾</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="action-print-pdf" onClick={() => void printVersion(latest.version)}>🖶 In PDF</DropdownMenuItem>
                  <DropdownMenuItem data-testid="action-download-docx" onClick={() => void dl(latest.version, 'docx')}>↓ Tải DOCX</DropdownMenuItem>
                  <DropdownMenuItem data-testid="action-download-pdf" onClick={() => void dl(latest.version, 'pdf')}>↓ Tải PDF</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : hasExternalFile ? (
            <button type="button" className="cp-btn" data-testid="action-view-external-doc" onClick={() => setTab('docs')}>👁 Xem tài liệu</button>
          ) : (
            <span data-testid="action-no-doc" style={{ fontSize: '0.78rem', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px' }}>Chưa có tài liệu</span>
          )}
          {contract.driveFolderId ? (
            <a className="cp-btn" href={`https://drive.google.com/drive/folders/${contract.driveFolderId}`} target="_blank" rel="noreferrer" title="Mở thư mục hợp đồng này trên Google Drive">📁 Mở thư mục Drive</a>
          ) : null}
          {isDrawer && onClose ? <button type="button" className="cd-close" aria-label="Đóng" data-testid="drawer-close" onClick={onClose}>✕</button> : null}
        </div>
      </header>

      <div className="cp-tabs" role="tablist" style={{ padding: 0, marginTop: 8, borderBottom: isDrawer ? 0 : undefined }}>
        {([['overview', 'Tổng quan'], ['docs', `Tài liệu (${versions.length || (hasExternalFile ? 1 : 0)})`], ['risk', 'AI rủi ro'], ['aiReviewV2', 'Đối chiếu báo giá (AI)'], ['approval', 'Phê duyệt & ký'], ['history', 'Lịch sử']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" data-testid={`detail-tab-${id}`} className={`cp-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      </div>
      <div className={isDrawer ? 'cd-body' : undefined}>
      {dirty ? <p data-testid="detail-dirty" style={{ margin: '8px 0 0', fontSize: '0.78rem', color: '#9a3412' }}>Có thay đổi chưa lưu.</p> : null}
      {msg ? <p data-testid="detail-msg" style={{ margin: '8px 0 0', fontSize: '0.82rem', color: /^(Đã|✓)/.test(msg) ? '#16845d' : '#b45309' }}>{msg}</p> : null}

      {/* ───────── Tổng quan ───────── */}
      {tab === 'overview' ? (
        <section style={{ display: 'grid', gap: 14, marginTop: 12 }} data-testid="detail-overview">
          {/* Dashboard tong quan (2026-10-27, redesign theo gop y UX) - nhom ro 3 khoi: so
           * lieu/tien do (progress bar THAT, khong phai text), thong tin co ban, thoi gian thuc
           * hien - thay vi 1 danh sach dai 11 dong nhu truoc. KHONG doi logic/field nao, chi
           * sap xep lai bo cuc hien thi. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="cp-card">
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>GIÁ TRỊ HỢP ĐỒNG</span>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#16845d', marginTop: 4 }}>{formatVnd(contract.contractValue)} {contract.currency}</div>
              {valueMismatch ? <small style={{ color: '#b45309' }}>Khác tổng báo giá đã chốt</small> : null}
            </div>
            <div className="cp-card">
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>TIẾN ĐỘ THỰC HIỆN</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: '#be1e4b', borderRadius: 999 }} />
                </div>
                <b style={{ fontSize: '0.85rem' }}>{progressPercent}%</b>
              </div>
            </div>
            <div className="cp-card">
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>ĐÃ THU THANH TOÁN</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                  <div style={{ width: `${paymentCollectedPercent}%`, height: '100%', background: '#16845d', borderRadius: 999 }} />
                </div>
                <b style={{ fontSize: '0.85rem' }}>{paymentCollectedPercent}%</b>
              </div>
            </div>
            <div className="cp-card">
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>TRẠNG THÁI</span>
              <div style={{ marginTop: 6 }}><span className={`contract-badge ${contractStatusClass(contract.status)}`}>{contractStatusLabel(contract.status)}</span></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
            <div className="cp-card">
              <b style={{ fontSize: '0.9rem' }}>Thông tin hợp đồng</b>
              <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,150px) minmax(0,1fr)', gap: '6px 12px', margin: '10px 0 0', fontSize: '0.85rem' }}>
                <dt style={{ color: '#64748b' }}>Mã hợp đồng</dt><dd style={{ margin: 0 }}>{contract.contractNumber}</dd>
                <dt style={{ color: '#64748b' }}>Tên hợp đồng</dt><dd style={{ margin: 0 }}>{contract.title}</dd>
                <dt style={{ color: '#64748b' }}>Loại hợp đồng</dt><dd style={{ margin: 0 }} data-testid="detail-type">{typeLabel}</dd>
                <dt style={{ color: '#64748b' }}>Khách hàng</dt><dd style={{ margin: 0 }}>{customerName}{contract.dealCompanyName ? ` (${contract.dealCompanyName})` : ''}</dd>
                <dt style={{ color: '#64748b' }}>Deal</dt><dd style={{ margin: 0 }}>{contract.dealId ? contract.dealId.slice(0, 8) : '—'}</dd>
                <dt style={{ color: '#64748b' }}>Báo giá</dt><dd style={{ margin: 0 }}>{quoteNumber || (contract.quoteId ? 'Đang tải…' : '—')}</dd>
                <dt style={{ color: '#64748b' }}>Người phụ trách</dt><dd style={{ margin: 0 }}>{contract.ownerName || '—'}</dd>
                <dt style={{ color: '#64748b' }}>Nguồn</dt><dd style={{ margin: 0 }}>{contract.source === 'external' ? 'Ghi nhận hợp đồng có sẵn' : contract.aiGenerated ? 'Tạo bằng AI Copilot' : 'Tạo trong CRM'}</dd>
              </dl>
            </div>
            <div className="cp-card">
              <b style={{ fontSize: '0.9rem' }}>Thời gian & tài liệu</b>
              <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,150px) minmax(0,1fr)', gap: '6px 12px', margin: '10px 0 0', fontSize: '0.85rem' }}>
                <dt style={{ color: '#64748b' }}>Ngày ký</dt><dd style={{ margin: 0 }}>{contract.signedAt ? new Date(contract.signedAt).toLocaleDateString('vi-VN') : '—'}</dd>
                <dt style={{ color: '#64748b' }}>Bắt đầu</dt><dd style={{ margin: 0 }}>{startDate ? new Date(startDate).toLocaleDateString('vi-VN') : '—'}</dd>
                <dt style={{ color: '#64748b' }}>Kết thúc</dt><dd style={{ margin: 0 }}>{endDate ? new Date(endDate).toLocaleDateString('vi-VN') : '—'}</dd>
                <dt style={{ color: '#64748b' }}>Tài liệu</dt><dd style={{ margin: 0 }}>{latest ? `v${latest.version} · ${when(latest.createdAt)}${latest.createdByName ? ` · ${latest.createdByName}` : ''}` : hasExternalFile ? 'Có file/link đã lưu (xem ở tab Tài liệu)' : 'Chưa có tài liệu DOCX/PDF'}</dd>
                <dt style={{ color: '#64748b' }}>Drive</dt><dd style={{ margin: 0 }}>{contract.driveSyncStatus === 'synced' ? 'Đã lưu Drive' : contract.driveSyncStatus === 'error' ? 'Lỗi đồng bộ' : contract.driveSyncStatus === 'pending' ? 'Đang đồng bộ' : 'Chưa có file'}</dd>
              </dl>
            </div>
          </div>

          <div className="cp-card" ref={editCardRef} data-testid="detail-edit-card" style={{ display: 'grid', gap: 10, ...(focusEdit ? { borderColor: '#be1e4b', boxShadow: '0 0 0 2px #fdf2f8' } : {}) }}>
            <b style={{ fontSize: '0.9rem' }}>Chỉnh sửa quản lý thực hiện</b>
            <div className="cp-grid3">
              <label className="cp-field"><span>Giá trị hợp đồng</span><CurrencyInput value={contractValue} onChange={setContractValue} style={{ width: '100%', height: '2.4rem', borderRadius: '0.6rem', border: '1px solid #cbd5e1', padding: '0 0.6rem' }} />
                {valueMismatch ? <small style={{ color: '#b45309' }}>Khác tổng báo giá — tài liệu đã lưu không tự đổi theo.</small> : null}</label>
              <label className="cp-field"><span>Bắt đầu</span><input type="date" className="cp-input" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
              <label className="cp-field"><span>Kết thúc</span><input type="date" className="cp-input" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
              <label className="cp-field"><span>Tiến độ thực hiện (%)</span><input type="number" min={0} max={100} className="cp-input" value={progressPercent} onChange={e => setProgressPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></label>
              <label className="cp-field"><span>Đã thu thanh toán (%)</span><input type="number" min={0} max={100} className="cp-input" value={paymentCollectedPercent} onChange={e => setPaymentCollectedPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></label>
            </div>
            <small style={{ color: '#64748b' }}>Các thông tin này phục vụ quản lý, không làm thay đổi tài liệu hợp đồng đã lưu. Muốn đổi nội dung pháp lý: tab Tài liệu → tạo phiên bản mới.</small>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="cp-btn primary" disabled={saving || !infoDirty} data-testid="detail-save-info" onClick={() => void saveInfo()}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
              {onOpenLegacyEdit ? <button type="button" className="cp-btn" data-testid="detail-legacy-edit" onClick={onOpenLegacyEdit}>Sửa thông tin ghi nhận (liên hệ, file/link, nguồn…)</button> : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* ───────── Tài liệu ───────── */}
      {tab === 'docs' ? (
        <section style={{ display: 'grid', gap: 14, marginTop: 12 }} data-testid="detail-docs">
          {contract.aiHighlight ? (
            <div className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#fdf2f8', borderColor: '#fbcfe8' }} data-testid="ai-highlight-summary">
              <div>
                <b style={{ fontSize: '0.85rem' }}>✦ Bản AI Highlight đã lưu</b>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  {contract.aiHighlight.fileName} · lưu lúc {contract.aiHighlight.confirmedAt ? when(contract.aiHighlight.confirmedAt) : '—'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="cp-btn small" onClick={() => setTab('aiReviewV2')}>Xem trong AI Review</button>
                {contract.aiHighlight.driveFileId ? (
                  <a className="cp-btn small" href={`https://drive.google.com/file/d/${contract.aiHighlight.driveFileId}/view`} target="_blank" rel="noreferrer">↗ Mở trên Drive</a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="cp-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }} data-testid="doc-upload-import-bar">
            <b style={{ fontSize: '0.84rem' }}>Quản lý file gốc</b>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onUploadFile(f); }} />
            <button type="button" className="cp-btn small" disabled={uploadBusy} data-testid="doc-upload-btn" onClick={() => fileInputRef.current?.click()}>
              {uploadBusy ? 'Đang tải lên…' : '⬆ Tải file lên'}
            </button>
            <button type="button" className="cp-btn small" data-testid="doc-import-drive-toggle" onClick={() => setImportOpen(o => !o)}>📥 Nhập từ Google Drive</button>
            {contract.driveFolderId ? (
              <a className="cp-btn small" href={`https://drive.google.com/drive/folders/${contract.driveFolderId}`} target="_blank" rel="noreferrer">📁 Mở thư mục Drive</a>
            ) : null}
            {importOpen ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', marginTop: 4 }}>
                <input className="cp-input" style={{ flex: 1, minWidth: 220 }} placeholder="Dán link Google Docs/Drive của file đã có…"
                  value={importUrl} onChange={e => setImportUrl(e.target.value)} data-testid="doc-import-drive-input" />
                <button type="button" className="cp-btn primary small" disabled={importBusy || !importUrl.trim()} data-testid="doc-import-drive-submit" onClick={() => void onImportDrive()}>
                  {importBusy ? 'Đang kiểm tra…' : 'Nhập'}
                </button>
              </div>
            ) : null}
            {docMsg ? <small style={{ width: '100%', color: /^✓/.test(docMsg) ? '#166534' : '#b45309' }} data-testid="doc-upload-import-msg">{docMsg}</small> : null}
            <small style={{ width: '100%', color: '#94a3b8' }}>File tải lên tự động đồng bộ vào Shared Drive theo đúng thư mục hợp đồng. Google Docs/Drive riêng tư cần được chia sẻ cho {`markee-recruitment-bot@markeeai.iam.gserviceaccount.com`} trước khi nhập.</small>
          </div>

          {/* Google OAuth import (2026-10-27) - DA TAT theo yeu cau sep ("bo chuc nang, khong
           * xai nua") sau khi gap loi InsecureTransportError luc test tren dev. Code backend/FE
           * (google_oauth_service.py, router, repo functions, migration 196) VAN GIU NGUYEN
           * (khong xoa) - chi bo giao dien va khong goi API nua, de bat lai de dang neu can sau
           * nay. Muon dung lai Google Docs/Drive rieng tu: dung nut "Nhap tu Google Drive" (dua
           * tren check_file_readable cua SERVICE ACCOUNT, khong qua OAuth) hoac "Tai file len". */}

          {hasExternalFile ? (
            <ContractDocumentViewer contractId={contractId} fileUrl={contract.fileUrl as string} fileName={contract.title} />
          ) : !hasDocs ? (
            <div className="cp-card" data-testid="legacy-notice" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
              <b style={{ fontSize: '0.88rem', color: '#9a3412' }}>Chưa có tài liệu DOCX/PDF{contract.aiGenerated ? ' — hợp đồng tạo bằng AI Copilot nhưng chưa từng lưu phiên bản tài liệu nào' : ' (hợp đồng cũ/legacy)'}</b>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#9a3412' }}>Dưới đây là nội dung điều khoản lưu trong hệ thống (không phải DOCX/PDF thật). Hệ thống không tự tạo tài liệu thay bạn — bấm nút bên dưới để tạo tài liệu DOCX/PDF thật từ đúng nội dung này, hoặc soạn lại bằng AI Copilot.</p>
              {clauses.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Chưa có nội dung điều khoản.</p> : clauses.map((c, i) => (
                <div key={c.id || i} style={{ marginTop: 10 }}>
                  <input className="cp-input" value={c.title} onChange={e => setClauses(cur => cur.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                  <textarea className="cp-textarea" style={{ minHeight: 100, marginTop: 4 }} value={c.body} onChange={e => setClauses(cur => cur.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)))} />
                </div>
              ))}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {clauses.length > 0 ? <button type="button" className="cp-btn" disabled={saving} onClick={() => void saveInfo()}>Lưu điều khoản</button> : null}
                {clauses.length > 0 ? (
                  <button type="button" className="cp-btn primary" data-testid="generate-doc-from-clauses" disabled={generatingDoc} onClick={() => void generateDocFromClauses()}>
                    {generatingDoc ? 'Đang tạo tài liệu…' : '✦ Tạo tài liệu DOCX/PDF từ nội dung này'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="cp-card">
                <b style={{ fontSize: '0.9rem' }}>Tài liệu hợp đồng</b>
                <table className="cp-table" style={{ marginTop: 8 }} data-testid="versions-table">
                  <thead><tr><th>Phiên bản</th><th>Ngày tạo</th><th>Người tạo</th><th>Nguồn</th><th>Rủi ro</th><th /></tr></thead>
                  <tbody>
                    {[...versions].reverse().map(v => (
                      <tr key={v.version} style={v.version === selected ? { background: '#fdf2f8' } : undefined}>
                        <td><button type="button" className="cp-chip" data-testid={`version-${v.version}`} onClick={() => setSelected(v.version)}>v{v.version}{v.version === latest?.version ? ' (mới nhất)' : ''}</button></td>
                        <td>{when(v.createdAt)}</td><td>{v.createdByName || '—'}</td><td>{({ 'ai-new': 'AI soạn mới', template: 'Theo mẫu', 'manual-edit': 'Chỉnh sửa' } as Record<string, string>)[v.source || ''] || v.source || '—'}</td>
                        <td>{v.risk?.score ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="cp-btn small" data-testid={`print-pdf-${v.version}`} onClick={() => void printVersion(v.version)}>🖶 In</button>{' '}
                          <button type="button" className="cp-btn small" data-testid={`dl-docx-${v.version}`} onClick={() => void dl(v.version, 'docx')}>↓ DOCX</button>{' '}
                          <button type="button" className="cp-btn small" data-testid={`dl-pdf-${v.version}`} onClick={() => void dl(v.version, 'pdf')}>↓ PDF</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="cp-btn" data-testid="detail-new-version" disabled={!selected} onClick={() => setEditWizardOpen(true)}>✎ Sửa nội dung → tạo phiên bản mới</button>
                </div>
              </div>

              <div className="cp-card">
                <b style={{ fontSize: '0.86rem' }}>Xem tài liệu v{selected} (PDF chuyển từ đúng DOCX này)</b>
                {pdfUrl ? <iframe className="cp-pdf" style={{ marginTop: 8 }} title={`PDF v${selected}`} src={pdfUrl} data-testid="detail-pdf" /> : <p style={{ fontSize: '0.82rem', color: pdfError ? '#b45309' : '#64748b' }}>{pdfError || 'Đang tải PDF…'}</p>}
              </div>
            </>
          )}
        </section>
      ) : null}

      {/* ───────── AI rủi ro ───────── */}
      {tab === 'risk' ? (
        <section style={{ display: 'grid', gap: 12, marginTop: 12 }} data-testid="detail-risk">
          {hasDocs && current ? (
            <div className="cp-card" style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: '0.9rem' }}>Phiên bản</b>
                <select className="cp-select" style={{ width: 180 }} data-testid="risk-version" value={selected ?? ''} onChange={e => setSelected(Number(e.target.value))}>
                  {versions.map(v => <option key={v.version} value={v.version}>v{v.version}{v.version === latest?.version ? ' (mới nhất)' : ''}</option>)}
                </select>
                <button type="button" className="cp-btn" disabled={riskBusy} data-testid="detail-run-risk" onClick={() => void analyze(current.version)}>{riskBusy ? 'Đang phân tích…' : '✦ Chạy AI kiểm tra rủi ro'}</button>
              </div>
              {current.risk ? (
                <>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className="cp-score" style={{ borderColor: (current.risk.score ?? 0) >= 80 ? '#16a34a' : (current.risk.score ?? 0) >= 50 ? '#f59e0b' : '#dc2626' }} data-testid="detail-risk-score">{current.risk.score ?? '—'}</div>
                    <small style={{ color: '#64748b' }}>Phân tích phiên bản v{current.version} · {current.risk.model || 'AI'} · {when(current.risk.analyzedAt)}</small>
                  </div>
                  {current.risk.verifiedFindings && current.risk.verifiedFindings.length > 0 ? (
                    <div data-testid="detail-risk-verified" style={{ display: 'grid', gap: 4 }}>
                      <small style={{ fontWeight: 700, color: '#b91c1c' }}>✓ Đã xác minh bằng số liệu thật (không qua AI):</small>
                      {current.risk.verifiedFindings.map((f, i) => (
                        <div key={i} className="cp-finding warn" style={{ borderLeft: '3px solid #b91c1c' }}><b>⚠ {f.title}</b><div>{f.detail}</div></div>
                      ))}
                    </div>
                  ) : null}
                  {current.risk.findings.length > 0 ? <small style={{ color: '#64748b' }}>AI nhận định (chưa xác minh bằng số liệu):</small> : null}
                  {current.risk.findings.map((f, i) => (
                    <div key={i} className={`cp-finding ${f.severity}`}>
                      <b>{f.severity === 'ok' ? '✓' : '!'} {f.title}</b><div>{f.detail}</div>
                      {f.clause ? (
                        <button type="button" className="cp-btn small" style={{ marginTop: 4 }} data-testid={`detail-risk-fix-${i}`}
                          onClick={() => { setJumpClause(f.clause || null); setEditWizardOpen(true); }}>
                          Xem & xử lý →
                        </button>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : <small style={{ color: '#94a3b8' }}>Phiên bản v{current.version} chưa được phân tích (kết quả của phiên bản khác không áp dụng cho phiên bản này).</small>}
            </div>
          ) : (
            <div className="cp-card" data-testid="legacy-risk">
              <b style={{ fontSize: '0.86rem' }}>Kết quả cũ (legacy, không gắn với phiên bản tài liệu)</b>
              {contract.aiRiskScore != null ? <div style={{ margin: '8px 0' }}><span className="cp-score" style={{ width: 56, height: 56, fontSize: '1.1rem' }}>{contract.aiRiskScore}</span></div> : <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Chưa có kết quả.</p>}
              {contract.aiReview.map((f, i) => <div key={i} className={`cp-finding ${f.severity}`} style={{ marginTop: 6 }}><b>{f.title}</b><div>{f.detail}</div></div>)}
            </div>
          )}
        </section>
      ) : null}

      {/* ───────── Đối chiếu báo giá (AI) - B6, tab RIENG khong dung chung logic risk cu ───────── */}
      {tab === 'aiReviewV2' ? (
        <section style={{ marginTop: 12 }} data-testid="detail-ai-review-v2">
          <ContractAiReviewPanel contractId={contractId} driveSyncStatus={contract.driveSyncStatus} fileUrl={contract.fileUrl} contractNumber={contract.contractNumber}
            autoRunIfMissing={autoRunAiReviewRef.current} onAutoRunHandled={() => { autoRunAiReviewRef.current = false; }} />
        </section>
      ) : null}

      {/* ───────── Phê duyệt & ký (2026-10-27, redesign step-checklist) ───────── */}
      {tab === 'approval' ? (
        <section style={{ display: 'grid', gap: 12, marginTop: 12 }} data-testid="detail-approval">
          <div className="cp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <b style={{ fontSize: '0.9rem' }}>Điều kiện gửi duyệt / ký</b>
              {readiness ? (
                <span className={`contract-badge ${readiness.gated ? (readiness.ready ? '' : 'is-blocked') : ''}`}
                  style={{ fontSize: '0.74rem', background: readiness.gated ? (readiness.ready ? '#d9f2d9' : '#fadbd8') : '#f1f5f9', color: readiness.gated ? (readiness.ready ? '#166534' : '#b91c1c') : '#475569' }}>
                  {readiness.gated ? (readiness.ready ? `✓ Đủ điều kiện v${readiness.latestVersion}` : '✗ Chưa đủ điều kiện') : 'Không áp điều kiện tự động'}
                </span>
              ) : null}
            </div>
            {readiness ? (
              <>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }} data-testid="approval-steps">
                  {readiness.checks.map((c, i) => (
                    <div key={c.key} data-testid={`ready-${c.key}`} style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8,
                      border: `1px solid ${c.ok ? '#bbf7d0' : c.blocking ? '#fecaca' : '#fde68a'}`,
                      background: c.ok ? '#f0fdf4' : c.blocking ? '#fef2f2' : '#fffbeb',
                    }}>
                      <span style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.74rem', fontWeight: 800, color: '#fff',
                        background: c.ok ? '#16a34a' : c.blocking ? '#dc2626' : '#d97706',
                      }}>{c.ok ? '✓' : i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: c.ok ? '#166534' : c.blocking ? '#b91c1c' : '#92400e' }}>{c.label}</div>
                        {c.detail ? <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>{c.detail}</div> : null}
                        {!c.ok && !c.blocking ? <div style={{ fontSize: '0.74rem', color: '#92400e', marginTop: 2 }}>Cần xác nhận — không chặn chuyển trạng thái.</div> : null}
                        {!c.ok && c.action?.kind === 'fix_legal' && c.action.customerId ? <button type="button" className="cp-chip" style={{ marginTop: 6 }} onClick={() => window.open(`/all-platform/crm/customers/${c.action?.customerId}`, '_blank', 'noopener')}>Bổ sung thông tin ↗</button> : null}
                        {!c.ok && c.action?.kind === 'run_risk' ? <button type="button" className="cp-chip" style={{ marginTop: 6 }} onClick={() => { setSelected(c.action?.version ?? latest?.version ?? null); setTab('risk'); }}>Chạy AI rủi ro</button> : null}
                        {!c.ok && c.action?.kind === 'confirm_representative' ? <button type="button" className="cp-chip" style={{ marginTop: 6 }} disabled={confirmRepBusy} onClick={() => void confirmRepresentative()}>{confirmRepBusy ? 'Đang xác nhận…' : '✓ Xác nhận người đại diện'}</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
                {!readiness.gated ? (
                  <p style={{ margin: '10px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                    {hasExternalFile
                      ? 'Hợp đồng ghi nhận ngoài (không soạn qua AI Copilot) — không áp điều kiện tự động, có thể chuyển trạng thái trực tiếp. Tài liệu đã lưu xem ở tab "Tài liệu".'
                      : 'Hợp đồng chưa có tài liệu nào (Copilot hoặc ghi nhận ngoài) — chưa áp điều kiện tự động.'}
                  </p>
                ) : null}
              </>
            ) : <small style={{ color: '#94a3b8' }}>Đang kiểm tra…</small>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
              {visibleNextStatuses.length === 0 ? <small style={{ color: '#94a3b8' }}>Không còn bước chuyển trạng thái tiếp theo.</small> : null}
              {visibleNextStatuses.map(s => (
                <button key={s} type="button" className="cp-btn primary" data-testid={`approve-${s}`} disabled={!!statusBusy}
                  onClick={() => void changeStatus(s, `Chuyển sang "${contractStatusLabel(s)}"`)}>
                  {statusBusy === s ? 'Đang xử lý…' : `→ ${contractStatusLabel(s)}`}
                </button>
              ))}
            </div>
            <small style={{ display: 'block', marginTop: 8, color: '#64748b' }}>Trạng thái "Đã duyệt" riêng không có trong hệ thống: pháp chế duyệt = chuyển "Chờ pháp chế duyệt" → "Chờ ký", được ghi lại kèm phiên bản. Không có ký số — chỉ đánh dấu trạng thái.</small>
          </div>
          <div className="cp-card" data-testid="approval-log">
            <b style={{ fontSize: '0.9rem' }}>Lịch sử duyệt</b>
            {approvals.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Chưa có.</p> : (
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {approvals.map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: '0.82rem', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: '#94a3b8', minWidth: 140, fontSize: '0.76rem' }}>{when(a.createdAt)}</span>
                    <span style={{ fontWeight: 600 }}>{actionLabel(a.action)}</span>
                    <span style={{ color: '#64748b' }}>{a.actorName || a.actorId?.slice(0, 8) || '—'}</span>
                    {a.changes && (a.changes as { version?: number }).version ? <span className="cp-chip" style={{ marginLeft: 'auto' }}>v{(a.changes as { version?: number }).version}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ───────── Lịch sử (2026-10-27, redesign timeline) ───────── */}
      {tab === 'history' ? (
        <section style={{ marginTop: 12 }} data-testid="detail-history">
          <div className="cp-card">
            <b style={{ fontSize: '0.9rem' }}>Dòng thời gian hoạt động</b>
            {activity.length === 0 ? <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 8 }}>Chưa có lịch sử.</p> : (
              <div style={{ display: 'grid', marginTop: 12 }}>
                {activity.map((a, i) => {
                  const cat = a.action.startsWith('approval:') || a.action.startsWith('status_changed:') ? { label: 'Duyệt/ký', color: '#be1e4b' }
                    : a.action === 'risk_analyzed' ? { label: 'AI Review', color: '#7c3aed' }
                    : a.action === 'document_version_saved' ? { label: 'Tài liệu', color: '#0891b2' }
                    : { label: 'Hợp đồng', color: '#64748b' };
                  const details = a.changes ? Object.entries(a.changes).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(' · ') : '';
                  return (
                    <div key={a.id} style={{ display: 'flex', gap: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, marginTop: 4, flexShrink: 0 }} />
                        {i < activity.length - 1 ? <span style={{ flex: 1, width: 2, background: '#e2e8f0', minHeight: 24 }} /> : null}
                      </div>
                      <div style={{ paddingBottom: 16, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <b style={{ fontSize: '0.84rem' }}>{actionLabel(a.action)}</b>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: cat.color, background: `${cat.color}1a`, padding: '1px 7px', borderRadius: 999 }}>{cat.label}</span>
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>{when(a.createdAt)} · {a.actorName || a.actorId?.slice(0, 8) || 'Hệ thống'}</div>
                        {details ? <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>{details}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}
      </div>

      {editWizardOpen && selected ? (
        <ContractAIWizard
          open={editWizardOpen}
          onClose={() => { setJumpClause(null); void onEditWizardClosed(); }}
          onCreated={() => { setJumpClause(null); void onEditWizardClosed(); }}
          editVersion={{
            contractId: contract.id, version: selected, contractNumber: contract.contractNumber,
            dealId: contract.dealId || undefined, quoteId: contract.quoteId || undefined, customerId: contract.customerId || undefined,
          }}
          openToClause={jumpClause || undefined}
        />
      ) : null}
    </main>
  );
}

/** Trang đầy đủ /all-platform/contracts/[id] (Quản lý hợp đồng) - giữ nguyên hành vi cũ. */
export function ContractDetailPage({ contractId, onClose }: { contractId: string; onClose?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawReturnUrl = searchParams.get('returnUrl');
  const returnUrl = rawReturnUrl?.startsWith('/all-platform/') ? rawReturnUrl : null;
  function handleBack() {
    if (returnUrl) { router.replace(returnUrl); return; }
    router.push('/all-platform/contracts');
  }
  return <ContractDetailContent contractId={contractId} variant="page" onClose={onClose} onBack={handleBack} backLabel={returnUrl ? '← Quay lại khách hàng' : '← Danh sách hợp đồng'} />;
}

/** Drawer phải dùng trong Customer 360: không điều hướng trang; đóng (✕ / nền / Esc) có cảnh báo khi còn thay đổi chưa lưu. */
export function ContractDetailDrawer({
  contractId, onClose, onChanged, initialTab, focusEdit, onOpenLegacyEdit,
}: {
  contractId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  initialTab?: Tab;
  focusEdit?: boolean;
  onOpenLegacyEdit?: () => void;
}) {
  const dirtyRef = useRef(false);
  const setDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const guardedCloseNow = useCallback(() => { dirtyRef.current = false; onCloseRef.current(); }, []);
  // 2026-10-27: doi sang useLayeredDrawerClose (chuan hoa dong drawer toan CRM)
  // - giu NGUYEN dirtyRef + outside-click/ESC pattern da proven o day, chi them
  // "chi dong lop TREN CUNG" khi co nhieu drawer/modal chong nhau (vd mo
  // ContractDetailDrawer tu ben trong 1 modal khac) + doi window.confirm sang
  // dialog dung chung co 2 nut dung text sep yeu cau.
  const { backdropMouseDownProps, requestClose: guardedClose, confirmOpen: unsavedConfirmOpen, confirmStay, confirmDiscard } = useLayeredDrawerClose({
    isOpen: !!contractId,
    onRequestClose: guardedCloseNow,
    isDirty: () => dirtyRef.current,
  });
  useEffect(() => {
    if (!contractId) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';                  // không cuộn trang Customer 360 phía sau
    return () => { document.body.style.overflow = prev; };
  }, [contractId]);
  if (!contractId) return null;
  return (
    <div className="cd-backdrop" data-testid="contract-drawer" {...backdropMouseDownProps}>
      <aside className="cd-panel" role="dialog" aria-modal="true" aria-label="Chi tiết hợp đồng">
        {unsavedConfirmOpen ? <UnsavedChangesDialog onStay={confirmStay} onDiscard={confirmDiscard} /> : null}
        <ContractDetailContent key={contractId} contractId={contractId} variant="drawer" onClose={guardedClose} onChanged={onChanged} onDirtyChange={setDirty}
          initialTab={initialTab} focusEdit={focusEdit} onOpenLegacyEdit={onOpenLegacyEdit ? () => { if (dirtyRef.current && !window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi để mở form ghi nhận đầy đủ?')) return; dirtyRef.current = false; onOpenLegacyEdit(); } : undefined} />
      </aside>
    </div>
  );
}
