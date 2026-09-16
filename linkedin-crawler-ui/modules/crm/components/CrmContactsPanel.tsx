'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { ActionMenu } from './ActionMenu';
import { PositionSelect } from './PositionSelect';
import { Loader2, Plus } from './icons';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

type ApiContact = {
  id: string;
  customer_id: string;
  name: string;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  is_primary?: boolean | null;
  note?: string | null;
};

type ContactFormState = {
  name: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
  isPrimary: boolean;
};

function emptyForm(): ContactFormState {
  return { name: '', positionCategoryId: '', positionLabel: '', phone: '', email: '', zalo: '', facebook: '', isPrimary: false };
}

function formFromContact(contact: ApiContact): ContactFormState {
  return {
    name: contact.name || '',
    positionCategoryId: contact.position_category_id || '',
    positionLabel: contact.position_label_snapshot || contact.position || '',
    phone: contact.phone || '',
    email: contact.email || '',
    zalo: contact.zalo || '',
    facebook: contact.facebook || '',
    isPrimary: Boolean(contact.is_primary),
  };
}

/**
 * Danh sách + CRUD Contact (nguoi lien he) cua 1 ho so khach hang - hien tren
 * CrmCustomerDetailPage.tsx. Goi that /crm/customers/{id}/contacts, khong
 * mockup. canEdit dieu khien co hien nut Sua/Xoa/+ Them hay khong (server van
 * tu kiem tra lai qua can_edit_customer()).
 */
export function CrmContactsPanel({
  customerId,
  canEdit,
  onOpenContact,
  onCountChange,
  onCreateDeal,
  onCreateProject,
}: {
  customerId: string;
  canEdit: boolean;
  onOpenContact?: (contactId: string) => void;
  onCountChange?: (count: number) => void;
  onCreateDeal?: (contactId: string) => void;
  onCreateProject?: (contactId: string) => void;
}) {
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiContact | null>(null);
  const [form, setForm] = useState<ContactFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách contact.');
        return (body.data || []) as ApiContact[];
      })
      .then(rows => {
        if (alive) {
          setContacts(rows);
          setError('');
          onCountChange?.(rows.length);
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được danh sách contact.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setFormOpen(true);
  }
  function openEdit(contact: ApiContact) {
    setEditing(contact);
    setForm(formFromContact(contact));
    setFormError('');
    setFormOpen(true);
  }

  async function handleDelete(contact: ApiContact) {
    if (!window.confirm(`Xóa contact "${contact.name}"?`)) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contact.id)}`,
        { method: 'DELETE', credentials: 'include', headers: headers() },
      );
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || 'Không xóa được contact.');
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xóa được contact.');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError('Vui lòng nhập họ tên.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        position_category_id: form.positionCategoryId || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        zalo: form.zalo.trim() || null,
        facebook: form.facebook.trim() || null,
        is_primary: form.isPrimary,
      };
      const url = editing
        ? `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(editing.id)}`
        : `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || 'Không lưu được contact.');
      setFormOpen(false);
      setReloadTick(t => t + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được contact.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="crm-contacts-panel">
      <div className="crm-contacts-panel-head">
        <p className="crm-section-title">Người liên hệ ({contacts.length})</p>
        {canEdit ? (
          <button type="button" className="crm-secondary-button crm-contacts-add-btn" onClick={openCreate}>
            <Plus className="crm-button-icon" /> Thêm Contact
          </button>
        ) : null}
      </div>

      {error ? <p className="crm-error">{error}</p> : null}

      {loading ? (
        <p className="crm-small"><Loader2 className="crm-spin-icon" /> Đang tải...</p>
      ) : contacts.length ? (
        <div className="crm-contacts-list">
          {contacts.map(contact => (
            <div
              key={contact.id}
              className={`crm-contact-row ${onOpenContact ? 'crm-contact-row--clickable' : ''}`}
              onClick={onOpenContact ? () => onOpenContact(contact.id) : undefined}
              role={onOpenContact ? 'button' : undefined}
              tabIndex={onOpenContact ? 0 : undefined}
            >
              <div className="crm-contact-row-main">
                <span className="crm-contact-row-name">
                  {contact.name}
                  {contact.is_primary ? <span className="crm-contact-primary-badge">Chính</span> : null}
                </span>
                {(contact.position_label_snapshot || contact.position) ? (
                  <span className="crm-small">{contact.position_label_snapshot || contact.position}</span>
                ) : null}
              </div>
              <div className="crm-contact-row-info" onClick={event => event.stopPropagation()}>
                {contact.phone ? <a className="crm-contact-link" href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a> : null}
                {contact.email ? <a className="crm-contact-link crm-muted" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
              </div>
              <div className="crm-contact-row-actions" onClick={event => event.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {onCreateDeal && (
                  <button type="button" className="crm-btn crm-btn--outline crm-btn--small" onClick={() => onCreateDeal(contact.id)}>+ Cơ hội</button>
                )}
                {onCreateProject && (
                  <button type="button" className="crm-btn crm-btn--outline crm-btn--small" onClick={() => onCreateProject(contact.id)}>+ Dự án</button>
                )}
                {canEdit && (
                  <ActionMenu
                    label="Thao tác contact"
                    items={[
                      { key: 'edit', label: 'Sửa', onSelect: () => openEdit(contact) },
                      { key: 'delete', label: 'Xóa', danger: true, onSelect: () => void handleDelete(contact) },
                    ]}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="crm-small crm-muted">Chưa có người liên hệ nào.</p>
      )}

      {formOpen ? (
        <div className="crm-modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="crm-modal" onClick={event => event.stopPropagation()}>
            <header className="crm-modal-header">
              <h2 className="crm-modal-title">{editing ? 'Sửa Contact' : 'Thêm Contact'}</h2>
              <button type="button" className="crm-modal-close" onClick={() => setFormOpen(false)} aria-label="Đóng">×</button>
            </header>
            <form id="crmContactForm" className="crm-modal-body" onSubmit={handleSubmit}>
              {formError ? <p className="crm-error">{formError}</p> : null}
              <div className="crm-form-grid">
                <label className="crm-field">
                  <span>Họ tên <b>*</b></span>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </label>
                <label className="crm-field">
                  <span>Chức vụ</span>
                  <PositionSelect
                    value={form.positionCategoryId}
                    labelSnapshot={form.positionLabel}
                    onChange={(id, label) => setForm(f => ({ ...f, positionCategoryId: id, positionLabel: label }))}
                  />
                </label>
                <label className="crm-field">
                  <span>Số điện thoại</span>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} type="tel" />
                </label>
                <label className="crm-field">
                  <span>Email</span>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} type="email" />
                </label>
                <label className="crm-field">
                  <span>Zalo</span>
                  <input value={form.zalo} onChange={e => setForm(f => ({ ...f, zalo: e.target.value }))} />
                </label>
                <label className="crm-field">
                  <span>Facebook</span>
                  <input value={form.facebook} onChange={e => setForm(f => ({ ...f, facebook: e.target.value }))} />
                </label>
                <div className="crm-switch-row">
                  <div className="crm-switch-row-text">
                    <span className="crm-switch-row-label">Liên hệ chính</span>
                    <span className="crm-switch-row-hint">Người liên hệ chính của khách hàng này</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.isPrimary}
                    className={`crm-switch ${form.isPrimary ? 'crm-switch--on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, isPrimary: !f.isPrimary }))}
                  >
                    <span className="crm-switch-thumb" />
                  </button>
                </div>
              </div>
            </form>
            <footer className="crm-modal-footer">
              <button type="button" className="crm-cancel-button" onClick={() => setFormOpen(false)} disabled={saving}>Hủy</button>
              <button type="submit" form="crmContactForm" className="crm-save-button" disabled={saving}>
                {saving ? <Loader2 className="crm-save-spinner" /> : null}
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
