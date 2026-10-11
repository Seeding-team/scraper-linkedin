'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useMembers } from '@/hooks/useMembers';
import { allPlatformCategoriesService } from '@/services/all-platform.service';
import { SearchableSelect } from './SearchableSelect';
import { MemberSearchSelect, type MemberSearchOption } from './MemberSearchSelect';
import { EditableTextCell } from './EditableTextCell';
import { Loader2, X } from './icons';

type ImportIssue = {
  column: string;
  code: string;
  message: string;
  lead_id?: string;
  lead_name?: string;
  duplicate_row_number?: number;
};
type PendingCreate = { field: 'source' | 'position'; value: string };
type ImportRowData = {
  lead_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  position?: string | null;
  position_category_id?: string | null;
  source?: string | null;
  // "owner" la truong GHI (raw text/id, BE re-resolve moi lan) - gui di khi
  // revalidate/confirm. "sdr_id"/"owner_name" la truong CHI DOC do BE tra ve
  // de hien thi (id/ten thanh vien da resolve), khong gui nguoc len.
  owner?: string | null;
  sdr_id?: string | null;
  owner_name?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  website?: string | null;
  note?: string | null;
};
type ImportRow = {
  row_number: number;
  status: 'valid' | 'duplicate' | 'error';
  data: ImportRowData;
  issues: ImportIssue[];
  pending_creates: PendingCreate[];
};
type Preview = {
  headers: string[];
  mapping: Record<string, string>;
  can_create_master: boolean;
  summary: { total: number; valid: number; duplicate: number; error: number };
  rows: ImportRow[];
};
type ImportResult = {
  created: number;
  skipped: number;
  requested: number;
  created_lead_ids: string[];
  errors: Array<{ row_number: number; message: string }>;
};

type FilterTab = 'all' | 'valid' | 'duplicate' | 'error';

const STATUS_LABEL: Record<ImportRow['status'], string> = { valid: 'Hợp lệ', duplicate: 'Trùng', error: 'Lỗi' };

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

function fileHeaders(): Record<string, string> {
  return API_KEY ? { 'X-API-Key': API_KEY } : {};
}

function toRowInput(row: ImportRow) {
  const d = row.data;
  return {
    row_number: row.row_number,
    lead_name: d.lead_name ?? null,
    company_name: d.company_name ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    position: d.position ?? null,
    source: d.source ?? null,
    owner: d.owner ?? null,
    zalo: d.zalo ?? null,
    facebook: d.facebook ?? null,
    telegram: d.telegram ?? null,
    website: d.website ?? null,
    note: d.note ?? null,
  };
}

export function LeadImportDialog({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { members } = useMembers();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [showExtraColumns, setShowExtraColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sourceOptions, setSourceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [positionOptions, setPositionOptions] = useState<Array<{ value: string; label: string }>>([]);

  const revalidateSeq = useRef(0);
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nguon/Chuc vu cho combobox tai o Preview - tai 1 lan khi mo dialog, dung
  // chung endpoint GET /categories da co san (allPlatformCategoriesService),
  // khong lam BE tra ve trung lap qua preview/revalidate.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void allPlatformCategoriesService.getAll('crm_source', { activeOnly: true }).then(res => {
      if (!alive) return;
      setSourceOptions((res.data || []).map(c => ({ value: c.code, label: c.name || c.code })));
    });
    void allPlatformCategoriesService.getAll('crm_position', { activeOnly: true }).then(res => {
      if (!alive) return;
      setPositionOptions((res.data || []).map(c => ({ value: c.name || c.code, label: c.name || c.code })));
    });
    return () => { alive = false; };
  }, [open]);

  const memberOptions: MemberSearchOption[] = useMemo(
    () => members
      .filter(m => m.linked_user_id || m.linked_user_id_2)
      .map(m => ({ id: (m.linked_user_id || m.linked_user_id_2 || m.id) as string, displayName: m.display_name, email: m.email })),
    [members],
  );

  function resetState() {
    setFile(null); setPreview(null); setSelected(new Set()); setError(''); setResult(null);
    setBusy(false); setFilterTab('all'); setShowExtraColumns(false);
  }

  function closeDialog() {
    if (busy) return;
    resetState();
    onClose();
  }

  const visibleRows = useMemo(
    () => (filterTab === 'all' ? (preview?.rows || []) : (preview?.rows || []).filter(row => row.status === filterTab)),
    [preview, filterTab],
  );
  const validRows = useMemo(() => (preview?.rows || []).filter(row => row.status === 'valid'), [preview]);
  const allValidSelected = validRows.length > 0 && validRows.every(row => selected.has(row.row_number));

  async function parseFile(nextFile: File) {
    if (!nextFile.name.toLowerCase().endsWith('.xlsx')) {
      setError('Chỉ hỗ trợ file Excel .xlsx.');
      return;
    }
    setFile(nextFile); setBusy(true); setError(''); setPreview(null); setResult(null);
    try {
      const form = new FormData();
      form.append('file', nextFile);
      const response = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/import/preview`, {
        method: 'POST', credentials: 'include', headers: fileHeaders(), body: form,
      });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message || 'Không đọc được file Excel.');
      const data = body.data as Preview;
      setPreview(data);
      setSelected(new Set(data.rows.filter(row => row.status === 'valid').map(row => row.row_number)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không đọc được file Excel.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/import/template`, {
        credentials: 'include', headers: fileHeaders(),
      });
      if (!response.ok) throw new Error('Không tải được file mẫu.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'lead-import-template.xlsx'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được file mẫu.');
    } finally {
      setBusy(false);
    }
  }

  async function runRevalidate(nextRows: ImportRow[]) {
    const seq = ++revalidateSeq.current;
    setRevalidating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/import/preview/revalidate`, {
        method: 'POST', credentials: 'include', headers: jsonHeaders(),
        body: JSON.stringify({ rows: nextRows.map(toRowInput) }),
      });
      const body = await response.json();
      if (seq !== revalidateSeq.current) return; // co lan sua moi hon, bo ket qua cu
      if (!response.ok || body.success === false) throw new Error(body.message || 'Không kiểm tra lại được dữ liệu.');
      const data = body.data as { can_create_master: boolean; summary: Preview['summary']; rows: ImportRow[] };
      setPreview(prev => (prev ? { ...prev, can_create_master: data.can_create_master, summary: data.summary, rows: data.rows } : prev));
      setSelected(prevSelected => {
        const next = new Set(prevSelected);
        for (const row of data.rows) {
          if (row.status === 'valid' && !prevSelected.has(row.row_number)) next.add(row.row_number);
          if (row.status !== 'valid' && prevSelected.has(row.row_number)) next.delete(row.row_number);
        }
        return next;
      });
    } catch (caught) {
      if (seq === revalidateSeq.current) setError(caught instanceof Error ? caught.message : 'Không kiểm tra lại được dữ liệu.');
    } finally {
      if (seq === revalidateSeq.current) setRevalidating(false);
    }
  }

  function updateRowField(rowNumber: number, patch: Partial<ImportRowData>) {
    setPreview(prev => {
      if (!prev) return prev;
      const nextRows = prev.rows.map(row => (row.row_number === rowNumber ? { ...row, data: { ...row.data, ...patch } } : row));
      if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
      revalidateTimer.current = setTimeout(() => void runRevalidate(nextRows), 300);
      return { ...prev, rows: nextRows };
    });
  }

  async function confirmImport() {
    if (!preview || !selected.size) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/import/confirm`, {
        method: 'POST', credentials: 'include', headers: jsonHeaders(),
        body: JSON.stringify({ rows: preview.rows.map(toRowInput), selected_rows: [...selected] }),
      });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message || 'Import Lead thất bại.');
      setResult(body.data as ImportResult);
      onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import Lead thất bại.');
    } finally {
      setBusy(false);
    }
  }

  function downloadErrorList() {
    if (!result || !result.errors.length) return;
    const lines = ['Dòng,Lý do', ...result.errors.map(item => `${item.row_number},"${item.message.replace(/"/g, '""')}"`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'import-lead-loi.csv'; anchor.click();
    URL.revokeObjectURL(url);
  }

  function toggle(rowNumber: number) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allValidSelected ? new Set() : new Set(validRows.map(row => row.row_number)));
  }

  if (!open) return null;

  const step = result ? 3 : preview ? 2 : 1;

  return (
    <div className="crm-modal-backdrop" onClick={closeDialog}>
      <div className="crm-modal crm-lead-import-modal" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header crm-lead-import-header">
          <div>
            <h2 className="crm-modal-title">Import Lead từ Excel</h2>
            <p className="crm-modal-subtitle">Chỉ tạo Lead. Không tự tạo Customer, Contact hoặc Deal.</p>
          </div>
          <ol className="crm-lead-import-header-steps" aria-label="Tiến trình Import Lead">
            {['Chọn file', 'Kiểm tra', 'Hoàn tất'].map((label, index) => {
              const stepNumber = index + 1;
              const state = stepNumber < step ? 'done' : stepNumber === step ? 'active' : 'pending';
              return (
                <li key={label} className={`crm-lead-import-step is-${state}`}>
                  <span className="crm-lead-import-step-circle" aria-hidden>{state === 'done' ? '✓' : stepNumber}</span>
                  <span className="crm-lead-import-step-label">{label}</span>
                  {stepNumber < 3 ? (
                    <span className={`crm-lead-import-step-connector ${stepNumber < step ? 'is-filled' : ''}`} aria-hidden />
                  ) : null}
                </li>
              );
            })}
          </ol>
          <button type="button" className="crm-modal-close" onClick={closeDialog} disabled={busy} aria-label="Đóng"><X className="crm-icon" /></button>
        </header>

        <div className="crm-modal-body">
          {error ? <p className="crm-error">{error}</p> : null}

          {result ? (
            <div className="crm-lead-import-result">
              <h3>Import hoàn tất</h3>
              <p>{result.created} Lead được tạo · {result.skipped} dòng bỏ qua/lỗi.</p>
              {result.errors.length ? (
                <ul>{result.errors.map(item => <li key={`${item.row_number}-${item.message}`}>Dòng {item.row_number}: {item.message}</li>)}</ul>
              ) : null}
            </div>
          ) : (
            <>
              <div className="crm-lead-import-filebar">
                <input ref={inputRef} type="file" accept=".xlsx" hidden onChange={event => { const next = event.target.files?.[0]; if (next) void parseFile(next); }} />
                <button type="button" className="crm-primary-button" disabled={busy} onClick={() => inputRef.current?.click()}>
                  {busy ? <Loader2 className="crm-spin-icon" /> : null}{file ? 'Chọn file khác' : 'Chọn file Excel'}
                </button>
                <button type="button" className="crm-secondary-button" disabled={busy} onClick={() => void downloadTemplate()}>Tải file Excel mẫu</button>
                {file && preview ? (
                  <span className="crm-small">
                    <b>{file.name}</b> · {preview.summary.total} dòng · Đã nhận diện {Object.keys(preview.mapping).length}/12 cột
                  </span>
                ) : file ? (
                  <span className="crm-small"><b>{file.name}</b> · {(file.size / 1024).toFixed(1)} KB</span>
                ) : (
                  <span className="crm-muted">Tối đa 5 MB / 1.000 dòng</span>
                )}
              </div>

              {preview ? (
                <>
                  <div className="crm-page-tabs" role="tablist">
                    {([
                      ['all', 'Tất cả', preview.summary.total],
                      ['valid', 'Hợp lệ', preview.summary.valid],
                      ['duplicate', 'Trùng', preview.summary.duplicate],
                      ['error', 'Lỗi', preview.summary.error],
                    ] as Array<[FilterTab, string, number]>).map(([key, label, count]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={filterTab === key}
                        className={`crm-page-tab ${filterTab === key ? 'crm-page-tab--active' : ''}`}
                        onClick={() => setFilterTab(key)}
                      >
                        {label}
                        <span className="crm-page-tab-count">{count}</span>
                      </button>
                    ))}
                    {revalidating ? <span className="crm-small crm-muted"><Loader2 className="crm-spin-icon" /> Đang kiểm tra...</span> : null}
                    <button
                      type="button"
                      className="crm-lead-import-columns-toggle"
                      onClick={() => setShowExtraColumns(v => !v)}
                    >
                      {showExtraColumns ? '← Thu gọn cột' : 'Xem thêm cột →'}
                    </button>
                  </div>

                  <div className="crm-lead-import-table-wrap">
                    <table className="crm-table crm-lead-import-table">
                      <thead>
                        <tr>
                          <th><input type="checkbox" checked={allValidSelected} onChange={toggleAll} aria-label="Chọn tất cả dòng hợp lệ" /></th>
                          <th scope="col">Họ tên người liên hệ</th>
                          <th scope="col">Công ty/Tổ chức</th>
                          <th scope="col">SĐT</th>
                          <th scope="col">Email</th>
                          <th scope="col">Chức vụ</th>
                          <th scope="col">Nguồn</th>
                          <th scope="col">Người phụ trách</th>
                          {showExtraColumns ? (
                            <>
                              <th scope="col">Zalo</th>
                              <th scope="col">Facebook</th>
                              <th scope="col">Telegram</th>
                              <th scope="col">Website</th>
                              <th scope="col">Ghi chú</th>
                            </>
                          ) : null}
                          <th scope="col">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map(row => (
                          <RowView
                            key={row.row_number}
                            row={row}
                            selected={selected.has(row.row_number)}
                            showExtraColumns={showExtraColumns}
                            sourceOptions={sourceOptions}
                            positionOptions={positionOptions}
                            memberOptions={memberOptions}
                            canCreateMaster={preview.can_create_master}
                            onToggleSelect={() => toggle(row.row_number)}
                            onFieldChange={patch => updateRowField(row.row_number, patch)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
        <footer className="crm-modal-footer">
          {result ? (
            <>
              <button type="button" className="crm-secondary-button" onClick={resetState}>Import file khác</button>
              {result.errors.length ? (
                <button type="button" className="crm-secondary-button" onClick={downloadErrorList}>Tải danh sách lỗi</button>
              ) : null}
              <button type="button" className="crm-primary-button" onClick={closeDialog}>Xem Lead vừa nhập</button>
            </>
          ) : (
            <>
              <button type="button" className="crm-secondary-button" onClick={closeDialog} disabled={busy}>Hủy</button>
              {preview ? (
                <button type="button" className="crm-primary-button" disabled={busy || !selected.size} onClick={() => void confirmImport()}>
                  {busy ? <Loader2 className="crm-spin-icon" /> : null}Import {selected.size} Lead
                </button>
              ) : null}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

type SelectOption = { value: string; label: string; richLabel?: ReactNode };

// BE gia tri Nguon/Chuc vu chua khop master nao nhung user co quyen tao moi
// (pending_creates) thi row.data.source/position VAN giu nguyen raw text do
// (khong phai master ID that - xem crm_lead_import_service.py). SearchableSelect
// chi hien thi/pin duoc gia tri co trong `options`, nen phai tu chen 1
// synthetic option ung voi raw text nay (KHONG fake id that, value = chinh
// text do) de trigger + list hien dung, thay vi roi lai placeholder "-- Chọn --".
function withPendingOption(options: SelectOption[], rawValue: string | null | undefined, isPending: boolean): SelectOption[] {
  const value = (rawValue || '').trim();
  if (!isPending || !value || options.some(option => option.value === value)) return options;
  return [
    {
      value,
      label: value,
      richLabel: (
        <span className="crm-lead-import-pending-option">
          {value}
          <span className="crm-lead-import-pending-badge">Sẽ tạo mới</span>
        </span>
      ),
    },
    ...options,
  ];
}

function RowView({
  row, selected, showExtraColumns, sourceOptions, positionOptions, memberOptions, canCreateMaster,
  onToggleSelect, onFieldChange,
}: {
  row: ImportRow;
  selected: boolean;
  showExtraColumns: boolean;
  sourceOptions: Array<{ value: string; label: string }>;
  positionOptions: Array<{ value: string; label: string }>;
  memberOptions: MemberSearchOption[];
  canCreateMaster: boolean;
  onToggleSelect: () => void;
  onFieldChange: (patch: Partial<ImportRowData>) => void;
}) {
  const d = row.data;
  const positionPending = row.pending_creates.some(pending => pending.field === 'position');
  const sourcePending = row.pending_creates.some(pending => pending.field === 'source');
  const positionSelectOptions = withPendingOption(positionOptions, d.position, positionPending);
  const sourceSelectOptions = withPendingOption(sourceOptions, d.source, sourcePending);
  return (
    <tr className={`is-${row.status}`}>
      <td><input type="checkbox" disabled={row.status !== 'valid'} checked={selected} onChange={onToggleSelect} /></td>
      <td><EditableTextCell value={d.lead_name || ''} onSave={next => onFieldChange({ lead_name: next })} /></td>
      <td><EditableTextCell value={d.company_name || ''} onSave={next => onFieldChange({ company_name: next })} /></td>
      <td><EditableTextCell value={d.phone || ''} onSave={next => onFieldChange({ phone: next })} /></td>
      <td><EditableTextCell value={d.email || ''} onSave={next => onFieldChange({ email: next })} /></td>
      <td>
        <SearchableSelect
          value={d.position || ''}
          onChange={next => onFieldChange({ position: next })}
          onCreateOption={query => onFieldChange({ position: query })}
          allowCreate={canCreateMaster}
          options={positionSelectOptions}
          placeholder="-- Chọn --"
          hideClearOption
        />
      </td>
      <td>
        <SearchableSelect
          value={d.source || ''}
          onChange={next => onFieldChange({ source: next })}
          onCreateOption={query => onFieldChange({ source: query })}
          allowCreate={canCreateMaster}
          options={sourceSelectOptions}
          placeholder="-- Chọn --"
          hideClearOption
        />
      </td>
      <td>
        <MemberSearchSelect
          value={d.sdr_id || ''}
          onChange={next => onFieldChange({ owner: next, sdr_id: next })}
          members={memberOptions}
          showAvatar={false}
          hideClearOption
        />
      </td>
      {showExtraColumns ? (
        <>
          <td><EditableTextCell value={d.zalo || ''} onSave={next => onFieldChange({ zalo: next })} /></td>
          <td><EditableTextCell value={d.facebook || ''} onSave={next => onFieldChange({ facebook: next })} /></td>
          <td><EditableTextCell value={d.telegram || ''} onSave={next => onFieldChange({ telegram: next })} /></td>
          <td><EditableTextCell value={d.website || ''} onSave={next => onFieldChange({ website: next })} /></td>
          <td><EditableTextCell value={d.note || ''} onSave={next => onFieldChange({ note: next })} multiline /></td>
        </>
      ) : null}
      <td>
        <b>{STATUS_LABEL[row.status]}</b>
        {row.issues.map(issue => (
          <div key={`${issue.column}-${issue.code}`}>{issue.message}</div>
        ))}
        {row.pending_creates.map(pending => (
          <div key={`${pending.field}-${pending.value}`} className="crm-lead-import-pending-create">
            {pending.field === 'source' ? 'Nguồn' : 'Chức vụ'} &quot;{pending.value}&quot; sẽ được tạo
          </div>
        ))}
      </td>
    </tr>
  );
}
