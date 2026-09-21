'use client';

import { useEffect, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import { formatVND } from '../../constants/crmConfig';
import { CUSTOMER_STATUS_TONE, customerStatusLabel, dealStageLabel } from './progressLabels';
import type { CustomerRelatedRecords } from './progress.types';

/** Customer Quick View - reuse endpoint Customer 360 đã có sẵn (`/related`).
 * Deal/Quote/Contract/Project lồng bên trong CHỈ hiện tóm tắt đọc-only (không
 * click sâu thêm 1 lớp Quick View riêng) vì dữ liệu thô trả về từ endpoint
 * này thiếu field (owner name, SLA, time-in-stage...) mà Quick View chuẩn của
 * từng loại cần - dựng thêm sẽ phải suy đoán/bịa field, cố tình không làm. */
export function ProgressCustomerDrawer({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerRelatedRecords | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    Promise.all([progressRepository.getCustomerRelated(customerId), seedingCrmRepository.getAgents()])
      .then(([res, agents]) => {
        if (!alive) return;
        setData(res);
        const owner = agents.find(a => a.id === res.customer.owner_id);
        setOwnerName(owner?.name || null);
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được khách hàng.');
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  if (error) return <p className="crm-empty-log progress-error">{error}</p>;
  if (!data) return <p className="crm-empty-log">Đang tải...</p>;

  const c = data.customer;
  const openDeals = data.deals.filter(d => d.deal_stage !== 'post_sale_care' && d.deal_stage !== 'lost' && d.deal_stage !== 'won');

  return (
    <div className="progress-panel">
      <span className={`qc-badge ${CUSTOMER_STATUS_TONE[c.status || ''] || 'qc-badge-neutral'}`} style={{ width: 'fit-content' }}>
        {customerStatusLabel(c.status)}
      </span>

      <dl className="progress-key-value">
        <div className="full"><dt>Công ty</dt><dd>{c.company_name || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{ownerName || '—'}</dd></div>
        <div><dt>Liên hệ</dt><dd>{c.phone || c.email || '—'}</dd></div>
      </dl>

      <div className="progress-mini-grid progress-mini-grid-4">
        <MiniInline label="Cơ hội" value={data.kpi.deal_count} />
        <MiniInline label="Dự án" value={data.projects.length} />
        <MiniInline label="Báo giá" value={data.kpi.quote_count} />
        <MiniInline label="Hợp đồng" value={data.kpi.contract_count} />
      </div>
      <div className="progress-mini-grid progress-mini-grid-2">
        <MiniInline label="Pipeline" value={formatVND(data.kpi.total_value) || '0 đ'} isText />
      </div>

      <section className="progress-drawer-section">
        <h3>Cơ hội ({openDeals.length} đang mở / {data.deals.length} tổng)</h3>
        {data.deals.length === 0 ? (
          <p className="crm-empty-log">Chưa có cơ hội nào.</p>
        ) : (
          <div className="progress-record-list">
            {data.deals.map(d => (
              <div key={d.id} className="progress-record-card" style={{ cursor: 'default' }}>
                <span className="progress-record-card-icon">🎯</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{dealStageLabel(d.deal_stage)}</div>
                  <div className="progress-record-card-sub">{d.follow_up_date ? `Follow-up: ${new Date(d.follow_up_date).toLocaleDateString('vi-VN')}` : 'Không có follow-up'}</div>
                </div>
                <div className="progress-record-card-value">{formatVND(d.estimated_budget || 0) || '0 đ'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.projects.length > 0 ? (
        <section className="progress-drawer-section">
          <h3>Dự án ({data.projects.length})</h3>
          <div className="progress-record-list">
            {data.projects.map(p => (
              <div key={p.id} className="progress-record-card" style={{ cursor: 'default' }}>
                <span className="progress-record-card-icon">📁</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{p.name || p.project_code}</div>
                  <div className="progress-record-card-sub">{p.status || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="progress-drawer-section">
        <h3>Báo giá ({data.quotes.length})</h3>
        {data.quotes.length === 0 ? (
          <p className="crm-empty-log">Chưa có báo giá nào.</p>
        ) : (
          <div className="progress-record-list">
            {data.quotes.map(q => (
              <div key={q.id} className="progress-record-card" style={{ cursor: 'default' }}>
                <span className="progress-record-card-icon">📄</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{q.quote_number}</div>
                  <div className="progress-record-card-sub">{q.processing_stage || q.status || '—'}</div>
                </div>
                <div className="progress-record-card-value">{formatVND(q.total_amount || 0) || '0 đ'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.contracts.length > 0 ? (
        <section className="progress-drawer-section">
          <h3>Hợp đồng ({data.contracts.length})</h3>
          <div className="progress-record-list">
            {data.contracts.map(ct => (
              <div key={ct.id} className="progress-record-card" style={{ cursor: 'default' }}>
                <span className="progress-record-card-icon">📝</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{ct.contract_number || ct.title}</div>
                  <div className="progress-record-card-sub">{ct.status || '—'}</div>
                </div>
                <div className="progress-record-card-value">{formatVND(ct.contract_value || 0) || '0 đ'}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <a href={`/all-platform/crm/customers/${customerId}`} className="qc-btn qc-btn-primary progress-open-full">
        Mở hồ sơ khách hàng đầy đủ
      </a>
    </div>
  );
}

function MiniInline({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div className="progress-mini-stat">
      <span>{label}</span>
      <b style={{ fontSize: isText ? 14 : 16 }}>{value}</b>
    </div>
  );
}
