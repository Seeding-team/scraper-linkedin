'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { Loader2 } from './icons';

type ApiContact = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

/**
 * Nut "+N" canh ten nguoi lien he chinh trong bang Khach hang - mo popover
 * liet ke toan bo contact cua khach hang nay. Goi GET
 * /crm/customers/{id}/contacts (endpoint san co, khong tao endpoint moi) CHI
 * luc bam mo (khong tai truoc cho ca trang - tranh phat sinh request thua
 * khi danh sach khach hang dai), portal + position:fixed giong ActionMenu.tsx
 * de khong bi .crm-table-card (overflow:hidden) cat mat.
 */
export function ContactSummaryBadge({ customerId, extraCount }: { customerId: string; extraCount: number }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [contacts, setContacts] = useState<ApiContact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
    if (contacts === null) {
      setLoading(true);
      setError('');
      fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`, {
        credentials: 'include',
        headers: headers(),
      })
        .then(async res => {
          const body = await res.json();
          if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách người liên hệ.');
          return (body.data || []) as ApiContact[];
        })
        .then(rows => setContacts(rows))
        .catch(err => setError(err instanceof Error ? err.message : 'Không tải được danh sách người liên hệ.'))
        .finally(() => setLoading(false));
    }
  }

  useLayoutEffect(() => {
    if (!open || !position) return;
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + popover.offsetHeight + margin > window.innerHeight) {
      const above = rect.top - popover.offsetHeight - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - popover.offsetHeight - margin);
    }
    const left = Math.min(rect.left, Math.max(margin, window.innerWidth - popover.offsetWidth - margin));
    if (Math.abs(top - position.top) > 0.5 || Math.abs(left - position.left) > 0.5) {
      setPosition({ top, left });
    }
  }, [open, position, contacts, loading]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <span className="crm-contact-summary-badge-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="crm-contact-summary-badge"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation();
          if (open) setOpen(false);
          else openPopover();
        }}
      >
        +{extraCount}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="crm-contact-summary-popover"
              role="dialog"
              style={{ top: position.top, left: position.left }}
              onClick={event => event.stopPropagation()}
            >
              {loading ? (
                <div className="crm-contact-summary-popover-state">
                  <Loader2 className="crm-spin-icon" /> Đang tải...
                </div>
              ) : error ? (
                <div className="crm-contact-summary-popover-state crm-error">{error}</div>
              ) : contacts && contacts.length ? (
                <ul className="crm-contact-summary-popover-list">
                  {contacts.map(contact => (
                    <li key={contact.id} className="crm-contact-summary-popover-item">
                      <div className="crm-contact-summary-popover-name">
                        {contact.name}
                        {contact.is_primary ? <span className="crm-contact-primary-badge">Chính</span> : null}
                      </div>
                      <div className="crm-contact-summary-popover-detail">{contact.phone || '-'}</div>
                      <div className="crm-contact-summary-popover-detail">{contact.email || '-'}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="crm-contact-summary-popover-state">Chưa có người liên hệ.</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
