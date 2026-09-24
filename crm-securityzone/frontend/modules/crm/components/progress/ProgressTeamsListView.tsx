'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  List,
  LayoutGrid,
  Users,
  Laptop,
  Megaphone,
  Headphones,
  GraduationCap,
  Code2,
  Building2,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ProgressTeamSummary } from './progress.types';

// Leader name lấy từ database (từ team.leaderName hoặc tự nhận diện leader/admin từ members thật, nếu không có hiển thị 'Chưa phân công')
export function getLeaderName(
  team: ProgressTeamSummary,
  members?: Array<{ userId: string; userName: string | null; role?: string | null }>
): string {
  if (team.leaderName) return team.leaderName;
  if (members && members.length > 0) {
    const leader = members.find(m => m.role?.toLowerCase() === 'leader')
      || members.find(m => m.role?.toLowerCase() === 'admin');
    if (leader?.userName) return leader.userName;
  }
  return 'Chưa phân công';
}

// Team visual themes (matching the design in media_1790147833783.png)
function getTeamTheme(name: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('sales') || n.includes('kinh doanh')) {
    return {
      bg: '#fee2e2',
      color: '#ef4444',
      icon: Users,
    };
  }
  if ((n.includes('tech') || n.includes('kỹ thuật') || n.includes('giải pháp')) && !n.includes('intern')) {
    return {
      bg: '#dbeafe',
      color: '#3b82f6',
      icon: Laptop,
    };
  }
  if (n.includes('market')) {
    return {
      bg: '#dcfce7',
      color: '#22c55e',
      icon: Megaphone,
    };
  }
  if (n.includes('presale')) {
    return {
      bg: '#f3e8ff',
      color: '#a855f7',
      icon: Headphones,
    };
  }
  if (n.includes('intern l1')) {
    return {
      bg: '#ffedd5',
      color: '#f97316',
      icon: GraduationCap,
    };
  }
  if (n.includes('dev')) {
    return {
      bg: '#cffafe',
      color: '#0891b2',
      icon: Code2,
    };
  }
  if (n.includes('back-office') || n.includes('office')) {
    return {
      bg: '#f1f5f9',
      color: '#475569',
      icon: Building2,
    };
  }
  if (n.includes('intern l2') || n.includes('intern')) {
    return {
      bg: '#fce7f3',
      color: '#db2777',
      icon: GraduationCap,
    };
  }
  return {
    bg: '#ede9fe',
    color: '#7c3aed',
    icon: UserCheck,
  };
}

// Format currency full VND: ví dụ 89.000.000 đ, 1.280.000.000 đ, 0 đ
export function formatPipelineCompact(val: number | null | undefined): string {
  if (!val || val <= 0) return '0 đ';
  return `${val.toLocaleString('vi-VN')} đ`;
}

export function ProgressTeamsListView({
  teams,
  onOpen,
  teamMembersMap,
}: {
  teams: ProgressTeamSummary[];
  onOpen: (teamId: string, teamName: string) => void;
  teamMembersMap?: Record<string, Array<{ userId: string; userName: string | null }>>;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(teams[0]?.teamId || null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [teams]);

  const filteredTeams = useMemo(() => {
    if (!searchTerm.trim()) return teams;
    const q = searchTerm.toLowerCase().trim();
    return teams.filter(t => {
      const name = (t.teamName || t.teamId).toLowerCase();
      const actualMembers = teamMembersMap?.[t.teamName || t.teamId] || teamMembersMap?.[t.teamId] || [];
      const leader = getLeaderName(t, actualMembers).toLowerCase();
      return name.includes(q) || leader.includes(q);
    });
  }, [teams, searchTerm, teamMembersMap]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / pageSize));
  const currentSafePage = Math.min(currentPage, totalPages);
  const paginatedTeams = useMemo(() => {
    const start = (currentSafePage - 1) * pageSize;
    return filteredTeams.slice(start, start + pageSize);
  }, [filteredTeams, currentSafePage, pageSize]);

  const startRecord = filteredTeams.length > 0 ? (currentSafePage - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(currentSafePage * pageSize, filteredTeams.length);

  return (
    <div className="progress-teams-list-wrap">
      {/* Header with Title, Count, Search and View Toggle */}
      <div className="progress-teams-list-header">
        <div className="progress-teams-list-title-wrap">
          <h2 className="progress-teams-list-title">Danh sách team</h2>
          <p className="progress-teams-list-subtitle">
            Tổng {filteredTeams.length} team · Click vào team để xem chi tiết và danh sách thành viên
          </p>
        </div>

        <div className="progress-teams-list-toolbar">
          <div className="progress-teams-search-box">
            <Search className="progress-teams-search-icon" size={15} />
            <input
              type="text"
              className="progress-teams-search-input"
              placeholder="Tìm team..."
              value={searchTerm}
              onChange={e => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          <div className="progress-teams-view-toggle">
            <button
              type="button"
              className={`progress-teams-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Xem dạng danh sách"
              aria-label="Xem dạng danh sách"
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={`progress-teams-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Xem dạng lưới"
              aria-label="Xem dạng lưới"
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Team Cards Container (List or Grid) */}
      {filteredTeams.length === 0 ? (
        <div className="progress-teams-empty">
          <p>Không tìm thấy team nào phù hợp với từ khóa &quot;{searchTerm}&quot;.</p>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'progress-teams-grid' : 'progress-teams-list'}>
          {paginatedTeams.map((team, idx) => {
            const teamName = team.teamName || team.teamId;
            const actualMembers = teamMembersMap?.[teamName] || teamMembersMap?.[team.teamId] || [];
            const leader = getLeaderName(team, actualMembers);
            const theme = getTeamTheme(teamName);
            const Icon = theme.icon;
            const isSelected = selectedTeamId === team.teamId;

            return (
              <div
                key={team.teamId}
                className={`progress-team-card-row${isSelected ? ' is-selected' : ''}`}
                onClick={() => {
                  setSelectedTeamId(team.teamId);
                  onOpen(team.teamId, teamName);
                }}
              >
                {/* Left Side: Icon, Name, Leader, Avatars */}
                <div className="progress-team-card-left">
                  <div
                    className="progress-team-icon-box"
                    style={{ backgroundColor: theme.bg, color: theme.color }}
                  >
                    <Icon size={20} />
                  </div>

                  <div className="progress-team-meta">
                    <h3 className="progress-team-name">{teamName}</h3>
                    <p className="progress-team-leader">Leader: {leader}</p>
                  </div>
                </div>

                {/* Right Side: 9 Metrics Strip */}
                <div className="progress-team-card-stats">
                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.memberCount}</span>
                    <span className="progress-team-stat-label">Thành viên</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.leadCount}</span>
                    <span className="progress-team-stat-label">Lead</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.customerCount}</span>
                    <span className="progress-team-stat-label">Khách hàng</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.dealCount}</span>
                    <span className="progress-team-stat-label">Cơ hội</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.projectCount}</span>
                    <span className="progress-team-stat-label">Dự án</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.quoteCount}</span>
                    <span className="progress-team-stat-label">Báo giá</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span className="progress-team-stat-val">{team.contractCount}</span>
                    <span className="progress-team-stat-label">Hợp đồng</span>
                  </div>

                  <div className="progress-team-stat-col">
                    <span
                      className={`progress-team-sla-badge${
                        team.quotesOverSlaCount > 0 ? ' is-danger' : ' is-neutral'
                      }`}
                    >
                      {team.quotesOverSlaCount}
                    </span>
                    <span className="progress-team-stat-label">Quá SLA</span>
                  </div>

                  <div className="progress-team-stat-col progress-team-pipeline-col">
                    <span className="progress-team-stat-val pipeline-val">
                      {formatPipelineCompact(team.pipelineValueVnd)}
                    </span>
                    <span className="progress-team-stat-label">Pipeline</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Toolbar */}
      <div className="progress-teams-pagination">
        <div className="progress-pagination-info">
          Hiển thị {startRecord} - {endRecord} trên {filteredTeams.length} team
        </div>

        <div className="progress-pagination-pages">
          <button
            type="button"
            className="progress-pagination-btn"
            disabled={currentSafePage <= 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            aria-label="Trang trước"
          >
            <ChevronLeft size={16} />
          </button>

          {Array.from({ length: totalPages }).map((_, pIdx) => {
            const p = pIdx + 1;
            return (
              <button
                key={p}
                type="button"
                className={`progress-pagination-btn page-num-btn${p === currentSafePage ? ' active' : ''}`}
                onClick={() => setCurrentPage(p)}
              >
                {p}
              </button>
            );
          })}

          <button
            type="button"
            className="progress-pagination-btn"
            disabled={currentSafePage >= totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            aria-label="Trang tiếp"
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
    </div>
  );
}
