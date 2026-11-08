'use client';

import { useState } from 'react';
import type { IssuerCompany, QuoteForm } from '@/modules/quotes';

/** Bước 1 wizard tạo báo giá — khối "Đơn vị phát hành báo giá" (bên bán), tách
 * biệt với khách hàng CRM (bên nhận, xem SelectCustomerStep). Chọn công ty từ
 * dropdown (danh mục thật, bảng quote_issuer_companies) tự điền các field bên
 * dưới; người dùng vẫn sửa tay được cho riêng báo giá này — sửa ở đây KHÔNG ghi
 * ngược lại danh mục, chỉ áp dụng cho báo giá đang tạo/sửa (snapshot lúc lưu).
 * Sau khi chọn xong chỉ hiện tóm tắt gọn, bấm "Sửa thông tin" mới mở đủ 7 ô.
 *
 * Ngay dưới khối công ty là dropdown "Mẫu báo giá" — CHỈ liệt kê mẫu thuộc
 * đúng công ty vừa chọn (companyForms), không phải màn "Chọn mẫu" riêng, không
 * thêm bước wizard nào. Logic tự chọn/ưu tiên mẫu nằm ở component cha
 * (CreateQuoteModal) — component này chỉ hiển thị + báo lựa chọn ngược lên. */
export function IssuerCompanySection({
  companies,
  selected,
  onSelect,
  companyForms,
  selectedFormId,
  onSelectForm,
}: {
  companies: IssuerCompany[];
  selected: IssuerCompany | null;
  onSelect: (company: IssuerCompany | null) => void;
  /** Các mẫu báo giá thuộc đúng công ty đang chọn (đã lọc sẵn ở cha) — rỗng
   * nghĩa là công ty chưa có mẫu riêng, sẽ dùng "Mẫu báo giá chuẩn" ngầm. */
  companyForms: QuoteForm[];
  selectedFormId?: string;
  onSelectForm: (formId: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  function handlePickCompany(id: string) {
    const company = companies.find(c => c.id === id) || null;
    onSelect(company);
    setEditing(false);
  }

  function updateField(patch: Partial<IssuerCompany>) {
    if (!selected) return;
    onSelect({ ...selected, ...patch });
  }

  const showFullForm = Boolean(selected) && editing;

  return (
    <section className="crm-wizard-form-section">
      <div className="crm-wizard-section-head">
        <div>
          <h3 className="crm-wizard-form-title">Đơn vị phát hành báo giá</h3>
          <p className="crm-wizard-form-description">Chọn công ty đứng tên báo giá này — thông tin lấy từ danh mục công ty.</p>
        </div>
        <a
          className="crm-secondary-inline"
          href="/all-platform/issuer-companies"
          target="_blank"
          rel="noopener"
        >
          Quản lý danh mục
        </a>
      </div>

      <label className="crm-field crm-field--full">
        <span>Chọn công ty báo giá *</span>
        <select className="crm-input" value={selected?.id || ''} onChange={event => handlePickCompany(event.target.value)}>
          <option value="">-- Chọn công ty --</option>
          {companies.map(company => (
            <option key={company.id} value={company.id}>
              {company.brandName || company.legalName}
            </option>
          ))}
        </select>
      </label>

      {selected && !showFullForm ? (
        <div className="crm-quote-customer-picked" style={{ marginTop: '0.85rem' }}>
          <div className="crm-issuer-summary">
            {selected.logoUrl ? (
              <img src={selected.logoUrl} alt={selected.brandName || selected.legalName} className="crm-issuer-logo-preview" />
            ) : null}
            <div>
              <b>{selected.legalName}</b>
              {selected.address ? <span className="crm-issuer-summary-extra"> · {selected.address}</span> : null}
              {selected.contactName ? <span className="crm-issuer-summary-extra"> · {selected.contactName}</span> : null}
            </div>
          </div>
          <button type="button" className="crm-secondary-inline" onClick={() => setEditing(true)}>
            Sửa thông tin
          </button>
        </div>
      ) : null}

      {showFullForm ? (
        <div className="crm-wizard-form-card-grid" style={{ marginTop: '0.85rem' }}>
          {selected!.logoUrl ? (
            <div className="crm-field crm-field--full">
              <img src={selected!.logoUrl} alt="Logo" className="crm-issuer-logo-preview" />
            </div>
          ) : null}
          <label className="crm-field">
            <span>Tên pháp lý</span>
            <input className="crm-input" value={selected!.legalName} onChange={event => updateField({ legalName: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Mã số thuế</span>
            <input className="crm-input" value={selected!.taxCode || ''} onChange={event => updateField({ taxCode: event.target.value })} />
          </label>
          <label className="crm-field crm-field--full">
            <span>Địa chỉ công ty</span>
            <input className="crm-input" value={selected!.address || ''} onChange={event => updateField({ address: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Người liên hệ</span>
            <input className="crm-input" value={selected!.contactName || ''} onChange={event => updateField({ contactName: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>SĐT</span>
            <input className="crm-input" value={selected!.phone || ''} onChange={event => updateField({ phone: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Email</span>
            <input className="crm-input" value={selected!.email || ''} onChange={event => updateField({ email: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Website</span>
            <input className="crm-input" value={selected!.website || ''} onChange={event => updateField({ website: event.target.value })} />
          </label>
        </div>
      ) : null}

      {selected ? (
        <QuoteTemplateCard
          selectedCompany={selected}
          companyForms={companyForms}
          selectedFormId={selectedFormId}
          onSelectForm={onSelectForm}
        />
      ) : null}
    </section>
  );
}

/** Khối "Mẫu báo giá" hiện đại thay cho <select> đơn giản dễ bị bỏ sót - luôn
 * hiện rõ MẪU NÀO đang thật sự được dùng cho báo giá này (tên mẫu + badge
 * nguồn gốc lựa chọn), không bắt người dùng tự suy ra từ 1 dropdown. */
function QuoteTemplateCard({
  selectedCompany,
  companyForms,
  selectedFormId,
  onSelectForm,
}: {
  selectedCompany: IssuerCompany;
  companyForms: QuoteForm[];
  selectedFormId?: string;
  onSelectForm: (formId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedForm = companyForms.find(f => f.id === selectedFormId) || null;
  const companyHasOwnTemplate = companyForms.length > 0;

  if (!companyHasOwnTemplate) {
    // Cong ty chua co mau rieng - dang dung "Mau bao gia chuan" toan he thong
    // ngam (globalDefault, resolve o component cha) - CHI hien canh bao nay khi
    // dung fallback nay (khong bao gio am tham dung khi khong co ly do).
    return (
      <div className="crm-quote-template-card crm-quote-template-card--warning" style={{ marginTop: '0.85rem' }}>
        <span className="crm-quote-template-warning-icon">⚠</span>
        <div>
          <p className="crm-quote-template-warning-text">
            Công ty này chưa có mẫu riêng – đang dùng <b>Mẫu báo giá chuẩn</b>.
          </p>
          <a className="crm-secondary-inline" href="/all-platform/service-catalog" target="_blank" rel="noopener">
            Tạo mẫu riêng cho công ty này
          </a>
        </div>
      </div>
    );
  }

  const isSingleTemplate = companyForms.length === 1;
  const isCompanyDefault = Boolean(
    selectedForm && selectedCompany.defaultQuoteFormId && selectedForm.id === selectedCompany.defaultQuoteFormId
  );
  const badgeLabel = isCompanyDefault ? 'Mẫu mặc định' : 'Đã chọn tự động';

  return (
    <div className="crm-quote-template-card" style={{ marginTop: '0.85rem' }}>
      <div className="crm-quote-template-card-main">
        <div className="crm-quote-template-company">
          {selectedCompany.logoUrl ? (
            <img src={selectedCompany.logoUrl} alt="" className="crm-issuer-logo-preview" />
          ) : (
            <span className="crm-quote-template-initial">
              {(selectedCompany.brandName || selectedCompany.legalName || '?').trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span>{selectedCompany.brandName || selectedCompany.legalName}</span>
        </div>
        {selectedForm ? (
          // Ten mau (selectedForm.name) da tu no bao ham "Mau bao gia..." o
          // hau het cac mau that (xem seed_quote_forms.py) - KHONG nen them
          // tien to "Mau bao gia" o day nua, se bi lap 2 lan ("Mau bao gia
          // Mau bao gia VPS"). Chi hien dung ten that cua mau.
          <p className="crm-quote-template-name">
            Đang dùng: <b>{selectedForm.name}</b>{' '}
            <span className="crm-quote-template-badge">{badgeLabel}</span>
          </p>
        ) : (
          <p className="crm-quote-template-name crm-quote-template-name--empty">Chưa chọn được mẫu báo giá nào.</p>
        )}
      </div>
      {!isSingleTemplate ? (
        <button type="button" className="crm-secondary-inline" onClick={() => setPickerOpen(open => !open)}>
          Đổi mẫu
        </button>
      ) : null}

      {pickerOpen && !isSingleTemplate ? (
        <div className="crm-quote-template-list">
          {companyForms.map(form => (
            <button
              key={form.id}
              type="button"
              className={`crm-quote-template-list-item ${form.id === selectedFormId ? 'crm-quote-template-list-item--active' : ''}`}
              onClick={() => {
                onSelectForm(form.id);
                setPickerOpen(false);
              }}
            >
              <div>
                <b>{form.name}</b>
                <p>{selectedCompany.brandName || selectedCompany.legalName}</p>
              </div>
              {form.id === selectedCompany.defaultQuoteFormId ? (
                <span className="crm-quote-template-badge">Mặc định</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
