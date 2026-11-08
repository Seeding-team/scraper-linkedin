'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  User,
  Users,
  Building2,
  Handshake,
  Box,
  FileText,
  AlertTriangle,
  FileCheck,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ProgressOverviewKpis, ProgressMemberSummaryRow } from './progress.types';

export type FlatMember = ProgressMemberSummaryRow & {
  teamId: string;
  teamName: string | null;
};

export interface ProgressMembersListViewProps {
  members: FlatMember[];
  allMembers?: FlatMember[];
  overviewKpis?: ProgressOverviewKpis | null;
  onOpen: (memberId: string, memberName: string) => void;
}

const AVATAR_COLORS = [
  '#f43f5e',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#6366f1',
];

// Avatar ký tự viết tắt chuẩn CRM, hỗ trợ tự động hiển thị ảnh thật nếu BE/DB cung cấp avatarUrl trong tương lai
function MemberAvatar({
  name,
  index,
  avatarUrl,
}: {
  name: string;
  index: number;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="progress-member-avatar-img"
        title={name}
      />
    );
  }
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const bg = AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <span
      className="progress-member-avatar-initial"
      style={{ backgroundColor: bg }}
      title={name}
    >
      {initial}
    </span>
  );
}

function formatVND(val: number | null | undefined): string {
  if (!val || val <= 0) return '0 đ';
  return `${val.toLocaleString('vi-VN')} đ`;
}

export function ProgressMembersListView({
  members,
  allMembers,
  overviewKpis,
  onOpen,
}: ProgressMembersListViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [members]);

  // 8 KPI Summary Cards calculation
  const stats = useMemo(() => {
    const list = allMembers && allMembers.length > 0 ? allMembers : members;
    return {
      totalMembers: list.length,
      leadCount: overviewKpis?.leadsInProgress?.count ?? list.reduce((s, m) => s + (m.leadCount || 0), 0),
      customerCount: overviewKpis?.customersBeingCared?.count ?? list.reduce((s, m) => s + (m.customerCount || 0), 0),
      dealCount: overviewKpis?.dealsOpen?.count ?? list.reduce((s, m) => s + (m.dealCount || 0), 0),
      projectCount: overviewKpis?.projectsActive?.count ?? list.reduce((s, m) => s + (m.projectCount || 0), 0),
      quoteCount: overviewKpis?.quotesInProgress?.count ?? list.reduce((s, m) => s + (m.quoteCount || 0), 0),
      quotesOverSlaCount: overviewKpis?.quotesOverSla?.count ?? list.reduce((s, m) => s + (m.quotesOverSlaCount || 0), 0),
      contractCount: overviewKpis?.contractsTracked?.count ?? list.reduce((s, m) => s + (m.contractCount || 0), 0),
    };
  }, [members, allMembers, overviewKpis]);

  // Filtered members by local search term, sorted by pipeline value descending
  const filteredMembers = useMemo(() => {
    let list = members;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(m => {
        const name = (m.userName || '').toLowerCase();
        const team = (m.teamName || '').toLowerCase();
        const role = (m.role || '').toLowerCase();
        return name.includes(q) || team.includes(q) || role.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const pipeDiff = (b.pipelineValueVnd || 0) - (a.pipelineValueVnd || 0);
      if (pipeDiff !== 0) return pipeDiff;
      const workA = (a.leadCount || 0) + (a.customerCount || 0) + (a.dealCount || 0) + (a.projectCount || 0) + (a.quoteCount || 0);
      const workB = (b.leadCount || 0) + (b.customerCount || 0) + (b.dealCount || 0) + (b.projectCount || 0) + (b.quoteCount || 0);
      return workB - workA;
    });
  }, [members, searchTerm]);

  // Auto select first member if none selected
  const activeSelectedId = selectedMemberId || filteredMembers[0]?.userId || null;

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const currentSafePage = Math.min(currentPage, totalPages);
  const paginatedMembers = useMemo(() => {
    const start = (currentSafePage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize);
  }, [filteredMembers, currentSafePage, pageSize]);

  const startRecord = filteredMembers.length > 0 ? (currentSafePage - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(currentSafePage * pageSize, filteredMembers.length);

  const handleExport = () => {
    if (!filteredMembers.length) return;
    const headers = ['#', 'Thành viên', 'Team', 'Role', 'Lead', 'KH', 'Cơ hội', 'Dự án', 'Báo giá', 'Hợp đồng', 'Quá SLA', 'Pipeline (VNĐ)'];
    const rows = filteredMembers.map((m, idx) => [
      idx + 1,
      `"${(m.userName || '').replace(/"/g, '""')}"`,
      `"${(m.teamName || '—').replace(/"/g, '""')}"`,
      (m.role || '').toLowerCase().includes('lead') || (m.userName || '').toLowerCase().includes('tiên') ? 'Leader' : 'Member',
      m.leadCount || 0,
      m.customerCount || 0,
      m.dealCount || 0,
      m.projectCount || 0,
      m.quoteCount || 0,
      m.contractCount || 0,
      m.quotesOverSlaCount || 0,
      m.pipelineValueVnd || 0,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `danh_sach_thanh_vien_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="progress-members-container">
      {/* 8 KPI Summary Cards (2 rows x 4 columns) */}
      <div className="progress-members-kpi-grid">
        {/* Card 1: Tổng thành viên */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-rose">
              <User size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.totalMembers}</div>
          </div>
          <div className="progress-members-kpi-title">Tổng thành viên</div>
        </div>

        {/* Card 2: Lead đang xử lý */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-emerald">
              <Users size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.leadCount}</div>
          </div>
          <div className="progress-members-kpi-title">Lead đang xử lý</div>
        </div>

        {/* Card 3: Khách hàng */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-pink">
              <Building2 size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.customerCount}</div>
          </div>
          <div className="progress-members-kpi-title">Khách hàng</div>
        </div>

        {/* Card 4: Cơ hội */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-blue">
              <Handshake size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.dealCount}</div>
          </div>
          <div className="progress-members-kpi-title">Cơ hội</div>
        </div>

        {/* Card 5: Dự án */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-purple">
              <Box size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.projectCount}</div>
          </div>
          <div className="progress-members-kpi-title">Dự án</div>
        </div>

        {/* Card 6: Báo giá */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-amber">
              <FileText size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.quoteCount}</div>
          </div>
          <div className="progress-members-kpi-title">Báo giá</div>
        </div>

        {/* Card 7: Báo giá quá SLA */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-red">
              <AlertTriangle size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.quotesOverSlaCount}</div>
          </div>
          <div className="progress-members-kpi-title">Báo giá quá SLA</div>
        </div>

        {/* Card 8: Hợp đồng */}
        <div className="progress-members-kpi-card">
          <div className="progress-members-kpi-left">
            <div className="progress-members-kpi-icon-box kpi-icon-slate">
              <FileCheck size={20} strokeWidth={2.2} />
            </div>
            <div className="progress-members-kpi-num">{stats.contractCount}</div>
          </div>
          <div className="progress-members-kpi-title">Hợp đồng</div>
        </div>
      </div>

      {/* Main Members Table Card */}
      <section className="progress-members-table-card">
        {/* Table Header & Controls Toolbar */}
        <div className="progress-members-toolbar">
          <div className="progress-members-title-wrap">
            <h2 className="progress-members-title">Danh sách thành viên</h2>
            <p className="progress-members-subtitle">
              {filteredMembers.length} thành viên · Click vào tên thành viên để xem chi tiết tiến độ
            </p>
          </div>

          <div className="progress-members-actions">
            <div className="progress-members-search-box">
              <Search size={15} className="progress-members-search-icon" />
              <input
                type="text"
                placeholder="Tìm thành viên..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="progress-members-search-input"
              />
            </div>

            <button
              type="button"
              className="progress-members-export-btn"
              onClick={handleExport}
              title="Xuất danh sách ra file CSV"
            >
              <Download size={15} />
              <span>Xuất</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        {filteredMembers.length === 0 ? (
          <div className="progress-members-empty">
            <p>Không tìm thấy thành viên phù hợp.</p>
          </div>
        ) : (
          <div className="progress-members-table-wrap">
            <table className="progress-members-table">
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                  <th style={{ minWidth: '180px' }}>Thành viên</th>
                  <th style={{ minWidth: '120px' }}>Team</th>
                  <th style={{ width: '90px' }}>Role</th>
                  <th className="num-col">Lead</th>
                  <th className="num-col">KH</th>
                  <th className="num-col">Cơ hội</th>
                  <th className="num-col">Dự án</th>
                  <th className="num-col">Báo giá</th>
                  <th className="num-col">Hợp đồng</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Quá SLA</th>
                  <th className="num-col" style={{ minWidth: '130px' }}>Pipeline</th>
                </tr>
              </thead>
              <tbody>
                {paginatedMembers.map((m, idx) => {
                  const globalIdx = (currentSafePage - 1) * pageSize + idx + 1;
                  const isSelected = m.userId === activeSelectedId;
                  const isLeader =
                    (m.role || '').toLowerCase().includes('lead') ||
                    (m.userName || '').toLowerCase().includes('tiên');

                  return (
                    <tr
                      key={m.userId}
                      className={`progress-member-tr ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedMemberId(m.userId);
                        onOpen(m.userId, m.userName || m.userId);
                      }}
                    >
                      <td className="stt-col">{globalIdx}</td>
                      <td>
                        <div className="progress-member-profile-cell">
                          <MemberAvatar
                            name={m.userName || ''}
                            index={globalIdx}
                            avatarUrl={(m as any).avatarUrl || (m as any).avatar || (m as any).avatar_url}
                          />
                          <span className="progress-member-name">{m.userName || 'Chưa đặt tên'}</span>
                        </div>
                      </td>
                      <td className="team-col">{m.teamName || '—'}</td>
                      <td>
                        <span className={`progress-role-badge ${isLeader ? 'role-leader' : 'role-member'}`}>
                          {isLeader ? 'Leader' : 'Member'}
                        </span>
                      </td>
                      <td className="num-col">{m.leadCount || 0}</td>
                      <td className="num-col">{m.customerCount || 0}</td>
                      <td className="num-col">{m.dealCount || 0}</td>
                      <td className="num-col">{m.projectCount || 0}</td>
                      <td className="num-col">{m.quoteCount || 0}</td>
                      <td className="num-col">{m.contractCount || 0}</td>
                      <td style={{ textAlign: 'center' }}>
                        {m.quotesOverSlaCount > 0 ? (
                          <span className="progress-sla-badge badge-overdue">
                            {m.quotesOverSlaCount}
                          </span>
                        ) : (
                          <span className="progress-sla-badge badge-zero">0</span>
                        )}
                      </td>
                      <td className="num-col pipeline-col">
                        {formatVND(m.pipelineValueVnd)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="progress-members-pagination">
          <div className="progress-pagination-info">
            Hiển thị {startRecord} - {endRecord} trên {filteredMembers.length} thành viên
          </div>

          <div className="progress-pagination-pages">
            <button
              type="button"
              className="progress-pagination-btn nav-btn"
              disabled={currentSafePage <= 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              aria-label="Trang trước"
            >
              <ChevronLeft size={16} />
            </button>

            {Array.from({ length: totalPages }).map((_, pIdx) => {
              const pageNum = pIdx + 1;
              const isActive = pageNum === currentSafePage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  className={`progress-pagination-btn page-num-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              type="button"
              className="progress-pagination-btn nav-btn"
              disabled={currentSafePage >= totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              aria-label="Trang sau"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="progress-pagination-size">
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="progress-pagination-select"
            >
              <option value={10}>Hiển thị 10 / trang</option>
              <option value={20}>Hiển thị 20 / trang</option>
              <option value={50}>Hiển thị 50 / trang</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
