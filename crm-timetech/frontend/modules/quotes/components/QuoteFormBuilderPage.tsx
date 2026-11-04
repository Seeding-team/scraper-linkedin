'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FORM_STATUS_OPTIONS, LAYOUT_OPTIONS, schemaForLayout } from '../constants/quoteConfig';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { IssuerCompany, QuoteField, QuoteForm, QuoteLayoutType, QuoteSchema } from '../types';
import { serviceCatalogRepository } from '../../service-catalog/repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem } from '../../service-catalog/types';
import { CurrencyInput } from '@/components/CurrencyInput';

const clone = <T,>(value: T): T => structuredClone(value);

interface Props {
  formId?: string;
}

function textToDefault(field: QuoteField, value: string) {
  if (field.type === 'repeatable-textarea') {
    return value.split('\n').map(item => item.trim()).filter(Boolean);
  }
  if (field.type === 'number' || field.type === 'currency') {
    return value === '' ? '' : Number(value);
  }
  return value;
}

function defaultToText(value: unknown) {
  if (Array.isArray(value)) return value.join('\n');
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function validateSchema(form: QuoteForm | null, schema: QuoteSchema) {
  if (!form?.name?.trim()) return 'Tên mẫu bắt buộc.';
  // Thong tin cong ty (ten/dia chi/lien he...) gio tu dong dien tu Cong ty phat
  // hanh chon o Buoc 1 wizard, khong con go tay/luu san trong schema field nua
  // - chi con bat buoc phai gan DUNG cong ty so huu mau, khong con kiem tra
  // sellerCompanyName/sellerBrandName default value nhu truoc.
  // Mau flag "isDefaultTemplate" (Mau bao gia chuan) la ngoai le duy nhat duoc
  // phep khong gan cong ty - no dung lam fallback trung tinh dung chung cho moi
  // cong ty chua co mau rieng, khong the "thuoc ve" 1 cong ty cu the.
  if (!form.issuerCompanyId && !form.isDefaultTemplate) return 'Vui lòng chọn công ty sở hữu mẫu.';
  let sellerEmail = '';
  let defaultVatRate = 0;
  let validityDays = 0;
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.key === 'sellerEmail') sellerEmail = String(field.defaultValue || '');
      if (field.key === 'defaultVatRate') defaultVatRate = Number(field.defaultValue || 0);
      if (field.key === 'validityDays') validityDays = Number(field.defaultValue || 0);
    }
  }
  if (sellerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail)) {
    return 'Email công ty không đúng định dạng.';
  }
  if (defaultVatRate < 0 || defaultVatRate > 100) return 'VAT mặc định phải từ 0 đến 100.';
  if (validityDays < 0) return 'Thời hạn hiệu lực không được âm.';
  return '';
}

/** Ô nhập giá trị mặc định của field — kiểu input tùy theo field.type. */
function FieldValueInput({ field, onChange }: { field: QuoteField; onChange: (value: unknown) => void }) {
  if (field.type === 'calculated') {
    return <input value="Tự động tính khi tạo báo giá" disabled readOnly />;
  }
  if (field.type === 'auto-number') {
    return <input value="Tự động sinh khi tạo báo giá" disabled readOnly />;
  }
  if (field.type === 'repeater-table') {
    return <div className="quote-builder-repeater-placeholder">[{field.label}]</div>;
  }
  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(field.defaultValue)}
        onChange={event => onChange(event.target.checked)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <select value={String(field.defaultValue ?? '')} onChange={event => onChange(event.target.value)}>
        <option value="">-- Chọn --</option>
        {(field.options || []).map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea' || field.type === 'repeatable-textarea') {
    return (
      <textarea
        value={defaultToText(field.defaultValue)}
        onChange={event => onChange(textToDefault(field, event.target.value))}
      />
    );
  }
  if (field.type === 'currency') {
    const raw = field.defaultValue;
    const numericValue = typeof raw === 'number' ? raw : raw ? Number(raw) : null;
    return (
      <CurrencyInput
        value={Number.isFinite(numericValue) ? numericValue : null}
        onChange={value => onChange(value ?? undefined)}
      />
    );
  }
  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'email'
          ? 'email'
          : field.type === 'phone'
            ? 'tel'
            : 'text';
  return (
    <input
      type={inputType}
      value={defaultToText(field.defaultValue)}
      onChange={event => onChange(textToDefault(field, event.target.value))}
    />
  );
}

/** 1 dòng field trong mẫu — giá trị mặc định sửa trực tiếp, phần "Tùy chọn" gấp lại
 * gồm Label/Placeholder/Hướng dẫn + 3 cờ bắt buộc/hiển thị/cho sửa. Không cho đổi
 * key/type hay sửa JSON thô — tránh làm hỏng công thức tính toán tham chiếu field khác. */
function FieldEditorRow({
  field,
  isOpen,
  onToggle,
  onPatch,
}: {
  field: QuoteField;
  isOpen: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<QuoteField>) => void;
}) {
  const isComputed = field.type === 'calculated' || field.type === 'auto-number';
  return (
    <div className="quote-builder-field-row">
      <div className="quote-builder-field-row-head">
        <label className="crm-field">
          <span>{field.label}</span>
          <FieldValueInput field={field} onChange={value => onPatch({ defaultValue: value })} />
        </label>
        {!isComputed ? (
          <button type="button" className="quote-builder-field-toggle" onClick={onToggle}>
            Tùy chọn
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="quote-builder-field-options">
          <div className="quote-builder-field-options-grid">
            <label className="crm-field">
              <span>Tên trường (Label)</span>
              <input value={field.label} onChange={event => onPatch({ label: event.target.value })} />
            </label>
            <label className="crm-field">
              <span>Gợi ý nhập (Placeholder)</span>
              <input value={field.placeholder || ''} onChange={event => onPatch({ placeholder: event.target.value })} />
            </label>
          </div>
          <label className="crm-field">
            <span>Hướng dẫn cho nhân viên</span>
            <textarea value={field.helpText || ''} onChange={event => onPatch({ helpText: event.target.value })} />
          </label>
          <div className="quote-builder-checkbox-row">
            <label>
              <input type="checkbox" checked={Boolean(field.required)} onChange={event => onPatch({ required: event.target.checked })} />
              Bắt buộc nhập
            </label>
            <label>
              <input type="checkbox" checked={field.visible !== false} onChange={event => onPatch({ visible: event.target.checked })} />
              Hiển thị trường này
            </label>
            <label>
              <input type="checkbox" checked={field.editable !== false} onChange={event => onPatch({ editable: event.target.checked })} />
              Cho sửa khi tạo báo giá
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuoteFormBuilderPage({ formId }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<QuoteForm | null>(() => {
    if (formId) return null;
    const now = new Date().toISOString();
    const schema = schemaForLayout('cloudgate_standard_quote');
    return {
      id: '',
      code: '',
      name: '',
      description: '',
      status: 'active',
      schemaVersion: 1,
      schemaJson: schema,
      sectionCount: schema.sections.length,
      fieldCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  });
  const [loading, setLoading] = useState(Boolean(formId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openFieldKey, setOpenFieldKey] = useState('');
  const [catalogGroups, setCatalogGroups] = useState<ServiceCatalogItem[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [companies, setCompanies] = useState<IssuerCompany[]>([]);

  useEffect(() => {
    if (!formId) return;
    seedingQuoteRepository
      .getForm(formId)
      .then(row => setForm(clone(row)))
      .catch(err => setError(err instanceof Error ? err.message : 'Không tải được mẫu báo giá.'))
      .finally(() => setLoading(false));
  }, [formId]);

  useEffect(() => {
    seedingQuoteRepository.getIssuerCompanies(true).then(setCompanies).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    serviceCatalogRepository
      .list()
      .then(items => {
        const activeGroups = items.filter(item => item.itemType === 'group' && item.status === 'active');
        setCatalogGroups(activeGroups);
        // Mau MOI (chua co formId): tu tick san TAT CA nhom dang active -
        // khong bat nguoi dung phai vao lai sua mau moi dung duoc "Chon tu
        // danh muc" (theo yeu cau: khong can doi bam ap dung tung buoc).
        // Mau DA TON TAI van uu tien du lieu that da luu (getFormCatalogLinks
        // ben duoi), KHONG ghi de lua chon cu cua nguoi dung.
        if (!formId) {
          setSelectedGroupIds(activeGroups.map(g => g.id));
        }
      })
      .catch(() => setCatalogGroups([]));
    if (formId) {
      seedingQuoteRepository
        .getFormCatalogLinks(formId)
        .then(setSelectedGroupIds)
        .catch(() => setSelectedGroupIds([]));
    }
  }, [formId]);

  function toggleCatalogGroup(groupId: string) {
    setSelectedGroupIds(current =>
      current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId]
    );
  }

  function updateForm(patch: Partial<QuoteForm>) {
    setForm(current => (current ? { ...current, ...patch } : current));
  }

  function updateSchema(updater: (schema: QuoteSchema) => QuoteSchema) {
    setForm(current =>
      current ? { ...current, schemaJson: updater(clone(current.schemaJson)) } : current
    );
  }

  function updateLayout(layoutType: QuoteLayoutType) {
    const schema = schemaForLayout(layoutType);
    setForm(current => (current ? { ...current, schemaJson: schema } : current));
  }

  function patchField(sectionIndex: number, fieldIndex: number, patch: Partial<QuoteField>) {
    updateSchema(schema => {
      const sections = [...schema.sections];
      const section = { ...sections[sectionIndex], fields: [...sections[sectionIndex].fields] };
      section.fields[fieldIndex] = { ...section.fields[fieldIndex], ...patch };
      sections[sectionIndex] = section;
      return { ...schema, sections };
    });
  }

  async function save() {
    if (!form) return;
    const validationError = validateSchema(form, form.schemaJson);
    if (validationError) {
      setError(validationError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    setError('');
    try {
      let savedFormId = formId;
      if (formId) {
        await seedingQuoteRepository.updateForm(formId, {
          name: form.name,
          description: form.description,
          status: form.status,
          schemaVersion: form.schemaVersion,
          schemaJson: form.schemaJson,
          issuerCompanyId: form.issuerCompanyId,
        });
      } else {
        const created = await seedingQuoteRepository.createForm({
          name: form.name,
          description: form.description,
          status: form.status,
          schemaVersion: form.schemaVersion,
          schemaJson: form.schemaJson,
          layoutType: form.schemaJson.layoutType,
          issuerCompanyId: form.issuerCompanyId,
        });
        savedFormId = created.id;
      }
      if (savedFormId) {
        await seedingQuoteRepository.setFormCatalogLinks(savedFormId, selectedGroupIds);
      }
      router.push('/all-platform/quotes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được mẫu báo giá.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="quote-page"><section className="quote-state">Đang tải mẫu báo giá...</section></main>;
  if (!form) return <main className="quote-page"><section className="quote-state quote-state--error">Không tìm thấy mẫu báo giá.</section></main>;

  return (
    <main className="quote-builder">
      <header className="quote-action-bar">
        <div>
          <h1>{formId ? 'Chỉnh sửa mẫu báo giá' : 'Tạo form báo giá mới'}</h1>
          {formId ? <span className="quote-badge">Mẫu hệ thống</span> : null}
        </div>
        <div className="quote-head-actions">
          <Link href="/all-platform/quotes" className="quote-button quote-button--secondary">Hủy</Link>
          {formId ? <Link href={`/all-platform/quotes/${formId}/preview`} className="quote-button quote-button--secondary">Xem thử</Link> : null}
          <button type="button" className="quote-button quote-button--primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </header>

      {error ? <section className="quote-state quote-state--error">{error}</section> : null}

      <section className="quote-builder-main">
        <article className="quote-section-card">
          <div className="quote-section-head">
            <h4>Thông tin chung</h4>
          </div>
          <div className="quote-filler-field-grid">
            <label className="crm-field">
              <span>Tên mẫu</span>
              <input value={form.name} onChange={event => updateForm({ name: event.target.value })} />
            </label>
            <label className="crm-field">
              <span>Trạng thái</span>
              <select value={form.status} onChange={event => updateForm({ status: event.target.value as QuoteForm['status'] })}>
                {FORM_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {!formId ? (
              <label className="crm-field">
                <span>Loại mẫu</span>
                <select value={form.schemaJson.layoutType} onChange={event => updateLayout(event.target.value as QuoteLayoutType)}>
                  {LAYOUT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className="crm-field">
              <span>Công ty sở hữu mẫu {form.isDefaultTemplate ? '' : <b>*</b>}</span>
              <select
                value={form.issuerCompanyId || ''}
                disabled={Boolean(form.isDefaultTemplate)}
                onChange={event => updateForm({ issuerCompanyId: event.target.value || undefined })}
              >
                <option value="">-- Chọn công ty --</option>
                {companies.map(company => (
                  <option key={company.id} value={company.id}>
                    {company.brandName || company.legalName}
                  </option>
                ))}
              </select>
              {form.isDefaultTemplate ? (
                <small className="crm-help-text">Mẫu mặc định chuẩn — dùng chung cho mọi công ty, không gán riêng.</small>
              ) : null}
            </label>
            <label className="crm-field crm-field--full">
              <span>Mô tả</span>
              <textarea value={form.description} onChange={event => updateForm({ description: event.target.value })} />
            </label>
          </div>
        </article>

        {form.schemaJson.sections.map((section, sectionIndex) => (
          <article className="quote-section-card" key={section.key}>
            <div className="quote-section-head">
              <h4>{section.title}</h4>
            </div>
            <div className="quote-builder-field-list">
              {section.fields.map((field, fieldIndex) => {
                const fieldKey = `${section.key}:${field.key}`;
                return (
                  <FieldEditorRow
                    key={fieldKey}
                    field={field}
                    isOpen={openFieldKey === fieldKey}
                    onToggle={() => setOpenFieldKey(current => (current === fieldKey ? '' : fieldKey))}
                    onPatch={patch => patchField(sectionIndex, fieldIndex, patch)}
                  />
                );
              })}
            </div>
          </article>
        ))}

        <article className="quote-section-card">
          <div className="quote-section-head">
            <h4>Danh mục dịch vụ áp dụng</h4>
          </div>
          <p style={{ fontSize: 13, color: '#667085', marginTop: 0 }}>
            Chọn các nhóm dịch vụ trong Danh mục dịch vụ được phép chọn khi điền báo giá theo mẫu này.
          </p>
          {catalogGroups.length === 0 ? (
            <span style={{ fontSize: 13, color: '#667085' }}>Chưa có nhóm dịch vụ nào trong Danh mục dịch vụ.</span>
          ) : (
            <div className="quote-builder-checkbox-row">
              {catalogGroups.map(group => (
                <label key={group.id}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={() => toggleCatalogGroup(group.id)}
                  />
                  {group.name}
                </label>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
