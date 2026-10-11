'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { seedingContractRepository } from '../repositories/SeedingContractRepository';
import { contractStatusClass, contractStatusLabel } from '../constants/contractConfig';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import { ContractAIWizard } from '@/modules/crm/integrations/contracts';
import { ContractTemplatesPanel } from '@/modules/contract-templates';
import type { Contract, ContractDashboardStats } from '../types';

type ContractTab = 'contracts' | 'templates';

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  return `${formatDate(start)}–${formatDate(end)}`;
}

function compactMoney(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ ₫`;
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu ₫`;
  return formatVnd(value);
}

function ownerInitial(name?: string | null) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

export function ContractHomePage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [stats, setStats] = useState<ContractDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ContractTab>('contracts');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [list, dashboardStats] = await Promise.all([
        seedingContractRepository.getContracts(),
        seedingContractRepository.getDashboardStats(),
      ]);
      setContracts(list);
      setStats(dashboardStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách hợp đồng.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = contracts.filter(contract => {
    if (statusFilter && contract.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      contract.contractNumber.toLowerCase().includes(q) ||
      contract.title.toLowerCase().includes(q) ||
      (contract.dealCustomerName || '').toLowerCase().includes(q) ||
      (contract.manualCustomerName || '').toLowerCase().includes(q) ||
      (contract.dealCompanyName || '').toLowerCase().includes(q)
    );
  });

  function exportCsv() {
    const header = ['Số hợp đồng', 'Tiêu đề', 'Khách hàng', 'Công ty', 'Giá trị', 'Bắt đầu', 'Kết thúc', 'Tiến độ %', 'Đã thu %', 'Phụ trách', 'Trạng thái'];
    const rows = filtered.map(c => [
      c.contractNumber, c.title, c.dealCustomerName || c.manualCustomerName || '', c.dealCompanyName || '',
      String(c.contractValue), c.startDate || '', c.endDate || '',
      String(c.progressPercent), String(c.paymentCollectedPercent), c.ownerName || '', contractStatusLabel(c.status),
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hop-dong-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="contract-page">
      <header className="contract-head">
        <div>
          <h1>Quản lý hợp đồng</h1>
          <p>Theo dõi ký kết, thực hiện, nghiệm thu và thanh toán hợp đồng</p>
        </div>
        <div className="contract-head-actions">
          <button type="button" className="contract-button contract-button--secondary" onClick={() => void load()}>
            Làm mới
          </button>
          {activeTab === 'contracts' ? (
            <button type="button" className="contract-button contract-button--secondary" onClick={exportCsv} disabled={filtered.length === 0}>
              ↓ Xuất dữ liệu
            </button>
          ) : null}
          <button
            type="button"
            className="contract-button contract-button--secondary"
            onClick={() => setActiveTab(activeTab === 'contracts' ? 'templates' : 'contracts')}
          >
            {activeTab === 'contracts' ? '📎 Mẫu hợp đồng' : '← Danh sách hợp đồng'}
          </button>
          {activeTab === 'contracts' ? (
            <button type="button" className="contract-button contract-button--primary" onClick={() => setWizardOpen(true)}>
              ✦ Soạn hợp đồng bằng AI
            </button>
          ) : null}
        </div>
      </header>

      {activeTab === 'templates' ? <ContractTemplatesPanel /> : null}

      {activeTab === 'contracts' ? (
      <>
      <section className="contract-ai-hero">
        <div>
          <span style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', opacity: 0.75 }}>
            AI CONTRACT COPILOT
          </span>
          <h2>Soạn hợp đồng từ dữ liệu CRM trong vài phút</h2>
          <p>
            AI tự lấy hồ sơ khách hàng, báo giá đã chốt, phạm vi công việc và điều khoản chuẩn; đồng thời
            kiểm tra thiếu sót, xung đột và rủi ro trước khi gửi duyệt.
          </p>
        </div>
        <button type="button" onClick={() => setWizardOpen(true)}>
          ✦ Tạo hợp đồng với AI
        </button>
      </section>

      {stats ? (
        <section className="contract-stats">
          <article className="contract-stat">
            <span>Hợp đồng hiệu lực</span>
            <strong>{stats.activeCount}</strong>
            <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#168c61' }}>
              Tổng giá trị {compactMoney(stats.activeValue)}
            </small>
          </article>
          <article className="contract-stat">
            <span>Chờ ký</span>
            <strong>{stats.pendingSignatureCount}</strong>
            <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#bf7810' }}>
              Cần xử lý sớm
            </small>
          </article>
          <article className="contract-stat">
            <span>Sắp hết hạn</span>
            <strong>{stats.expiringCount}</strong>
            <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#bf7810' }}>
              Trong 30 ngày tới
            </small>
          </article>
          <article className="contract-stat">
            <span>Công nợ đến hạn</span>
            <strong>{compactMoney(stats.outstandingValue)}</strong>
            <small style={{ display: 'block', marginTop: '0.3rem', fontSize: '0.72rem', color: '#c8214f' }}>
              {stats.outstandingCount} kỳ thanh toán
            </small>
          </article>
        </section>
      ) : null}

      <div className="contract-head-actions" style={{ marginTop: '1.25rem' }}>
        <input
          type="text"
          placeholder="Tìm số hợp đồng, khách hàng, tiêu đề..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          style={{ minHeight: '2.35rem', borderRadius: '0.55rem', border: '1px solid #cbd5e1', padding: '0 0.75rem', minWidth: '260px' }}
        />
        <select
          value={statusFilter}
          onChange={event => setStatusFilter(event.target.value)}
          style={{ minHeight: '2.35rem', borderRadius: '0.55rem', border: '1px solid #cbd5e1', padding: '0 0.5rem' }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="draft">Bản nháp</option>
          <option value="pending_legal">Chờ pháp chế duyệt</option>
          <option value="pending_signature">Chờ ký</option>
          <option value="signed">Đã ký</option>
          <option value="active">Đang thực hiện</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="expiring">Sắp hết hạn</option>
          <option value="expired">Đã hết hạn</option>
          <option value="terminated">Đã chấm dứt</option>
        </select>
      </div>

      {loading ? <section className="contract-state">Đang tải danh sách hợp đồng...</section> : null}
      {error ? <section className="contract-state contract-state--error">{error}</section> : null}

      {!loading && !error ? (
        <div className="contract-table-wrap">
          <table className="contract-table">
            <thead>
              <tr>
                <th>Hợp đồng</th>
                <th>Khách hàng</th>
                <th>Giá trị</th>
                <th>Thời hạn</th>
                <th>Tiến độ</th>
                <th>Thanh toán</th>
                <th>Phụ trách</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-row">Chưa có hợp đồng nào.</td>
                </tr>
              ) : (
                filtered.map(contract => (
                  <tr key={contract.id}>
                    <td>
                      <strong>{contract.contractNumber}</strong>
                      <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{contract.title}</div>
                    </td>
                    <td>
                      <strong>{contract.dealCustomerName || contract.manualCustomerName || '—'}</strong>
                      {contract.dealCompanyName ? <div style={{ color: '#94a3b8', fontSize: '0.76rem' }}>{contract.dealCompanyName}</div> : null}
                    </td>
                    <td>{formatVnd(contract.contractValue)}</td>
                    <td>{formatDateRange(contract.startDate, contract.endDate)}</td>
                    <td>
                      <strong style={{ fontSize: '0.78rem' }}>{contract.progressPercent}%</strong>
                      <div style={{ width: '90px', height: '6px', borderRadius: '4px', background: '#edf0f4', overflow: 'hidden', marginTop: '4px' }}>
                        <span style={{ display: 'block', height: '100%', width: `${contract.progressPercent}%`, background: '#be1e4b', borderRadius: '4px' }} />
                      </div>
                    </td>
                    <td>Đã thu {contract.paymentCollectedPercent}%</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#fde8ee', color: '#be1e4b', display: 'grid', placeItems: 'center', fontSize: '0.68rem', fontWeight: 700 }}>
                          {ownerInitial(contract.ownerName)}
                        </span>
                        {contract.ownerName || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`contract-badge ${contractStatusClass(contract.status)}`}>
                        {contractStatusLabel(contract.status)}
                      </span>
                    </td>
                    <td>
                      <Link href={`/all-platform/contracts/${contract.id}`} className="contract-button contract-button--secondary">
                        Chi tiết
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      </>
      ) : null}

      <ContractAIWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          setWizardOpen(false);
          void load();
        }}
      />
    </main>
  );
}
