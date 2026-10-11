import { API_BASE_URL, API_KEY } from '@/lib/env';
import type { ContractClause } from '../types';

/** Client cho document engine hợp đồng (backend: /api/all-platform/contract-docs). DOCX là nguồn chuẩn; PDF được backend chuyển đổi từ chính DOCX. */

export type TemplateRenderEdit = { id: string; before: string; after: string; reason?: string };
export type TemplateRenderRejected = { id: string; reason: string };

export type TemplateRenderResult = {
  mode: 'template-docx';
  layoutPreserved: boolean;
  docxBase64: string;
  pdfBase64: string | null;
  pdfError: string | null;
  originalPdfBase64: string | null;
  pages: number | null;
  originalPages: number | null;
  edits: TemplateRenderEdit[];
  rejectedEdits: TemplateRenderRejected[];
  missingPlaceholders: string[];
  itemsTable: { filled: boolean; rows: number; warnings: string[]; tableIndex?: number | null; candidates?: Array<{ index: number; rows: number; columns: string[]; preview: string }> };
  /** Bảng "nhãn: giá trị" của Bên A/B trong mẫu (MST/Địa chỉ/Người đại diện/SĐT/Email) đã được ghi đè bằng đúng dữ liệu hợp đồng đang tạo. */
  partyTables?: { filled: Array<{ key: string; side: string; old: string; new: string }>; unresolvedTables: number };
  structure: { preserved: boolean; differences: string[]; rowCountChanged: number[] };
  fonts: { missing: string[]; metricCompatible: string[]; unknown?: boolean };
  warnings: string[];
  paragraphs: Array<{ id: string; text: string }>;
};

export type PdfReferenceResult = { mode: 'pdf-reference'; kind: 'text' | 'scan' | 'form'; pages: number; layoutPreserved: false; warning: string };

export type GeneratedDocxResult = { mode: 'generated-docx'; docxBase64: string; pdfBase64: string | null; pdfError: string | null; pages: number | null; warnings: string[] };

type ApiResponse<T> = { success?: boolean; message?: string; data?: T };

function authHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-docs${path}`, { credentials: 'include', ...init });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || body.success === false) throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
  return body.data as T;
}

export async function renderTemplate(input: {
  file?: File | null;
  templateId?: string;
  dealId?: string;
  quoteId?: string;
  extraPrompt?: string;
  contractValue?: number;
  signDate?: string;
  customerId?: string;
  acknowledgeMissing?: boolean;
  /** Chọn bảng hạng mục của mẫu khi mẫu có nhiều bảng / không tự nhận diện được. */
  itemsTableIndex?: number;
}): Promise<TemplateRenderResult | PdfReferenceResult> {
  const form = new FormData();
  if (input.file) form.append('file', input.file);
  if (input.templateId) form.append('template_id', input.templateId);
  form.append('deal_id', input.dealId || '');
  form.append('quote_id', input.quoteId || '');
  form.append('extra_prompt', input.extraPrompt || '');
  form.append('contract_value', String(input.contractValue || 0));
  form.append('sign_date', input.signDate || '');
  form.append('customer_id', input.customerId || '');
  form.append('acknowledge_missing', input.acknowledgeMissing ? 'true' : 'false');
  form.append('items_table_index', String(input.itemsTableIndex ?? -1));
  return call('/render', { method: 'POST', headers: authHeaders(false), body: form });
}

export function docxFromClauses(input: {
  title: string; contractNumber?: string; clauses: ContractClause[]; partyA?: string; partyB?: string;
  /** Có Deal/báo giá: backend tự lấy lại hai bên, hạng mục, VAT và tổng từ CRM để dựng Điều 1/2/3 (không dùng số do client gửi). */
  dealId?: string; quoteId?: string; customerId?: string;
  /** Loại hợp đồng (nhãn tự do) -> vai trò Bên A/Bên B; direction 'buy' = hợp đồng mua vào. */
  contractType?: string; direction?: 'sell' | 'buy';
  /** Người liên hệ + người đại diện ký đã chọn/xác nhận ở Copilot - để Điều 1 DOCX nhất quán với bản precheck Sale đã xem. */
  contactId?: string | null;
  representative?: RepresentativeOverrideInput | null;
}): Promise<GeneratedDocxResult> {
  return call('/from-clauses', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      title: input.title,
      contract_number: input.contractNumber || '',
      clauses: input.clauses.map(c => ({ id: c.id, title: c.title, body: c.body })),
      party_a: input.partyA || '',
      party_b: input.partyB || '',
      deal_id: input.dealId || '',
      quote_id: input.quoteId || '',
      customer_id: input.customerId || '',
      contract_type: input.contractType || '',
      direction: input.direction || 'sell',
      contact_id: input.contactId || '',
      representative: input.representative ? {
        name: input.representative.name, position: input.representative.position || null,
        phone: input.representative.phone || null, email: input.representative.email || null, contact_id: input.representative.contactId || null,
      } : null,
    }),
  });
}

export function saveContractVersion(contractId: string, docxBase64: string, contractNumber?: string): Promise<{ version: number }> {
  return call(`/${encodeURIComponent(contractId)}/versions`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ docx_base64: docxBase64, contract_number: contractNumber || '' }),
  });
}

export function listContractVersions(contractId: string): Promise<Array<{ version: number; createdAt?: string }>> {
  return call(`/${encodeURIComponent(contractId)}/versions`, { method: 'GET', headers: authHeaders(false) });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function downloadBase64(base64: string, filename: string, mime: string) {
  saveBlob(base64ToBlob(base64, mime), filename);
}

/** Tải đúng phiên bản đã lưu (docx hoặc PDF chuyển từ chính DOCX đó). */
export async function downloadContractVersion(contractId: string, version: number, fmt: 'docx' | 'pdf', filename: string) {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-docs/${encodeURIComponent(contractId)}/versions/${version}/${fmt}`, {
    credentials: 'include',
    headers: authHeaders(false),
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('application/json')) {
    let message = `Không tải được (${res.status})`;
    try {
      message = ((await res.json()) as ApiResponse<unknown>).message || message;
    } catch {
      /* giữ message mặc định */
    }
    throw new Error(message);
  }
  saveBlob(await res.blob(), filename);
}

// ───────── kiểm tra nguồn, PDF tham chiếu, chỉnh từng điều khoản ─────────
export type GapFix = { kind: 'customer' | 'issuer'; customerId?: string | null; issuerId?: string | null };
export type PrecheckGap = { side: 'A' | 'B' | ''; field: string; label: string; source: string; fix?: GapFix };
/** Hồ sơ đơn vị phát hành đã gắn với báo giá đang chọn - lấy nguyên từ quote_issuer_companies (KHÔNG phải Customer/Contact). */
export type PrecheckIssuer = { id: string; code: string; legalName: string; brandName?: string | null; taxCode?: string | null; address?: string | null; phone?: string | null; email?: string | null; status?: string };
/** Đúng dữ liệu backend dùng để dựng Điều 1 DOCX/PDF (build_parties) - hiển thị để Sale đối chiếu trước khi tạo bản nháp. */
export type PrecheckParty = { name: string; tax_code: string; address: string; rep: string; position: string; phone: string; email: string };
/** Người đại diện ký Bên A - vai trò RIÊNG, KHÔNG mặc nhiên = Người liên hệ (xem resolve_representative() backend).
 * confirmed=false ('source'="contact") = mới là GỢI Ý từ người liên hệ, phải được Sale xác nhận trước khi gửi duyệt/ký. */
export type PrecheckRepresentative = {
  name: string; position: string; phone: string; email: string; contactId?: string | null;
  confirmed: boolean; source: 'override' | 'contact' | 'individual_self' | null;
};
/** 1 Contact của khách hàng - để Sale CHỌN đúng người khi khách có nhiều Contact (không tự đoán). */
export type PrecheckContact = { id: string; name: string; position?: string | null; phone?: string | null; email?: string | null; isPrimary: boolean };
export type PrecheckResult = {
  ok: boolean; blockers: PrecheckGap[]; required: PrecheckGap[]; optional: PrecheckGap[];
  issuer?: PrecheckIssuer | null;
  parties?: { a: PrecheckParty; b: PrecheckParty };
  representative?: PrecheckRepresentative;
  contacts?: PrecheckContact[];
  contactId?: string | null;
  warnings?: string[];
};
/** "Bổ sung tại chỗ" Bên A - chỉ các trường THẬT SỰ nhập; company_* ghi vào Customer (doanh nghiệp), contact_* ghi vào Contact. */
export type LegalOverrideInput = {
  companyName?: string; taxCode?: string; address?: string;
  contactName?: string; contactPosition?: string; contactPhone?: string; contactEmail?: string;
};
export type RepresentativeOverrideInput = { name: string; position?: string; phone?: string; email?: string; contactId?: string | null };

async function callRoot<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform${path}`, { credentials: 'include', ...init });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || body.success === false) throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
  return body.data as T;
}

/** Backend kiểm tra Deal/báo giá đúng workspace + đã duyệt + không OUT/xoá và liệt kê trường pháp lý còn thiếu. */
export function precheckContract(input: {
  customerId?: string; dealId?: string; quoteId?: string; contactId?: string | null;
  representative?: RepresentativeOverrideInput | null; legalOverrides?: LegalOverrideInput | null; saveOverridesToCrm?: boolean;
}): Promise<PrecheckResult> {
  return callRoot('/contracts/precheck', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      customer_id: input.customerId || null, deal_id: input.dealId || null, quote_id: input.quoteId || null,
      contact_id: input.contactId || null,
      representative: input.representative ? {
        name: input.representative.name, position: input.representative.position || null,
        phone: input.representative.phone || null, email: input.representative.email || null, contact_id: input.representative.contactId || null,
      } : null,
      legal_overrides: input.legalOverrides ? {
        company_name: input.legalOverrides.companyName || null, tax_code: input.legalOverrides.taxCode || null, address: input.legalOverrides.address || null,
        contact_name: input.legalOverrides.contactName || null, contact_position: input.legalOverrides.contactPosition || null,
        contact_phone: input.legalOverrides.contactPhone || null, contact_email: input.legalOverrides.contactEmail || null,
      } : null,
      save_overrides_to_crm: !!input.saveOverridesToCrm,
    }),
  });
}

export type ReferenceExtract = { kind: 'text' | 'form'; pages: number; textChars: number; layoutPreserved: false; warning: string; text: string; usage: 'reference-only' };

export function extractReference(file: File): Promise<ReferenceExtract> {
  const form = new FormData();
  form.append('file', file);
  return call('/extract-reference', { method: 'POST', headers: authHeaders(false), body: form });
}

export type ClauseProposal = {
  before: string;
  after: string;
  reason: string;
  flags: string[];
  newNumbers: string[];
  removedNumbers: string[];
  inventedNumbers: string[];
  blocked: boolean;
  needsCareReview: boolean;
};

export function proposeEdit(input: { text: string; instruction: string; neighbors?: string; dealId?: string; quoteId?: string; customerId?: string }): Promise<ClauseProposal> {
  return call('/propose-edit', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ text: input.text, instruction: input.instruction, neighbors: input.neighbors || '', deal_id: input.dealId || '', quote_id: input.quoteId || '', customer_id: input.customerId || '' }),
  });
}

export type ApplyParagraphResult = {
  docxBase64: string;
  pdfBase64: string | null;
  pdfError: string | null;
  pages: number | null;
  applied: { id: string; before: string; after: string };
  layoutPreserved: boolean;
  paragraphs: Array<{ id: string; text: string }>;
};

export function applyParagraph(input: { docxBase64: string; paragraphId: string; text: string }): Promise<ApplyParagraphResult> {
  return call('/apply-paragraph', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ docx_base64: input.docxBase64, paragraph_id: input.paragraphId, text: input.text }),
  });
}

/** "Sửa tự do" toàn bộ đoạn văn thân tài liệu - KHÔNG giới hạn số dòng (cho thêm/bớt đoạn tuỳ ý), khác applyParagraph()
 * chỉ sửa text của 1 đoạn đã có. Dùng khi sửa 1 hợp đồng ĐÃ TẠO (không phải lúc render mẫu lần đầu). */
export function replaceBodyParagraphs(input: { docxBase64: string; lines: string[] }): Promise<ApplyParagraphResult> {
  return call('/replace-body', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ docx_base64: input.docxBase64, lines: input.lines }),
  });
}

// ───────── Module v2: loại hợp đồng, mã, phiên bản, rủi ro theo phiên bản, điều kiện gửi duyệt ─────────
export type TypeSuggestion = {
  label: string | null; confidence: number; reason: string; alternatives: string[]; source: 'ai' | 'rules';
  needsConfirmation: boolean; legacyKey: string | null; aiError?: string; aiNote?: string;
};

export function suggestContractType(input: { customerId?: string; dealId?: string; quoteId?: string; extraPrompt?: string; templateName?: string }): Promise<TypeSuggestion> {
  return callRoot('/contracts/suggest-type', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ customer_id: input.customerId || null, deal_id: input.dealId || null, quote_id: input.quoteId || null, extra_prompt: input.extraPrompt || null, template_name: input.templateName || null }),
  });
}

export function listContractTypes(): Promise<{ types: string[] }> {
  return callRoot('/contracts/types', { method: 'GET', headers: authHeaders(false) });
}

export type NumberSettings = { example: string; format: string; shortName: string | null; schemaReady: boolean; configured: boolean };

export function getNumberSettings(short?: string): Promise<NumberSettings> {
  return callRoot(`/contracts/number-settings${short ? `?short=${encodeURIComponent(short)}` : ''}`, { method: 'GET', headers: authHeaders(false) });
}

/** `clause` = đúng dòng tiêu đề "ĐIỀU n. ..." mà AI trích dẫn (rỗng nếu rủi ro không thuộc riêng 1 điều khoản) - dùng để
 * nút "Xem & xử lý" tự mở đúng mục trong TemplateParagraphEditor, xem contract_ai_service.py `_REVIEW_SYSTEM_PROMPT`. */
export type RiskFinding = { severity: 'ok' | 'warn'; title: string; detail: string; clause?: string };
/** Lỗi tài chính đã XÁC MINH bằng Decimal (so với báo giá thật), KHÔNG phải ý kiến AI - khác "findings" (AI, chưa xác minh). */
export type VerifiedFinding = { severity: 'error'; title: string; detail: string; field?: string; contractValue?: number; quoteValue?: number; delta?: number };
export type VersionRisk = { score: number | null; findings: RiskFinding[]; verifiedFindings?: VerifiedFinding[]; model?: string | null; analyzedAt?: string; versionSha?: string; preliminary?: boolean };
export type DocVersion = {
  version: number; createdAt?: string; size?: number; createdBy?: string | null; createdByName?: string | null;
  source?: string | null; note?: string | null; sha256?: string | null; risk?: VersionRisk | null;
};

export function listContractVersionsFull(contractId: string): Promise<DocVersion[]> {
  return call(`/${encodeURIComponent(contractId)}/versions`, { method: 'GET', headers: authHeaders(false) });
}

export function saveContractVersionFull(contractId: string, docxBase64: string, input: { contractNumber?: string; source?: string; note?: string }): Promise<{ version: number }> {
  return call(`/${encodeURIComponent(contractId)}/versions`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ docx_base64: docxBase64, contract_number: input.contractNumber || '', source: input.source || 'ai', note: input.note || '' }),
  });
}

export function getVersionParagraphs(contractId: string, version: number): Promise<{ version: number; paragraphs: Array<{ id: string; text: string }>; docxBase64: string }> {
  return call(`/${encodeURIComponent(contractId)}/versions/${version}/paragraphs`, { method: 'GET', headers: authHeaders(false) });
}

export function runVersionRisk(contractId: string, version: number): Promise<VersionRisk> {
  return call(`/${encodeURIComponent(contractId)}/versions/${version}/risk`, { method: 'POST', headers: authHeaders(false) });
}

export function analyzeDraftRisk(input: { docxBase64: string; dealId?: string; quoteId?: string; customerId?: string; contractValue?: number }): Promise<VersionRisk> {
  return call('/analyze-draft', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ docx_base64: input.docxBase64, deal_id: input.dealId || '', quote_id: input.quoteId || '', customer_id: input.customerId || '', contract_value: input.contractValue || 0 }),
  });
}

export type ReadinessCheck = { key: string; label: string; ok: boolean; blocking: boolean; detail: string; action?: { kind: string; customerId?: string; version?: number; gaps?: Array<{ side: string; field: string; label: string }> } };
export type Readiness = { contractId: string; hasDocument: boolean; latestVersion: number | null; latestSha: string | null; checks: ReadinessCheck[]; ready: boolean; gated: boolean };

export function getContractReadiness(contractId: string): Promise<Readiness> {
  return call(`/${encodeURIComponent(contractId)}/readiness`, { method: 'GET', headers: authHeaders(false) });
}

/** Tải blob của 1 phiên bản (docx|pdf) để xem trước trong trang hoặc lưu file. */
export async function fetchVersionBlob(contractId: string, version: number, fmt: 'docx' | 'pdf'): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-docs/${encodeURIComponent(contractId)}/versions/${version}/${fmt}`, { credentials: 'include', headers: authHeaders(false) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('application/json')) {
    let message = `Không tải được (${res.status})`;
    try {
      message = ((await res.json()) as ApiResponse<unknown>).message || message;
    } catch {
      /* giữ message mặc định */
    }
    throw new Error(message);
  }
  return res.blob();
}

export function saveBlobAs(blob: Blob, filename: string): void {
  saveBlob(blob, filename);
}

/** Tải đúng file gốc của mẫu trong thư viện (DOCX/PDF). */
export async function downloadTemplateOriginal(templateId: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-templates/${encodeURIComponent(templateId)}/file`, { credentials: 'include', headers: authHeaders(false) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('application/json')) {
    let message = `Không tải được (${res.status})`;
    try {
      message = ((await res.json()) as ApiResponse<unknown>).message || message;
    } catch {
      /* giữ message mặc định */
    }
    throw new Error(message);
  }
  saveBlob(await res.blob(), fallbackName);
}

/** PDF xem trước ĐÚNG form mẫu gốc (DOCX chuyển bằng LibreOffice ở backend, PDF gốc trả thẳng) - không phải text trích xuất. */
export async function fetchTemplatePreviewPdf(templateId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-templates/${encodeURIComponent(templateId)}/preview-pdf`, { credentials: 'include', headers: authHeaders(false) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('application/json')) {
    let message = `Không xem trước được (${res.status})`;
    try {
      message = ((await res.json()) as ApiResponse<unknown>).message || message;
    } catch {
      /* giữ message mặc định */
    }
    throw new Error(message);
  }
  return res.blob();
}

export type ActivityEntry = { id: string; actorId?: string | null; actorName?: string | null; action: string; changes?: Record<string, unknown> | null; createdAt: string };

export function listContractActivity(contractId: string): Promise<ActivityEntry[]> {
  return callRoot(`/contracts/${encodeURIComponent(contractId)}/activity-log`, { method: 'GET', headers: authHeaders(false) });
}
