'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  FileCheck2,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  UserRound,
  X,
} from 'lucide-react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { formatVND } from '../constants/crmConfig';
import type { CrmCustomerRow } from '../types';
import { initialsOf, relativeTime } from '../utils/quoteDisplay';

type RelatedDeal = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  deal_stage?: string | null;
  estimated_budget?: number | string | null;
  lifetime_value?: number | string | null;
  next_step?: string | null;
  follow_up_date?: string | null;
  updated_at?: string | null;
};

type RelatedQuote = {
  id: string;
  quote_number?: string | null;
  status?: string | null;
  total_amount?: number | string | null;
  processing_stage?: string | null;
  sla_due_at?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  sent_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string | null;
};

type RelatedContract = {
  id: string;
  title?: string | null;
  contract_number?: string | null;
  status?: string | null;
  contract_value?: number | string | null;
  signed_at?: string | null;
  end_date?: string | null;
};

type CustomerActivityEntry = {
  id: string;
  action: string;
  from_stage?: string | null;
  to_stage?: string | null;
  note?: string | null;
  actor_name?: string | null;
  created_at: string;
};

type RelatedPayload = {
  deals?: RelatedDeal[];
  quotes?: RelatedQuote[];
  contracts?: RelatedContract[];
  kpi?: {
    deal_count?: number;
    quote_count?: number;
    contract_count?: number;
    total_value?: number;
  };
};

type CustomerQuickViewPanelProps = {
  open: boolean;
  customer: CrmCustomerRow | null;
  ownerName: string;
  onClose: () => void;
  onCreateOpportunity: (customer: CrmCustomerRow) => void;
  onOpenDetail: (customerId: string) => void;
  onOpenQuote: (quoteId: string, customerId: string) => void;
  onOpenContract: (contractId: string, customerId: string) => void;
};

const STATUS_LABEL: Record<string, string> = {
  new_lead: 'Tiềm năng',
  following: 'Đang bán',
  current_customer: 'Đã mua',
  not_fit: 'Ngừng hoạt động',
};

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'Mới',
  contacted: 'Đã liên hệ',
  qualified: 'Đang qualify',
  requirement: 'Lấy yêu cầu',
  dealing: 'Đang xử lý',
  proposal_sent: 'Đã gửi đề xuất',
  negotiation: 'Đàm phán',
  contract_sent: 'Đã gửi hợp đồng',
  contract_signed: 'Đã ký hợp đồng',
  implementation: 'Triển khai',
  acceptance: 'Nghiệm thu',
  won: 'Đã thắng',
  lost: 'Đã thua',
  on_hold: 'Tạm dừng',
};

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: 'Bản nháp',
  pending_legal: 'Chờ pháp chế duyệt',
  pending_signature: 'Chờ ký',
  signed: 'Đã ký',
  active: 'Đang thực hiện',
  completed: 'Đã hoàn thành',
  expiring: 'Sắp hết hạn',
  expired: 'Đã hết hạn',
  terminated: 'Đã chấm dứt',
};

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Tạo cơ hội',
  create: 'Tạo cơ hội',
  converted_from_lead: 'Chuyển đổi từ Lead',
  updated: 'Cập nhật cơ hội',
  update: 'Cập nhật cơ hội',
  stage_changed: 'Chuyển giai đoạn',
  status_changed: 'Đổi trạng thái',
  note_added: 'Thêm ghi chú',
  follow_up: 'Cập nhật follow-up',
};

function requestHeaders() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function money(value?: number | string | null) {
  return formatVND(Number(value || 0)) || '0 đ';
}

function dueText(value?: string | null) {
  if (!value) return 'Chưa đặt lịch';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa đặt lịch';
  const dateText = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return date.getTime() < Date.now() ? `Quá hạn · ${dateText}` : dateText;
}

function quotePhaseLabel(quote: RelatedQuote) {
  if (quote.deleted_at || quote.status === 'cancelled') return 'Đã huỷ';
  if (quote.sent_at) return 'Đã gửi';
  if (quote.published_at || quote.processing_stage === 'published' || quote.status === 'approved' || quote.approved_at) {
    return 'Sẵn sàng gửi';
  }
  if (quote.processing_stage === 'review') return 'Admin review';
  if (quote.processing_stage === 'pricing') return 'Sale markup';
  return 'Presale';
}

function activityLabel(item: CustomerActivityEntry) {
  const base = ACTIVITY_LABEL[item.action] || item.action.replace(/[_-]+/g, ' ');
  if (item.from_stage && item.to_stage) {
    const from = STAGE_LABEL[item.from_stage] || item.from_stage;
    const to = STAGE_LABEL[item.to_stage] || item.to_stage;
    return `${base}: ${from} → ${to}`;
  }
  return base;
}

function zaloHref(value?: string | null) {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  const phone = text.replace(/\D/g, '').replace(/^84/, '0');
  return phone ? `https://zalo.me/${phone}` : undefined;
}

export function CustomerQuickViewPanel({
  open,
  customer,
  ownerName,
  onClose,
  onCreateOpportunity,
  onOpenDetail,
  onOpenQuote,
  onOpenContract,
}: CustomerQuickViewPanelProps) {
  const [related, setRelated] = useState<RelatedPayload | null>(null);
  const [activities, setActivities] = useState<CustomerActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState('');
  const [activityError, setActivityError] = useState('');

  useEffect(() => {
    if (!customer?.id) {
      setRelated(null);
      setActivities([]);
      setError('');
      setActivityError('');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setActivityLoading(true);
    setError('');
    setActivityError('');
    setRelated(null);
    setActivities([]);

    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${customer.id}/related`, {
      credentials: 'include',
      headers: requestHeaders(),
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || body.success === false) {
          throw new Error(body.message || 'Không tải được dữ liệu liên quan.');
        }
        return body.data as RelatedPayload;
      })
      .then(setRelated)
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Không tải được dữ liệu liên quan.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${customer.id}/activity`, {
      credentials: 'include',
      headers: requestHeaders(),
      signal: controller.signal,
    })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || body.success === false) {
          throw new Error(body.message || 'Không tải được hoạt động gần nhất.');
        }
        return (body.data as CustomerActivityEntry[]) || [];
      })
      .then(setActivities)
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setActivityError(err instanceof Error ? err.message : 'Không tải được hoạt động gần nhất.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setActivityLoading(false);
      });

    return () => controller.abort();
  }, [customer?.id]);

  const deals = related?.deals || [];
  const openDeals = useMemo(
    () => deals.filter(deal => !['won', 'lost'].includes((deal.deal_stage || '').toLowerCase())),
    [deals],
  );
  const quotes = useMemo(
    () => (related?.quotes || [])
      .filter(quote => !quote.deleted_at && quote.status !== 'cancelled')
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()),
    [related?.quotes],
  );
  const contracts = related?.contracts || [];
  const nextDeal = useMemo(() => {
    return [...deals]
      .filter(deal => deal.next_step || deal.follow_up_date)
      .sort((a, b) => {
        const aTime = a.follow_up_date ? new Date(a.follow_up_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.follow_up_date ? new Date(b.follow_up_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      })[0];
  }, [deals]);

  const phone = customer?.primaryContact?.phone || customer?.phone || '';
  const email = customer?.primaryContact?.email || customer?.email || '';
  const zalo = zaloHref(customer?.zalo || phone);
  const contactName = customer?.primaryContact?.name || customer?.customerName || '';
  const totalValue = related?.kpi?.total_value ?? customer?.totalValue ?? 0;
  const dealCount = related ? openDeals.length : (customer?.dealCount ?? 0);
  const isOverdue = Boolean(
    nextDeal?.follow_up_date && new Date(nextDeal.follow_up_date).getTime() < Date.now(),
  );
  const attentionText = useMemo(() => {
    if (isOverdue) return 'Follow-up đang quá hạn';
    if (!phone && !email) return 'Khách hàng chưa có thông tin liên hệ';
    if (openDeals.some(deal => !deal.next_step && !deal.follow_up_date)) return 'Có cơ hội chưa đặt việc tiếp theo';
    return '';
  }, [email, isOverdue, openDeals, phone]);

  return (
    <aside
      className={`crm-customer-quickview${open && customer ? ' is-open' : ''}`}
      aria-hidden={!open || !customer}
      aria-label={customer ? `Xem nhanh khách hàng ${customer.customerName}` : 'Xem nhanh khách hàng'}
    >
      {customer ? (
        <>
          <header className="crm-customer-quickview-header">
            <div className="crm-customer-quickview-avatar" aria-hidden="true">
              {initialsOf(customer.customerName)}
            </div>
            <div className="crm-customer-quickview-heading">
              <span>Khách hàng</span>
              <h2>{customer.customerName}</h2>
              <p>{[customer.companyName, phone].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ'}</p>
              <div className="crm-customer-quickview-tags">
                <span className={`crm-customer-status-badge crm-customer-status--${customer.status || 'unknown'}`}>
                  {STATUS_LABEL[customer.status || ''] || 'Chưa phân loại'}
                </span>
                {customer.source ? <span className="crm-customer-quickview-source">{customer.source}</span> : null}
              </div>
            </div>
            <button type="button" className="crm-customer-quickview-close" onClick={onClose} aria-label="Đóng xem nhanh" title="Đóng">
              <X size={20} />
            </button>
          </header>

          <div className="crm-customer-quickview-body">
            <section className="crm-customer-next-work" aria-labelledby="crm-next-work-title">
              <div className="crm-customer-next-work-top">
                <h3 id="crm-next-work-title">Việc cần làm tiếp theo</h3>
                <div className="crm-customer-next-work-meta">
                  {isOverdue ? <em>Ưu tiên cao</em> : null}
                  {nextDeal?.follow_up_date ? <span>{dueText(nextDeal.follow_up_date)}</span> : null}
                </div>
              </div>
              <strong>{nextDeal?.next_step || (loading ? 'Đang tải lịch xử lý...' : 'Chưa có việc tiếp theo')}</strong>
              {nextDeal ? (
                <p>{STAGE_LABEL[nextDeal.deal_stage || ''] || nextDeal.deal_stage || 'Cơ hội đang mở'}</p>
              ) : (
                <p>Thêm lịch follow-up trong hồ sơ đầy đủ để theo dõi tại đây.</p>
              )}
              <div className="crm-customer-next-work-actions">
                <button type="button" onClick={() => onOpenDetail(customer.id)}>
                  <Building2 size={15} /> Không gian KH
                </button>
                <a href={phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined} aria-disabled={!phone}>
                  <Phone size={15} /> Gọi
                </a>
                <a href={zalo} target={zalo ? '_blank' : undefined} rel={zalo ? 'noopener noreferrer' : undefined} aria-disabled={!zalo}>
                  <MessageCircle size={15} /> Zalo
                </a>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>
                  <Plus size={15} /> Follow-up
                </button>
              </div>
            </section>

            <dl className="crm-customer-quickview-stats">
              <div><dt>Pipeline</dt><dd>{money(totalValue)}</dd></div>
              <div><dt>Cơ hội mở</dt><dd>{dealCount}</dd></div>
              <div><dt>Owner</dt><dd title={ownerName}>{ownerName || 'Chưa gán'}</dd></div>
              <div><dt>Hoạt động cuối</dt><dd>{relativeTime(customer.updatedAt || customer.lastDealAt) || 'Chưa rõ'}</dd></div>
            </dl>

            <section className="crm-customer-quickview-section">
              <div className="crm-customer-quickview-section-title">
                <h3>Liên hệ chính</h3>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>Xem hồ sơ</button>
              </div>
              <div className="crm-customer-contact-row">
                <div className="crm-customer-contact-summary">
                  <UserRound size={19} />
                  <div>
                    <strong>{contactName}</strong>
                    <span>{phone || email || 'Chưa có số điện thoại hoặc email'}</span>
                  </div>
                </div>
                <div className="crm-customer-contact-actions" aria-label="Liên hệ khách hàng">
                  <a href={phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined} aria-disabled={!phone} title="Gọi điện"><Phone size={16} /></a>
                  <a href={email ? `mailto:${email}` : undefined} aria-disabled={!email} title="Gửi email"><Mail size={16} /></a>
                  <a href={zalo} target={zalo ? '_blank' : undefined} rel={zalo ? 'noopener noreferrer' : undefined} aria-disabled={!zalo} title="Mở Zalo">Zalo</a>
                </div>
              </div>
            </section>

            <section className="crm-customer-quickview-section">
              <div className="crm-customer-quickview-section-title">
                <h3>Cơ hội đang mở</h3>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>Xem tất cả</button>
              </div>
              {loading ? (
                <div className="crm-customer-quickview-loading">Đang tải cơ hội...</div>
              ) : error ? (
                <div className="crm-customer-quickview-error">{error}</div>
              ) : openDeals.length ? (
                <div className="crm-customer-opportunity-list">
                  {openDeals.slice(0, 3).map(deal => (
                    <button key={deal.id} type="button" onClick={() => onOpenDetail(customer.id)}>
                      <span className="crm-customer-opportunity-icon"><BriefcaseBusiness size={16} /></span>
                      <span className="crm-customer-opportunity-main">
                        <strong>{deal.customer_name || deal.company_name || customer.customerName}</strong>
                        <small>{STAGE_LABEL[deal.deal_stage || ''] || deal.deal_stage || 'Chưa có giai đoạn'}</small>
                      </span>
                      <span className="crm-customer-opportunity-value">{money(deal.estimated_budget || deal.lifetime_value)}</span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="crm-customer-quickview-empty">Khách hàng chưa có cơ hội đang mở.</div>
              )}
            </section>

            <section className="crm-customer-quickview-section">
              <div className="crm-customer-quickview-section-title">
                <h3>Báo giá cần chú ý</h3>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>Xem tất cả</button>
              </div>
              {loading ? (
                <div className="crm-customer-quickview-loading">Đang tải báo giá...</div>
              ) : quotes.length ? (
                <div className="crm-customer-related-list">
                  {quotes.slice(0, 3).map(quote => (
                    <button key={quote.id} type="button" onClick={() => onOpenQuote(quote.id, customer.id)}>
                      <span className="crm-customer-related-icon is-quote"><FileText size={16} /></span>
                      <span className="crm-customer-related-main">
                        <strong>{quote.quote_number || 'Báo giá chưa có mã'}</strong>
                        <small>{quotePhaseLabel(quote)}{quote.sla_due_at ? ` · ${dueText(quote.sla_due_at)}` : ''}</small>
                      </span>
                      <span className="crm-customer-related-value">{money(quote.total_amount)}</span>
                      <span className="crm-customer-related-open">Mở</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="crm-customer-quickview-empty">Khách hàng chưa có báo giá cần chú ý.</div>
              )}
            </section>

            <section className="crm-customer-quickview-section">
              <div className="crm-customer-quickview-section-title">
                <h3>Hợp đồng / doanh thu</h3>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>Xem tất cả</button>
              </div>
              {loading ? (
                <div className="crm-customer-quickview-loading">Đang tải hợp đồng...</div>
              ) : contracts.length ? (
                <div className="crm-customer-related-list">
                  {contracts.slice(0, 3).map(contract => (
                    <button key={contract.id} type="button" onClick={() => onOpenContract(contract.id, customer.id)}>
                      <span className="crm-customer-related-icon is-contract"><FileCheck2 size={16} /></span>
                      <span className="crm-customer-related-main">
                        <strong>{contract.title || contract.contract_number || 'Hợp đồng chưa có tên'}</strong>
                        <small>{CONTRACT_STATUS_LABEL[contract.status || ''] || contract.status || 'Chưa có trạng thái'}</small>
                      </span>
                      <span className="crm-customer-related-value">{money(contract.contract_value)}</span>
                      <span className="crm-customer-related-open">Mở</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="crm-customer-quickview-empty">Khách hàng chưa có hợp đồng.</div>
              )}
            </section>

            <section className="crm-customer-quickview-section">
              <div className="crm-customer-quickview-section-title">
                <h3>Hoạt động gần nhất</h3>
                <button type="button" onClick={() => onOpenDetail(customer.id)}>Xem lịch sử</button>
              </div>
              {activityLoading ? (
                <div className="crm-customer-quickview-loading">Đang tải hoạt động...</div>
              ) : activityError ? (
                <div className="crm-customer-quickview-error">{activityError}</div>
              ) : activities.length ? (
                <div className="crm-customer-activity-list">
                  {activities.slice(0, 3).map(item => (
                    <div className="crm-customer-activity-item" key={item.id}>
                      <span className="crm-customer-activity-dot"><Activity size={13} /></span>
                      <div>
                        <strong>{activityLabel(item)}</strong>
                        {item.note ? <p>{item.note}</p> : null}
                        <small>{[item.actor_name, relativeTime(item.created_at)].filter(Boolean).join(' · ')}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="crm-customer-quickview-empty">Chưa có hoạt động bán hàng được ghi nhận.</div>
              )}
              {attentionText ? (
                <div className="crm-customer-quickview-alert">
                  <AlertTriangle size={16} />
                  <span><strong>Cần chú ý</strong>{attentionText}</span>
                </div>
              ) : null}
            </section>

            <section className="crm-customer-quickview-section crm-customer-quickview-summary-row">
              <span><CalendarClock size={16} /> {related?.kpi?.quote_count || 0} báo giá</span>
              <span><BriefcaseBusiness size={16} /> {related?.kpi?.contract_count || 0} hợp đồng</span>
            </section>
          </div>

          <footer className="crm-customer-quickview-footer">
            {customer.status !== 'not_fit' ? (
              <button type="button" className="crm-customer-quickview-secondary" onClick={() => onCreateOpportunity(customer)}>
                <Plus size={17} /> Cơ hội
              </button>
            ) : null}
            <button type="button" className="crm-customer-quickview-secondary" onClick={() => onOpenDetail(customer.id)}>
              <Activity size={17} /> Hoạt động
            </button>
            <button type="button" className="crm-customer-quickview-primary" onClick={() => onOpenDetail(customer.id)}>
              Mở hồ sơ đầy đủ <ArrowUpRight size={17} />
            </button>
          </footer>
        </>
      ) : null}
    </aside>
  );
}
