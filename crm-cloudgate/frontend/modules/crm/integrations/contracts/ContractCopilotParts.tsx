'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { seedingQuoteRepository } from '@/modules/quotes';
import { applyParagraph, proposeEdit, replaceBodyParagraphs } from '@/modules/contracts/repositories/contractDocs';
import type {
  ApplyParagraphResult, ClauseProposal, LegalOverrideInput, PrecheckContact, PrecheckGap, PrecheckIssuer, PrecheckParty,
  PrecheckRepresentative, PrecheckResult, RepresentativeOverrideInput,
} from '@/modules/contracts/repositories/contractDocs';

const card: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '0.7rem 0.9rem' };
const small: React.CSSProperties = { fontSize: '0.76rem', color: '#475569' };

// Cat o RANH GIOI TU (khong cat cut giua tu nhu slice(0,50) truoc day - feedback "tiêu đề k hiển thị đủ") - chi dung
// cho TIEU DE hien thi, khong dung cho noi dung thuc te gui AI/ap vao tai lieu.
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type CrmContext = { dealId?: string; quoteId?: string; customerId?: string };

/** "Markee · MST 0402336899 · Đà Nẵng" - tóm tắt 1 dòng ngay dưới báo giá đã chọn, lấy đúng hồ sơ đơn vị phát hành gắn với Quote. */
export function IssuerSummaryLine({ issuer }: { issuer: PrecheckIssuer | null | undefined }) {
  if (!issuer) return null;
  const segments = (issuer.address || '').split(',').map(s => s.trim().replace(/\.+$/, '')).filter(Boolean);
  const city = [...segments].reverse().find(s => !/^viet\s*nam$/i.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  const parts = [issuer.brandName || issuer.legalName, issuer.taxCode ? `MST ${issuer.taxCode}` : null, city].filter(Boolean);
  return (
    <div data-testid="issuer-summary-line" style={{ marginTop: 6, fontSize: '0.8rem', color: '#334155', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: '#64748b' }}>Đơn vị phát hành:</span> <b>{parts.join(' · ')}</b>
    </div>
  );
}

const PARTY_FIELD_LABELS: Array<[keyof PrecheckParty, string]> = [
  ['name', 'Tên pháp lý'], ['tax_code', 'Mã số thuế'], ['address', 'Địa chỉ'], ['rep', 'Người đại diện'], ['phone', 'Điện thoại'], ['email', 'Email'],
];

/** Tóm tắt ĐẦY ĐỦ hai bên (không chỉ liệt kê trường thiếu): trường đã có dữ liệu hiện ✓ + giá trị thật, trường thiếu hiện "—". */
function PartyColumn({ title, party }: { title: string; party: PrecheckParty }) {
  return (
    <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
      <b style={{ fontSize: '0.8rem' }}>{title}</b>
      {PARTY_FIELD_LABELS.map(([key, label]) => {
        const value = party[key];
        return (
          <div key={key} style={{ fontSize: '0.76rem', display: 'flex', gap: 5, color: value ? '#0f172a' : '#94a3b8' }}>
            <span style={{ color: value ? '#16845d' : '#cbd5e1' }}>{value ? '✓' : '—'}</span>
            <span style={{ color: '#64748b', flex: 'none' }}>{label}:</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value || undefined}>{value || 'Chưa có'}</span>
          </div>
        );
      })}
    </div>
  );
}

export type LegalInfoSave = { contactId: string | null; legalOverrides: LegalOverrideInput; representative: RepresentativeOverrideInput; saveToCrm: boolean };

/** "Bổ sung tại chỗ" cho Bên A - KHÔNG rời luồng soạn hợp đồng. 3 nhóm rõ ràng: Doanh nghiệp (Customer) / Người liên hệ (Contact) /
 * Người đại diện ký (vai trò RIÊNG - gợi ý từ Người liên hệ phải được XÁC NHẬN, không tự nhận). Prefill toàn bộ dữ liệu CRM hiện có -
 * chỉ yêu cầu nhập trường thật sự thiếu. Nhiều Contact thì cho CHỌN đúng người (không tự đoán). */
export function LegalInfoEditor({ party, representative, contacts, contactId, onSaved, onlySection, onOpenChange }: {
  party: PrecheckParty; representative: PrecheckRepresentative | undefined; contacts: PrecheckContact[]; contactId: string | null | undefined;
  onSaved: (input: LegalInfoSave) => Promise<void> | void;
  /** Gap chỉ thiếu "người đại diện ký" thì ẩn khối Doanh nghiệp + Người liên hệ (đã đủ dữ liệu, không liên quan tới gap
   * này) - chỉ hiện khối "Người đại diện ký" cho gọn, đỡ gây rối (feedback: "form chỉ hiện tt liên quan tới"). */
  onlySection?: 'rep';
  /** Bao cho component cha biet form dang mo/dong - de an nut "Xac nhan nhanh" ben canh khi form nay da mo (thua,
   * trung chuc nang - feedback: "thừa nút nhanh qá bro nếu mở bổ sung tt"). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (v: boolean) => { setOpenRaw(v); onOpenChange?.(v); };
  const [companyName, setCompanyName] = useState(party.name || '');
  const [taxCode, setTaxCode] = useState(party.tax_code || '');
  const [address, setAddress] = useState(party.address || '');
  const [selectedContactId, setSelectedContactId] = useState(contactId || '');
  // Contact đã liên kết (contactId) có thể đã được Sale bổ sung SĐT/email trực tiếp ở tab "Người liên hệ" -
  // phải ưu tiên dữ liệu đó trước khi để trống, tránh lệch dữ liệu giữa 2 nơi.
  const linkedContact = contacts.find(c => c.id === contactId);
  const [contactName, setContactName] = useState(representative?.name || party.rep || linkedContact?.name || '');
  const [contactPosition, setContactPosition] = useState(representative?.position || party.position || linkedContact?.position || '');
  const [contactPhone, setContactPhone] = useState(representative?.phone || party.phone || linkedContact?.phone || '');
  const [contactEmail, setContactEmail] = useState(representative?.email || party.email || linkedContact?.email || '');
  const [repDifferent, setRepDifferent] = useState(false);
  const [repName, setRepName] = useState('');
  const [repPosition, setRepPosition] = useState('');
  const [saveToCrm, setSaveToCrm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function pickContact(id: string) {
    setSelectedContactId(id);
    const c = contacts.find(x => x.id === id);
    if (c) { setContactName(c.name || ''); setContactPosition(c.position || ''); setContactPhone(c.phone || ''); setContactEmail(c.email || ''); }
  }

  async function save() {
    setSaving(true); setError('');
    try {
      await onSaved({
        contactId: selectedContactId || null,
        legalOverrides: { companyName, taxCode, address, contactName, contactPosition, contactPhone, contactEmail },
        representative: repDifferent
          ? { name: repName, position: repPosition }
          : { name: contactName, position: contactPosition, phone: contactPhone, email: contactEmail, contactId: selectedContactId || null },
        saveToCrm,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được, vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <button type="button" data-testid="legal-info-edit-open" onClick={() => setOpen(true)}
      style={{ border: '1px solid #be1e4b', color: '#be1e4b', background: '#fff', borderRadius: 6, fontSize: '0.72rem', padding: '2px 10px', cursor: 'pointer' }}>Bổ sung tại chỗ ✎</button>;
  }
  const label: React.CSSProperties = { display: 'grid', gap: 2 };
  const input: React.CSSProperties = { height: 32, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 8px', fontSize: '0.78rem' };
  return (
    <div data-testid="legal-info-edit-form" style={{ ...card, marginTop: 6, display: 'grid', gap: 10, background: '#fffbeb', borderColor: '#fde68a' }}>
      {onlySection !== 'rep' ? (
        <div>
          <b style={{ fontSize: '0.78rem' }}>Doanh nghiệp</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginTop: 4 }}>
            <label style={label}><span style={small}>Tên pháp lý</span><input data-testid="legal-field-companyName" value={companyName} onChange={e => setCompanyName(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Mã số thuế</span><input data-testid="legal-field-taxCode" value={taxCode} onChange={e => setTaxCode(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Địa chỉ</span><input data-testid="legal-field-address" value={address} onChange={e => setAddress(e.target.value)} style={input} /></label>
          </div>
        </div>
      ) : null}
      {onlySection !== 'rep' ? (
        <div>
          <b style={{ fontSize: '0.78rem' }}>Người liên hệ</b>
          {contacts.length > 0 ? (
            <select data-testid="legal-contact-picker" value={selectedContactId} onChange={e => pickContact(e.target.value)} style={{ ...input, marginTop: 4, width: '100%' }}>
              <option value="">— Chọn người liên hệ —</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.position ? ` (${c.position})` : ''}{c.isPrimary ? ' · chính' : ''}</option>)}
            </select>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginTop: 4 }}>
            <label style={label}><span style={small}>Họ tên</span><input data-testid="legal-field-contactName" value={contactName} onChange={e => setContactName(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Chức vụ</span><input data-testid="legal-field-contactPosition" value={contactPosition} onChange={e => setContactPosition(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Điện thoại</span><input data-testid="legal-field-contactPhone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Email</span><input data-testid="legal-field-contactEmail" value={contactEmail} onChange={e => setContactEmail(e.target.value)} style={input} /></label>
          </div>
        </div>
      ) : null}
      <div>
        <b style={{ fontSize: '0.78rem' }}>Người đại diện ký</b>
        <div style={{ ...small, marginTop: 2 }}>
          {repDifferent
            ? 'Nhập người ký khác (không phải người liên hệ ở trên):'
            : !contactName
              ? '(Chưa có người liên hệ) - nhập thông tin ở trên hoặc chọn "Người ký khác".'
              : representative?.confirmed
                ? `Đã xác nhận: ${contactName} là người đại diện ký.`
                : `Gợi ý từ người liên hệ: ${contactName} (chưa xác nhận) - Người liên hệ KHÔNG mặc nhiên có quyền ký, bấm Lưu để xác nhận.`}
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, fontSize: '0.76rem' }}>
          <input data-testid="legal-rep-different" type="checkbox" checked={repDifferent} onChange={e => setRepDifferent(e.target.checked)} />
          Người ký khác với người liên hệ ở trên
        </label>
        {repDifferent ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, marginTop: 4 }}>
            <label style={label}><span style={small}>Họ tên người ký</span><input data-testid="legal-field-repName" value={repName} onChange={e => setRepName(e.target.value)} style={input} /></label>
            <label style={label}><span style={small}>Chức vụ</span><input data-testid="legal-field-repPosition" value={repPosition} onChange={e => setRepPosition(e.target.value)} style={input} /></label>
          </div>
        ) : null}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.76rem' }}>
        <input data-testid="legal-save-to-crm" type="checkbox" checked={saveToCrm} onChange={e => setSaveToCrm(e.target.checked)} />
        Lưu vào hồ sơ CRM (bỏ chọn = chỉ dùng cho hợp đồng này, không sửa hồ sơ gốc)
      </label>
      {error ? <small style={{ color: '#b91c1c' }}>{error}</small> : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" data-testid="legal-info-save" disabled={saving} onClick={() => void save()}
          style={{ border: 0, background: '#be1e4b', color: '#fff', borderRadius: 6, fontSize: '0.76rem', padding: '4px 12px', cursor: 'pointer' }}>{saving ? 'Đang lưu…' : 'Lưu và xác nhận'}</button>
        <button type="button" onClick={() => setOpen(false)} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, fontSize: '0.76rem', padding: '4px 12px', cursor: 'pointer' }}>Hủy</button>
      </div>
    </div>
  );
}

const ISSUER_EDIT_FIELDS: Array<[keyof NonNullable<PrecheckIssuer>, string]> = [
  ['legalName', 'Tên pháp lý'], ['taxCode', 'Mã số thuế'], ['address', 'Địa chỉ'], ['phone', 'Điện thoại'], ['email', 'Email'],
];

/** "Bổ sung tại chỗ" cho Bên B: admin/leader sửa thẳng hồ sơ đơn vị phát hành (API PUT /quotes/issuer-companies/{id} đã có sẵn, backend
 * tự kiểm tra lại quyền - FE chỉ ẩn/hiện form cho gọn, KHÔNG phải lớp bảo vệ thật). Lưu xong gọi lại precheck ngay, không cần F5. */
function IssuerInlineEditor({ issuer, canEdit, onFixUrl, onSaved }: { issuer: PrecheckIssuer; canEdit: boolean; onFixUrl: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function start() {
    setValues({ legalName: issuer.legalName || '', taxCode: issuer.taxCode || '', address: issuer.address || '', phone: issuer.phone || '', email: issuer.email || '' });
    setError(''); setOpen(true);
  }

  async function save() {
    setSaving(true); setError('');
    try {
      await seedingQuoteRepository.updateIssuerCompany(issuer.id, values);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được (có thể bạn chưa đủ quyền sửa hồ sơ đơn vị phát hành).');
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return <a href={onFixUrl} target="_blank" rel="noopener noreferrer" data-testid="issuer-fix-link" style={{ fontSize: '0.72rem', color: '#be1e4b' }}>Đề xuất bổ sung (mở trang Đơn vị phát hành) ↗</a>;
  }
  if (!open) {
    return <button type="button" data-testid="issuer-fix-inline-open" onClick={start} style={{ border: '1px solid #be1e4b', color: '#be1e4b', background: '#fff', borderRadius: 6, fontSize: '0.72rem', padding: '2px 10px', cursor: 'pointer' }}>Bổ sung tại chỗ ✎</button>;
  }
  return (
    <div data-testid="issuer-fix-inline-form" style={{ ...card, marginTop: 6, display: 'grid', gap: 6, background: '#fffbeb', borderColor: '#fde68a' }}>
      <b style={{ fontSize: '0.76rem' }}>Bổ sung hồ sơ {issuer.code}</b>
      {ISSUER_EDIT_FIELDS.map(([key, label]) => (
        <label key={key} style={{ display: 'grid', gap: 2 }}>
          <span style={small}>{label}</span>
          <input data-testid={`issuer-fix-field-${key}`} value={values[key] || ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
            style={{ height: 32, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 8px', fontSize: '0.78rem' }} />
        </label>
      ))}
      {error ? <small style={{ color: '#b91c1c' }}>{error}</small> : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" data-testid="issuer-fix-save" disabled={saving} onClick={() => void save()} style={{ border: 0, background: '#be1e4b', color: '#fff', borderRadius: 6, fontSize: '0.76rem', padding: '4px 12px', cursor: 'pointer' }}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
        <button type="button" onClick={() => setOpen(false)} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, fontSize: '0.76rem', padding: '4px 12px', cursor: 'pointer' }}>Hủy</button>
      </div>
    </div>
  );
}

/** Panel kiểm tra nguồn trước khi tạo bản nháp: blockers (chặn) / required (phải bổ sung hoặc xác nhận để trống) / optional (cảnh báo). */
export function PrecheckPanel({ precheck, loading, needDeal, noDeals, ack, onAck, onIssuerSaved, onLegalInfoSaved }: {
  precheck: PrecheckResult | null; loading: boolean; needDeal: boolean; noDeals: boolean; ack: boolean; onAck: (v: boolean) => void;
  /** Gọi sau khi sửa hồ sơ đơn vị phát hành tại chỗ thành công - để chạy lại precheck ngay, không cần F5. */
  onIssuerSaved?: () => void;
  /** "Bổ sung tại chỗ" Bên A (doanh nghiệp/người liên hệ/người đại diện ký) - chạy lại precheck ngay, không cần F5. */
  onLegalInfoSaved?: (input: LegalInfoSave) => Promise<void> | void;
}) {
  const { user } = useAppAuth();
  const canEditIssuer = user?.role === 'admin' || user?.role === 'leader';
  // Form "Bổ sung thông tin" (người đại diện) đang mở thì ẩn nút "Xác nhận nhanh" bên cạnh - 2 nút cùng làm 1 việc,
  // thừa khi form đã mở sẵn (feedback: "thừa nút nhanh qá bro nếu mở bổ sung tt").
  const [repFormOpen, setRepFormOpen] = useState(false);
  if (noDeals) {
    return <div data-testid="precheck-nodeal" style={{ ...card, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', fontSize: '0.8rem' }}>Khách hàng này chưa có Deal (cơ hội) — hãy tạo Deal trước khi soạn hợp đồng.</div>;
  }
  if (needDeal) {
    return <div data-testid="precheck-needdeal" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.8rem' }}>Chọn Deal để tiếp tục — không thể tạo bản nháp khi chưa chọn Deal.</div>;
  }
  if (loading || !precheck) return <div style={{ ...small, padding: '0.3rem 0' }}>{loading ? 'Đang kiểm tra dữ liệu CRM…' : null}</div>;
  const li = (g: PrecheckGap, i: number) => (
    <li key={i}>{g.label} <small style={{ color: '#94a3b8' }}>— {g.source}</small>
      {g.side === 'B' && precheck.issuer ? (
        <span style={{ marginLeft: 8, display: 'inline-block' }}>
          <IssuerInlineEditor issuer={precheck.issuer} canEdit={canEditIssuer} onFixUrl="/all-platform/issuer-companies" onSaved={() => onIssuerSaved?.()} />
        </span>
      ) : g.side === 'A' && precheck.parties && onLegalInfoSaved ? (
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6 }}>
          {g.field === 'rep' && precheck.representative?.name && !repFormOpen ? (
            // Da co GOI Y ten (tu Nguoi lien he) - cho xac nhan NGAY tai day (khong phai mo "Bo sung thong tin" long
            // nhau moi thay) - gui lai DUNG gia tri dang goi y nhu 1 override tuong minh, backend tu danh dau confirmed=True
            // (xem resolve_representative()) - khac voi KHONG gui gi (van la "goi y", chua xac nhan).
            <button type="button" className="cp-chip" data-testid="precheck-quick-confirm-rep" onClick={() => void onLegalInfoSaved({
              contactId: precheck.contactId ?? null, legalOverrides: {},
              representative: {
                name: precheck.representative!.name, position: precheck.representative!.position,
                phone: precheck.representative!.phone, email: precheck.representative!.email,
                contactId: precheck.representative!.contactId ?? precheck.contactId ?? null,
              },
              saveToCrm: false,
            })}>✓ Xác nhận nhanh</button>
          ) : null}
          <LegalInfoEditor party={precheck.parties.a} representative={precheck.representative} contacts={precheck.contacts || []}
            contactId={precheck.contactId} onSaved={onLegalInfoSaved} onlySection={g.field === 'rep' ? 'rep' : undefined}
            onOpenChange={g.field === 'rep' ? setRepFormOpen : undefined} />
        </span>
      ) : null}
    </li>
  );
  const optionalRepGaps = precheck.optional.filter(g => g.field === 'rep' && precheck.representative?.name);
  const optionalOtherGaps = precheck.optional.filter(g => !(g.field === 'rep' && precheck.representative?.name));
  return (
    <div data-testid="precheck-panel" style={{ display: 'grid', gap: 8 }}>
      {precheck.warnings && precheck.warnings.length > 0 ? (
        <div data-testid="precheck-warnings" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.78rem' }}>
          {precheck.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      ) : null}
      {precheck.parties ? (
        <div data-testid="precheck-parties" style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <PartyColumn title="Bên A (khách hàng)" party={precheck.parties.a} />
          <PartyColumn title={`Bên B${precheck.issuer ? ` (${precheck.issuer.code})` : ''} (đơn vị phát hành)`} party={precheck.parties.b} />
        </div>
      ) : null}
      {precheck.blockers.length > 0 ? (
        <div data-testid="precheck-blockers" style={{ ...card, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', fontSize: '0.8rem' }}>
          <b>Không thể tạo bản nháp:</b>
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>{precheck.blockers.map(li)}</ul>
        </div>
      ) : null}
      {precheck.required.length > 0 ? (
        <div data-testid="precheck-required" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.8rem' }}>
          <b>Thiếu thông tin pháp lý cần bổ sung:</b>
          <ul style={{ margin: '0.3rem 0 0.4rem', paddingLeft: '1.1rem' }}>{precheck.required.map(li)}</ul>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input data-testid="precheck-ack" type="checkbox" checked={ack} onChange={e => onAck(e.target.checked)} />
            Tôi đã hiểu: các trường này sẽ để trống (………) trong hợp đồng, hệ thống không tự điền
          </label>
        </div>
      ) : null}
      {optionalRepGaps.length > 0 && precheck.blockers.length === 0 ? (
        // Gap "xac nhan nguoi dai dien" co nut xac nhan nhanh - de NGOAI dropdown "Co the de trong" cho de thao tac
        // ngay, khong bat Sale phai bam mo dropdown moi thay.
        <div data-testid="precheck-optional-rep" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.8rem' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{optionalRepGaps.map(li)}</ul>
        </div>
      ) : null}
      {optionalOtherGaps.length > 0 && precheck.blockers.length === 0 ? (
        <details data-testid="precheck-optional" style={{ ...card, ...small }}>
          <summary style={{ cursor: 'pointer' }}>Có thể để trống ({optionalOtherGaps.length}) — không chặn tạo bản nháp</summary>
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>{optionalOtherGaps.map(li)}</ul>
        </details>
      ) : null}
      {precheck.ok && precheck.required.length === 0 && precheck.blockers.length === 0 ? <div data-testid="precheck-ok" style={{ ...small, color: '#16845d' }}>✓ Thông tin pháp lý hai bên đủ để soạn hợp đồng.</div> : null}
    </div>
  );
}

/** AI chỉnh RIÊNG một điều khoản/đoạn: nhập yêu cầu -> xem trước/sau + cờ rủi ro -> Chấp nhận hoặc Từ chối. Không áp gì khi chưa chấp nhận. */
export function ClauseAiEditPanel({ label, text, neighbors, ctx, onAccept, onClose }: {
  label: string; text: string; neighbors?: string; ctx: CrmContext; onAccept: (newText: string, proposal: ClauseProposal) => Promise<void> | void; onClose: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<ClauseProposal | null>(null);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);

  async function ask() {
    setBusy(true); setError(''); setProposal(null); setReviewed(false);
    try {
      setProposal(await proposeEdit({ text, instruction, neighbors, ...ctx }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI chưa chỉnh được phần này.');
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposal) return;
    setBusy(true); setError('');
    try {
      await onAccept(proposal.after, proposal);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không áp dụng được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="clause-ai-panel" style={{ ...card, borderColor: '#c2185b55', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: '0.84rem', flex: '1 1 auto', minWidth: 0, overflowWrap: 'break-word' }}>✦ AI chỉnh riêng: {label}</b>
        <button type="button" className="contract-button contract-button--secondary" onClick={onClose} style={{ height: 28, flexShrink: 0 }}>Đóng</button>
      </div>
      <textarea data-testid="clause-ai-instruction" value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
        placeholder="VD: Đổi thanh toán thành 2 đợt: 60% khi ký, 40% khi nghiệm thu" style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.5rem 0.6rem', fontSize: '0.84rem' }} />
      <div><button type="button" data-testid="clause-ai-ask" className="contract-button contract-button--primary" disabled={busy || !instruction.trim()} onClick={() => void ask()}>{busy && !proposal ? 'AI đang chỉnh…' : '✦ AI đề xuất'}</button></div>
      {error ? <div style={{ color: '#b91c1c', fontSize: '0.78rem' }}>{error}</div> : null}
      {proposal ? (
        <div data-testid="clause-ai-proposal" style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ ...card, background: '#f8fafc' }}><small style={{ color: '#64748b' }}>Trước</small><div style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{proposal.before}</div></div>
            <div style={{ ...card, background: '#f0fdf4' }}><small style={{ color: '#16845d' }}>Sau (đề xuất)</small><div style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{proposal.after}</div></div>
          </div>
          {proposal.reason ? <small style={{ color: '#64748b' }}>AI: {proposal.reason}</small> : null}
          {proposal.blocked ? (
            <div data-testid="clause-ai-blocked" style={{ ...card, background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', fontSize: '0.78rem' }}>
              Bị chặn: đề xuất chứa số liệu không có trong CRM/yêu cầu của bạn ({proposal.inventedNumbers.join(', ')}). Hãy ghi rõ số liệu trong yêu cầu rồi thử lại.
            </div>
          ) : null}
          {proposal.flags.length > 0 ? (
            <div data-testid="clause-ai-flags" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.78rem' }}>
              <b>Cần xem kỹ trước khi chấp nhận:</b>
              <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem' }}>{proposal.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              {!proposal.blocked ? <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}><input data-testid="clause-ai-reviewed" type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Tôi đã xem các thay đổi trên</label> : null}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" data-testid="clause-ai-accept" className="contract-button contract-button--primary" disabled={busy || proposal.blocked || (proposal.needsCareReview && !reviewed)} onClick={() => void accept()}>Chấp nhận</button>
            <button type="button" data-testid="clause-ai-reject" className="contract-button contract-button--secondary" disabled={busy} onClick={() => { setProposal(null); setReviewed(false); }}>Từ chối</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type EditHistoryItem = { id: string; before: string; after: string; at: string };

// Gộp các đoạn liên tiếp thành 1 "mục" (vd "1.2. Phạm vi dịch vụ" + các gạch đầu dòng bên dưới nó) - Sale bấm sửa 1 lần
// cho CẢ mục thay vì phải sửa từng gạch đầu dòng riêng lẻ (feedback: "từng đoạn lắc nhắc quá"). Nhận diện mục bằng
// đúng kiểu đánh số hợp đồng tiếng Việt hay dùng ("ĐIỀU 1.", "1.", "1.1.", "1.2.3."...) - đoạn không khớp thì gộp vào
// mục đang mở (đoạn mào đầu trước mục đầu tiên gộp thành 1 mục riêng).
const SECTION_HEADING_RE = /^(?:ĐIỀU\s+\d+\.?|Điều\s+\d+\.?|\d+(?:\.\d+){0,3}\.?)(?=\s|$)/;

type ParaGroup = { id: string; paragraphs: Array<{ id: string; text: string }> };

function groupParagraphsIntoSections(paragraphs: Array<{ id: string; text: string }>): ParaGroup[] {
  const groups: ParaGroup[] = [];
  for (const p of paragraphs) {
    const isHeading = SECTION_HEADING_RE.test(p.text.trim());
    if (isHeading || groups.length === 0) groups.push({ id: p.id, paragraphs: [p] });
    else groups[groups.length - 1].paragraphs.push(p);
  }
  return groups;
}

/** Chế độ MẪU DOCX: chọn 1 MỤC (có thể gồm nhiều đoạn/gạch đầu dòng) -> AI chỉnh hoặc sửa tay CẢ mục đó -> chấp nhận
 * thì áp từng đoạn gốc vào bản sao DOCX theo đúng dòng tương ứng (giữ bố cục) -> PDF cập nhật. */
export function TemplateParagraphEditor({ paragraphs, docxBase64, ctx, history, onApplied, allowFreeform, jumpToClause, jumpFinding, onJumpHandled }: {
  paragraphs: Array<{ id: string; text: string }>; docxBase64: string; ctx: CrmContext; history: EditHistoryItem[]; onApplied: (r: ApplyParagraphResult) => void;
  /** Cho phép chế độ "Sửa tự do" (thêm/bớt đoạn tuỳ ý, không giới hạn số dòng) - chỉ bật khi sửa 1 hợp đồng ĐÃ TẠO
   * (không phải lúc render mẫu lần đầu, lúc đó cần giữ đúng bố cục mẫu nên vẫn khoá số dòng theo "mục"). */
  allowFreeform?: boolean;
  /** Nút "Xem & xử lý" ở tab Rủi ro gửi qua - tự mở đúng mục có tiêu đề KHỚP (xem Legal Check động). Không khớp được
   * thì bỏ qua, không đoán bừa - Sale tự tìm bằng ô "Tìm mục". */
  jumpToClause?: string | null;
  jumpFinding?: { title: string; detail: string } | null;
  onJumpHandled?: () => void;
}) {
  const [viewMode, setViewMode] = useState<'groups' | 'freeform'>('groups');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Mac dinh 'manual' - chon 1 muc la thay NGAY noi dung hien co de sua truc tiep, khong phai o nhap rong cho AI
  // (feedback: "Ô nhập hiện tại phải hiển thị sẵn toàn bộ nội dung điều khoản cũ... không để trống chỉ có placeholder").
  // "✦ AI chỉnh riêng" van la 1 lua chon phu, bam chuyen qua khi can AI ho tro.
  const [editMode, setEditMode] = useState<'ai' | 'manual'>('manual');
  const [manualText, setManualText] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const [freeText, setFreeText] = useState(() => paragraphs.map(p => p.text).join('\n'));
  const [freeBusy, setFreeBusy] = useState(false);
  const [freeError, setFreeError] = useState('');
  const originalFreeText = useMemo(() => paragraphs.map(p => p.text).join('\n'), [paragraphs]);
  // paragraphs doi sau moi lan Luu thanh cong (onApplied) - dong bo lai textarea de luon phan anh dung noi dung THAT
  // hien tai, khong bi "cu" so voi ban da luu.
  useEffect(() => { setFreeText(originalFreeText); }, [originalFreeText]);

  async function saveFreeform() {
    setFreeBusy(true); setFreeError('');
    try {
      const lines = freeText.split('\n');
      const result = await replaceBodyParagraphs({ docxBase64, lines });
      onApplied({ ...result, applied: { id: 'body', before: originalFreeText, after: freeText } });
    } catch (e) {
      setFreeError(e instanceof Error ? e.message : 'Không lưu được.');
    } finally {
      setFreeBusy(false);
    }
  }
  const [activeFinding, setActiveFinding] = useState<{ title: string; detail: string } | null>(null);
  const groups = useMemo(() => groupParagraphsIntoSections(paragraphs), [paragraphs]);
  // Finding tu tab Rui ro tri dan dung tieu de "DIEU n. ..." - khop CHINH XAC (sau trim) voi dong dau cua 1 muc thi
  // tu mo luon muc do o che do "Chon theo muc", khong co gang doan khi khong khop (tranh mo nham muc khac).
  useEffect(() => {
    if (!jumpToClause || !jumpToClause.trim()) return;
    const target = jumpToClause.trim();
    const match = groups.find(g => g.paragraphs[0]?.text.trim() === target);
    if (match) {
      setViewMode('groups');
      setSelected(match.id);
      setManualText(match.paragraphs.map(p => p.text).join('\n'));
      setManualError('');
      setActiveFinding(jumpFinding || null);
    }
    onJumpHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToClause]);
  const filtered = useMemo(
    () => groups.filter(g => !query || g.paragraphs.some(p => p.text.toLowerCase().includes(query.toLowerCase()))).slice(0, 80),
    [groups, query],
  );
  const current = groups.find(g => g.id === selected);
  const currentText = current ? current.paragraphs.map(p => p.text).join('\n') : '';
  const idx = current ? groups.indexOf(current) : -1;
  const neighbors = idx >= 0 ? [groups[idx - 1]?.paragraphs.map(p => p.text).join('\n'), groups[idx + 1]?.paragraphs.map(p => p.text).join('\n')].filter(Boolean).join('\n') : '';

  function selectGroup(id: string) {
    setSelected(id);
    setManualText(groups.find(g => g.id === id)?.paragraphs.map(p => p.text).join('\n') || '');
    setManualError('');
    setActiveFinding(null);   // bam chon mục KHAC thủ công -> thẻ cảnh báo của finding cũ không còn đúng ngữ cảnh nữa
  }

  // Doc moi dong trong text da sua, map lai THEO DUNG THU TU vao tung doan GOC cua muc. Cung so dong: chi doi NOI
  // DUNG tung dong (nhanh, giu nguyen cau truc file mau). Khac so dong VA dang o che do allowFreeform (sua hop dong
  // DA TAO, khong phai lan render mau dau tien): cho phep them/bot dong thoai mai (feedback: "Cho thêm/xóa dòng, sửa
  // nội dung thoải mái, không giới hạn số dòng") - dung lai replaceBodyParagraphs (da ho tro them/bot dong tren CA
  // tai lieu) bang cach dung lai TOAN BO danh sach doan, chi thay doan cua MUC dang sua bang cac dong moi.
  async function applyGroupLines(group: ParaGroup, newCombinedText: string): Promise<ApplyParagraphResult> {
    const lines = newCombinedText.split('\n');
    if (lines.length !== group.paragraphs.length) {
      if (!allowFreeform) {
        throw new Error(`Mục này có ${group.paragraphs.length} dòng - không được thêm/bớt dòng khi sửa cả mục (đang có ${lines.length} dòng). Hãy giữ nguyên số dòng, chỉ đổi nội dung từng dòng.`);
      }
      const groupIds = new Set(group.paragraphs.map(p => p.id));
      const fullLines: string[] = [];
      let inserted = false;
      for (const p of paragraphs) {
        if (groupIds.has(p.id)) {
          if (!inserted) { fullLines.push(...lines); inserted = true; }
        } else {
          fullLines.push(p.text);
        }
      }
      const result = await replaceBodyParagraphs({ docxBase64, lines: fullLines });
      return { ...result, applied: { id: group.id, before: group.paragraphs.map(p => p.text).join('\n'), after: newCombinedText } };
    }
    let base = docxBase64;
    let result: ApplyParagraphResult | null = null;
    for (let i = 0; i < group.paragraphs.length; i++) {
      if (lines[i] === group.paragraphs[i].text) continue;
      result = await applyParagraph({ docxBase64: base, paragraphId: group.paragraphs[i].id, text: lines[i] });
      base = result.docxBase64;
    }
    if (!result) throw new Error('Không có gì thay đổi.');
    return { ...result, applied: { id: group.id, before: group.paragraphs.map(p => p.text).join('\n'), after: newCombinedText } };
  }

  async function saveManual() {
    if (!current) return;
    setManualBusy(true); setManualError('');
    try {
      onApplied(await applyGroupLines(current, manualText));
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Không lưu được.');
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <details data-testid="template-paragraph-editor" open style={{ ...card }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.84rem' }}>✦ Chỉnh riêng từng mục / điều khoản</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {allowFreeform ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-testid="paragraph-view-groups" onClick={() => setViewMode('groups')}
              className={`contract-button ${viewMode === 'groups' ? 'contract-button--primary' : 'contract-button--secondary'}`} style={{ height: 30, fontSize: '0.78rem' }}>Chọn theo mục</button>
            <button type="button" data-testid="paragraph-view-freeform" onClick={() => setViewMode('freeform')}
              className={`contract-button ${viewMode === 'freeform' ? 'contract-button--primary' : 'contract-button--secondary'}`} style={{ height: 30, fontSize: '0.78rem' }}>✎ Sửa tự do (toàn văn bản)</button>
          </div>
        ) : null}
        {allowFreeform && viewMode === 'freeform' ? (
          <div data-testid="paragraph-freeform-panel" style={{ display: 'grid', gap: 6 }}>
            <small style={small}>Sửa trực tiếp toàn bộ nội dung bên dưới - thêm/bớt dòng, đoạn tuỳ ý, không giới hạn số dòng. Bảng (hạng mục, thông tin hai bên...) không nằm ở đây, không bị ảnh hưởng.</small>
            <textarea data-testid="paragraph-freeform-text" value={freeText} onChange={e => setFreeText(e.target.value)} rows={18}
              style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.6rem 0.7rem', fontSize: '0.84rem', fontFamily: 'inherit' }} />
            {freeError ? <small style={{ color: '#b91c1c' }}>{freeError}</small> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" data-testid="paragraph-freeform-save" className="contract-button contract-button--primary" disabled={freeBusy || freeText === originalFreeText}
                onClick={() => void saveFreeform()}>{freeBusy ? 'Đang lưu…' : 'Áp dụng'}</button>
            </div>
          </div>
        ) : null}
        {!allowFreeform || viewMode === 'groups' ? (
          <>
        <input data-testid="paragraph-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm mục (VD: thanh toán, bảo hành…)" style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.4rem 0.6rem', fontSize: '0.82rem' }} />
        <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid #eef2f7', borderRadius: 8 }}>
          {filtered.map(g => {
            const text = g.paragraphs.map(p => p.text).join(' ');
            return (
              <button key={g.id} type="button" data-testid={`paragraph-${g.id}`} onClick={() => selectGroup(g.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.35rem 0.6rem', border: 0, borderBottom: '1px solid #f1f5f9', background: selected === g.id ? '#fdf2f8' : 'transparent', fontSize: '0.78rem', cursor: 'pointer' }}>
                {text.length > 160 ? `${text.slice(0, 160)}…` : text}
                {g.paragraphs.length > 1 ? <small style={{ color: '#94a3b8' }}> ({g.paragraphs.length} dòng)</small> : null}
              </button>
            );
          })}
          {filtered.length === 0 ? <div style={{ ...small, padding: '0.5rem 0.6rem' }}>Không có mục phù hợp.</div> : null}
        </div>
        {current ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {activeFinding ? (
              <div data-testid="paragraph-jump-finding" style={{ ...card, background: '#fff7ed', borderColor: '#fed7aa', padding: '0.5rem 0.7rem' }}>
                <b style={{ fontSize: '0.78rem', color: '#9a3412' }}>⚠ {activeFinding.title}</b>
                <div style={{ fontSize: '0.76rem', color: '#9a3412', marginTop: 2 }}>{activeFinding.detail}</div>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" data-testid="paragraph-mode-manual" onClick={() => setEditMode('manual')}
                className={`contract-button ${editMode === 'manual' ? 'contract-button--primary' : 'contract-button--secondary'}`} style={{ height: 30, fontSize: '0.78rem' }}>✎ Sửa tay trực tiếp</button>
              <button type="button" data-testid="paragraph-mode-ai" onClick={() => setEditMode('ai')}
                className={`contract-button ${editMode === 'ai' ? 'contract-button--primary' : 'contract-button--secondary'}`} style={{ height: 30, fontSize: '0.78rem' }}>✦ AI chỉnh riêng</button>
            </div>
            {current.paragraphs.length > 1 ? (
              <small style={small}>
                {allowFreeform
                  ? `Mục này đang có ${current.paragraphs.length} dòng - sửa nội dung, thêm/bớt dòng thoải mái.`
                  : `Mục này có ${current.paragraphs.length} dòng - sửa chung, nhưng không được thêm/bớt dòng.`}
              </small>
            ) : null}
            {editMode === 'manual' ? (
              <div data-testid="paragraph-manual-panel" style={{ ...card, display: 'grid', gap: 6 }}>
                <textarea data-testid="paragraph-manual-text" value={manualText} onChange={e => setManualText(e.target.value)}
                  rows={Math.max(10, current.paragraphs.length + 2, manualText.split('\n').length + 1)}
                  style={{ width: '100%', minHeight: 220, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.5rem 0.6rem', fontSize: '0.84rem', fontFamily: 'inherit', resize: 'vertical' }} />
                {manualError ? <small style={{ color: '#b91c1c' }}>{manualError}</small> : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" data-testid="paragraph-manual-save" className="contract-button contract-button--primary" disabled={manualBusy || manualText === currentText}
                    onClick={() => void saveManual()}>{manualBusy ? 'Đang lưu…' : 'Lưu'}</button>
                  <button type="button" className="contract-button contract-button--secondary" onClick={() => setSelected(null)}>Đóng</button>
                </div>
              </div>
            ) : (
              <ClauseAiEditPanel key={current.id + currentText} label={truncateAtWord(currentText, 120)} text={currentText} neighbors={neighbors} ctx={ctx} onClose={() => setSelected(null)}
                onAccept={async newText => { onApplied(await applyGroupLines(current, newText)); }} />
            )}
          </div>
        ) : null}
          </>
        ) : null}
        {history.length > 0 ? (
          <div data-testid="edit-history" style={small}>
            <b>Lịch sử chỉnh sửa ({history.length}):</b>
            {history.map((h, i) => <div key={i} style={{ borderTop: '1px solid #f1f5f9', padding: '0.25rem 0' }}>{h.at} · {h.before.slice(0, 60)}… → {h.after.slice(0, 60)}…</div>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}
