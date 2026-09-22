'use client';

import { useEffect, useMemo, useState } from 'react';
import { customerLeadService } from '@/services/customer-lead.service';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { ActionMenu, type ActionMenuItem } from '../../crm/components/ActionMenu';
import { SearchableSelect } from '../../crm/components/SearchableSelect';
import { Field } from '../../crm/components/CustomerFormModal';
import { X } from '../../crm/components/icons';
import type { CreateIssuerCompanyInput, IssuerCompany, QuoteForm } from '../types';
import '../../service-catalog/styles/service-catalog.css';
import './issuer-company-admin.css';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang dùng' },
  { value: 'inactive', label: 'Ngừng dùng' },
];

function emptyForm(): CreateIssuerCompanyInput {
  return {
    code: '',
    legalName: '',
    brandName: '',
    address: '',
    contactName: '',
    phone: '',
    email: '',
    website: '',
    taxCode: '',
    logoUrl: '',
    defaultQuoteFormId: '',
    status: 'active',
    sortOrder: 0,
    paymentTerms: '',
  };
}

function companyToForm(company: IssuerCompany): CreateIssuerCompanyInput {
  return {
    code: company.code,
    legalName: company.legalName,
    brandName: company.brandName || '',
    address: company.address || '',
    contactName: company.contactName || '',
    phone: company.phone || '',
    email: company.email || '',
    website: company.website || '',
    taxCode: company.taxCode || '',
    logoUrl: company.logoUrl || '',
    defaultQuoteFormId: company.defaultQuoteFormId || '',
    status: company.status,
    sortOrder: 0,
    paymentTerms: company.paymentTerms || '',
  };
}

/** Trang quản trị "Đơn vị phát hành báo giá" — CRUD pháp nhân (SecurityZone/
 * Cloudgate/Markee AI...) dùng ở Bước 1 wizard tạo báo giá. Redesign theo yêu
 * cầu rieng "Issuer Management" (bảng gọn + modal thêm mới có phân nhóm +
 * drawer xem chi tiết), KHÔNG đổi logic lưu/upload logo cũ.
 *
 * QUAN TRỌNG (quyết định nghiệp vụ rõ ràng, tránh nhầm lẫn với "Người liên hệ"
 * trên tài liệu báo giá): "Người liên hệ" ở đây là thông tin LIÊN HỆ CHUNG
 * của pháp nhân phát hành (vd nhân sự kế toán/hành chính đứng tên công ty) —
 * KHÁC HẲN "Người liên hệ" hiển thị trên từng báo giá cụ thể, cái đó lấy theo
 * Sale đang phụ trách báo giá (quote.quoteOwnerId, xem QuoteDocumentRenderer
 * contactPersonName) và KHÔNG đọc field này. Hai khái niệm không được gộp. */
export function IssuerCompanyAdminPage() {
  const [companies, setCompanies] = useState<IssuerCompany[]>([]);
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);
  const [form, setForm] = useState<CreateIssuerCompanyInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailCompany, setDetailCompany] = useState<IssuerCompany | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [companyRows, formRows] = await Promise.all([
        seedingQuoteRepository.getIssuerCompanies(true),
        seedingQuoteRepository.getForms(),
      ]);
      setCompanies(companyRows);
      setForms(formRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh mục công ty.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const formsForEditingCompany = useMemo(
    () => forms.filter(f => modalOpen?.id && f.issuerCompanyId === modalOpen.id),
    [forms, modalOpen]
  );

  const formsForDetailCompany = useMemo(
    () => forms.filter(f => detailCompany && f.issuerCompanyId === detailCompany.id),
    [forms, detailCompany]
  );

  const filteredCompanies = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return companies.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (!term) return true;
      return (
        c.legalName.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        (c.taxCode || '').toLowerCase().includes(term)
      );
    });
  }, [companies, searchTerm, statusFilter]);

  function openAdd() {
    setModalOpen({ mode: 'add' });
    setForm(emptyForm());
    setFormError('');
  }
  function openEdit(company: IssuerCompany) {
    setModalOpen({ mode: 'edit', id: company.id });
    setForm(companyToForm(company));
    setFormError('');
    setDetailCompany(null);
  }
  function closeModal() {
    setModalOpen(null);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.legalName.trim()) {
      setFormError('Mã đơn vị và tên pháp lý bắt buộc.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (modalOpen?.mode === 'edit' && modalOpen.id) {
        await seedingQuoteRepository.updateIssuerCompany(modalOpen.id, form);
      } else {
        await seedingQuoteRepository.createIssuerCompany(form);
      }
      setModalOpen(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được đơn vị phát hành.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(company: IssuerCompany) {
    try {
      await seedingQuoteRepository.updateIssuerCompany(company.id, {
        status: company.status === 'active' ? 'inactive' : 'active',
      });
      setDetailCompany(null);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  async function handleLogoChange(file: File) {
    if (!LOGO_ACCEPT.split(',').includes(file.type)) {
      setFormError('Logo chỉ nhận PNG/JPG/WebP.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setFormError('Logo tối đa 2 MB.');
      return;
    }
    setFormError('');
    setUploadingLogo(true);
    try {
      const result = await customerLeadService.uploadAttachment(file, 'logo');
      setForm(current => ({ ...current, logoUrl: result.url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không upload được logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  function removeLogo() {
    setForm(current => ({ ...current, logoUrl: '' }));
  }

  function menuItemsFor(company: IssuerCompany): ActionMenuItem[] {
    return [
      { key: 'edit', label: 'Sửa', onSelect: () => openEdit(company) },
      { key: 'view-forms', label: 'Xem mẫu báo giá', onSelect: () => setDetailCompany(company), group: 2 },
      {
        key: 'toggle',
        label: company.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng sử dụng',
        onSelect: () => void toggleStatus(company),
        danger: company.status !== 'inactive',
        group: 3,
      },
    ];
  }

  return (
    <div className="sc-page">
      <div className="issuer-page-header">
        <div>
          <h1 className="issuer-page-title">Đơn vị phát hành</h1>
          <p className="issuer-page-subtitle">Quản lý pháp nhân, thương hiệu và thông tin hiển thị trên báo giá.</p>
        </div>
        <button type="button" className="sc-btn sc-btn-primary" onClick={openAdd}>
          + Thêm đơn vị phát hành
        </button>
      </div>

      {error ? <div className="sc-error">{error}</div> : null}
      {loading ? <div>Đang tải...</div> : null}

      {!loading ? (
        <div className="sc-tab-panel">
          <div className="sc-toolbar">
            <input
              type="text"
              className="sc-search"
              placeholder="Tìm tên, mã, MST..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            <div className="issuer-status-filter">
              <SearchableSelect
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Tất cả trạng thái"
                options={STATUS_FILTER_OPTIONS.filter(o => o.value !== '')}
                hideClearOption
              />
            </div>
          </div>

          <div className="sc-table-wrap">
            <table className="sc-table issuer-table">
              <thead>
                <tr>
                  <th>Đơn vị phát hành</th>
                  <th>Mã</th>
                  <th>Thông tin liên hệ</th>
                  <th>Mẫu báo giá</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="sc-empty">
                      {searchTerm.trim() || statusFilter ? 'Không tìm thấy đơn vị phù hợp.' : 'Chưa có đơn vị phát hành nào.'}
                    </td>
                  </tr>
                ) : (
                  filteredCompanies.map(company => {
                    const formCount = forms.filter(f => f.issuerCompanyId === company.id).length;
                    return (
                      <tr key={company.id} className="issuer-row" onClick={() => setDetailCompany(company)}>
                        <td>
                          <div className="issuer-name-cell">
                            {company.logoUrl ? (
                              <img src={company.logoUrl} alt="" className="issuer-logo-thumb" />
                            ) : (
                              <div className="issuer-logo-thumb issuer-logo-thumb--placeholder">
                                {company.legalName.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="issuer-name-text">
                              <div className="sc-cell-title">{company.brandName || company.legalName}</div>
                              <div className="sc-cell-desc">{company.legalName}</div>
                            </div>
                          </div>
                        </td>
                        <td className="sc-cell-desc">{company.code}</td>
                        <td className="sc-cell-desc">
                          {[company.contactName, company.email].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td>{formCount} mẫu</td>
                        <td>
                          <span className="issuer-status-dot-row">
                            <span className={`issuer-status-dot ${company.status === 'inactive' ? 'issuer-status-dot--inactive' : 'issuer-status-dot--active'}`} />
                            {company.status === 'inactive' ? 'Ngừng dùng' : 'Đang dùng'}
                          </span>
                        </td>
                        <td className="issuer-actions-cell" onClick={event => event.stopPropagation()}>
                          <ActionMenu items={menuItemsFor(company)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="crm-modal-backdrop" onClick={closeModal}>
          <div className="crm-modal issuer-modal" onClick={event => event.stopPropagation()}>
            <header className="crm-modal-header">
              <div>
                <h2 className="crm-modal-title">{modalOpen.mode === 'add' ? 'Thêm đơn vị phát hành' : `Sửa: ${form.legalName}`}</h2>
                <p className="crm-modal-subtitle">Thông tin pháp nhân dùng để hiển thị trên báo giá và hợp đồng.</p>
              </div>
              <button type="button" className="crm-modal-close" onClick={closeModal} aria-label="Đóng">
                <X className="crm-icon" />
              </button>
            </header>

            <div className="crm-modal-body">
              {formError ? <p className="crm-error">{formError}</p> : null}

              <div className="crm-form-section">
                <p className="crm-form-title">Thông tin nhận diện</p>
                <div className="issuer-logo-editor">
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Logo" className="issuer-logo-editor-preview" />
                  ) : (
                    <div className="issuer-logo-editor-placeholder">{(form.legalName || '?').slice(0, 2).toUpperCase()}</div>
                  )}
                  <div className="issuer-logo-editor-actions">
                    <label className="sc-btn">
                      {uploadingLogo ? 'Đang tải...' : form.logoUrl ? 'Thay logo' : 'Tải logo lên'}
                      <input
                        type="file"
                        accept={LOGO_ACCEPT}
                        style={{ display: 'none' }}
                        disabled={uploadingLogo}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file) void handleLogoChange(file);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    {form.logoUrl ? (
                      <button type="button" className="sc-btn" onClick={removeLogo}>
                        Xoá logo
                      </button>
                    ) : null}
                    <p className="sc-tab-note">PNG/JPG/WebP, tối đa 2MB. Khuyến nghị nền trong suốt, tỷ lệ ngang.</p>
                  </div>
                </div>
                <div className="crm-form-grid">
                  <Field label="Tên hiển thị" hint="thương hiệu trên báo giá">
                    <input value={form.brandName || ''} onChange={e => setForm({ ...form, brandName: e.target.value })} />
                  </Field>
                  <Field label="Mã đơn vị" required>
                    <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                  </Field>
                </div>
              </div>

              <div className="crm-form-section">
                <p className="crm-form-title">Thông tin pháp lý</p>
                <div className="crm-form-grid">
                  <Field label="Tên pháp lý" required>
                    <input value={form.legalName} onChange={e => setForm({ ...form, legalName: e.target.value })} />
                  </Field>
                  <Field label="Mã số thuế">
                    <input value={form.taxCode || ''} onChange={e => setForm({ ...form, taxCode: e.target.value })} />
                  </Field>
                  <Field label="Địa chỉ" full>
                    <input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} />
                  </Field>
                </div>
              </div>

              <div className="crm-form-section">
                <p className="crm-form-title">Thông tin liên hệ</p>
                <p className="sc-tab-note" style={{ marginTop: '-0.4rem' }}>
                  Liên hệ chung của pháp nhân (vd hành chính/kế toán) — không phải người liên hệ hiển thị trên từng báo
                  giá cụ thể (mục đó lấy theo Sale phụ trách báo giá).
                </p>
                <div className="crm-form-grid">
                  <Field label="Người liên hệ">
                    <input value={form.contactName || ''} onChange={e => setForm({ ...form, contactName: e.target.value })} />
                  </Field>
                  <Field label="Số điện thoại">
                    <input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} />
                  </Field>
                  <Field label="Website">
                    <input value={form.website || ''} onChange={e => setForm({ ...form, website: e.target.value })} />
                  </Field>
                </div>
              </div>

              {modalOpen.mode === 'edit' ? (
                <div className="crm-form-section">
                  <p className="crm-form-title">Cấu hình</p>
                  <div className="crm-form-grid">
                    <Field label="Mẫu báo giá mặc định">
                      <select
                        value={form.defaultQuoteFormId || ''}
                        onChange={e => setForm({ ...form, defaultQuoteFormId: e.target.value })}
                      >
                        <option value="">-- Chưa gán (dùng Mẫu báo giá chuẩn) --</option>
                        {formsForEditingCompany.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Trạng thái">
                      <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
                        <option value="active">Đang dùng</option>
                        <option value="inactive">Ngừng dùng</option>
                      </select>
                    </Field>
                    {/* (I) Snapshot 1 LAN vao custom block 'payment_terms' cua
                     * bao gia MOI luc tao (neu block do dang trong) - sua o
                     * day KHONG doi bao gia da tao truoc do (xem
                     * applyIssuerPaymentTermsSnapshot). */}
                    <Field label="Điều khoản thanh toán mặc định" full>
                      <textarea
                        rows={3}
                        value={form.paymentTerms || ''}
                        onChange={e => setForm({ ...form, paymentTerms: e.target.value })}
                        placeholder="vd: Thanh toán 100% giá trị hợp đồng trong vòng 7 ngày kể từ ngày ký..."
                      />
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="crm-modal-footer">
              <button type="button" className="crm-cancel-button" onClick={closeModal} disabled={saving}>
                Hủy
              </button>
              <button type="button" className="crm-save-button" disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Đang lưu...' : 'Lưu đơn vị'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {detailCompany ? (
        <>
          <div className="crm-drawer-backdrop" onClick={() => setDetailCompany(null)} />
          <aside className="crm-drawer issuer-drawer">
            <header className="crm-drawer-header">
              <div className="issuer-drawer-header-main">
                {detailCompany.logoUrl ? (
                  <img src={detailCompany.logoUrl} alt="" className="issuer-drawer-logo" />
                ) : (
                  <div className="issuer-drawer-logo issuer-drawer-logo--placeholder">
                    {detailCompany.legalName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="issuer-drawer-header-text">
                  <h2>{detailCompany.brandName || detailCompany.legalName}</h2>
                  <p>{detailCompany.legalName} · {detailCompany.code}</p>
                </div>
              </div>
              <button type="button" className="crm-drawer-close" onClick={() => setDetailCompany(null)} aria-label="Đóng">
                <X className="crm-icon" />
              </button>
            </header>

            <div className="crm-drawer-body">
              <section className="crm-meta-grid">
                <div className="crm-meta-card">
                  <span>Trạng thái</span>
                  <b>
                    <span className={`issuer-status-dot ${detailCompany.status === 'inactive' ? 'issuer-status-dot--inactive' : 'issuer-status-dot--active'}`} />{' '}
                    {detailCompany.status === 'inactive' ? 'Ngừng dùng' : 'Đang dùng'}
                  </b>
                </div>
                <div className="crm-meta-card">
                  <span>Mã số thuế</span>
                  <b>{detailCompany.taxCode || '—'}</b>
                </div>
              </section>

              <section>
                <h3 className="crm-section-title">Thông tin liên hệ</h3>
                <p className="sc-tab-note" style={{ marginTop: 0 }}>Liên hệ chung của pháp nhân — không phải người liên hệ trên từng báo giá.</p>
                <div className="crm-meta-grid">
                  <div className="crm-meta-card">
                    <span>Người liên hệ</span>
                    <b>{detailCompany.contactName || '—'}</b>
                  </div>
                  <div className="crm-meta-card">
                    <span>Số điện thoại</span>
                    <b>{detailCompany.phone || '—'}</b>
                  </div>
                  <div className="crm-meta-card">
                    <span>Email</span>
                    <b>{detailCompany.email || '—'}</b>
                  </div>
                  <div className="crm-meta-card">
                    <span>Website</span>
                    <b>{detailCompany.website || '—'}</b>
                  </div>
                </div>
              </section>

              {detailCompany.address ? (
                <section>
                  <h3 className="crm-section-title">Địa chỉ</h3>
                  <p className="crm-note">{detailCompany.address}</p>
                </section>
              ) : null}

              <section>
                <h3 className="crm-section-title">Mẫu báo giá đang dùng ({formsForDetailCompany.length})</h3>
                {formsForDetailCompany.length === 0 ? (
                  <p className="crm-empty-log">Chưa có mẫu báo giá nào gắn với đơn vị này.</p>
                ) : (
                  <ul className="issuer-form-list">
                    {formsForDetailCompany.map(f => (
                      <li key={f.id}>
                        <a href={`/all-platform/quotes/${f.id}/edit`}>{f.name}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <footer className="crm-drawer-footer">
              <div className="crm-footer-actions">
                <button type="button" className="crm-footer-button" onClick={() => openEdit(detailCompany)}>
                  Sửa
                </button>
                <button
                  type="button"
                  className={detailCompany.status === 'inactive' ? 'crm-footer-button' : 'crm-footer-button crm-footer-button--delete'}
                  onClick={() => void toggleStatus(detailCompany)}
                >
                  {detailCompany.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng sử dụng'}
                </button>
              </div>
              <button type="button" className="crm-close-button" onClick={() => setDetailCompany(null)}>Đóng</button>
            </footer>
          </aside>
        </>
      ) : null}
    </div>
  );
}
