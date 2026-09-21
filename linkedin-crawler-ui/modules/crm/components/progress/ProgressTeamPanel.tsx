'use client';

import { useEffect, useMemo, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatVND } from '../../constants/crmConfig';
import { ProgressDonut } from './ProgressDonut';
import { QuotesTable } from './ProgressMemberPanel';
import type { ProgressQuoteItem, ProgressTeamDetail } from './progress.types';

type TeamTab = 'overview' | 'members' | 'action';

/** Team detail - CHỐT 3 tab đúng theo yêu cầu: Tổng quan (cơ cấu record +
 * tình trạng SLA báo giá) / Thành viên (click mở Member Quick View) / Cần xử
 * lý (chỉ liệt kê báo giá quá SLA - MỘT nguồn actionable thật duy nhất ở cấp
 * team hiện có, không bịa thêm "Lead quá hạn"/"Deal kẹt" vì team-level không
 * có list Lead/Deal riêng, chỉ có count tổng hợp). */
export function ProgressTeamPanel({
  teamId,
  onOpenMember,
  onOpenQuote,
}: {
  teamId: string;
  onOpenMember: (userId: string, userName: string) => void;
  onOpenQuote: (quote: ProgressQuoteItem) => void;
}) {
  const [detail, setDetail] = useState<ProgressTeamDetail | null>(null);
  const [quotes, setQuotes] = useState<ProgressQuoteItem[] | null>(null);
  const [tab, setTab] = useState<TeamTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    setQuotes(null);
    setTab('overview');
    Promise.all([progressRepository.getTeamDetail(teamId), progressRepository.listQuotes({ teamId })])
      .then(([teamRes, quoteRes]) => {
        if (!alive) return;
        setDetail(teamRes);
        setQuotes(quoteRes.items);
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được team.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [teamId]);

  const slaDonut = useMemo(() => {
    if (!quotes) return [];
    const buckets = { overdue: 0, due_soon: 0, in_progress: 0, completed_on_time: 0, completed_late: 0, not_set: 0 };
    for (const q of quotes) buckets[q.sla.status] = (buckets[q.sla.status] || 0) + 1;
    return [
      { label: 'Đúng hạn', value: buckets.completed_on_time + buckets.in_progress, color: '#118a5b' },
      { label: 'Sắp đến hạn', value: buckets.due_soon, color: '#bd6800' },
      { label: 'Quá SLA', value: buckets.overdue + buckets.completed_late, color: '#bf2d2d' },
      { label: 'Chưa thiết lập', value: buckets.not_set, color: '#9099a7' },
    ];
  }, [quotes]);

  const compositionDonut = useMemo(() => {
    const t = detail?.team;
    if (!t) return [];
    return [
      { label: 'Lead', value: t.leadCount, color: '#6b7bd6' },
      { label: 'Khách hàng', value: t.customerCount, color: '#3f8cff' },
      { label: 'Cơ hội', value: t.dealCount, color: '#00a3a1' },
      { label: 'Dự án', value: t.projectCount, color: '#7a5cff' },
      { label: 'Báo giá', value: t.quoteCount, color: '#bd6800' },
      { label: 'Hợp đồng', value: t.contractCount, color: '#118a5b' },
    ];
  }, [detail]);

  const overdueQuotes = useMemo(() => (quotes || []).filter(q => q.sla.status === 'overdue' || q.sla.status === 'completed_late'), [quotes]);

  const team = detail?.team;

  if (loading) return <p className="crm-empty-log">Đang tải chi tiết team...</p>;
  if (error) return <p className="crm-empty-log progress-error">{error}</p>;
  if (!team) return null;

  return (
    <div className="progress-panel">
      <div className="progress-mini-grid progress-mini-grid-4">
        <MiniStat label="Lead" value={team.leadCount} />
        <MiniStat label="Khách hàng" value={team.customerCount} />
        <MiniStat label="Cơ hội" value={team.dealCount} />
        <MiniStat label="Dự án" value={team.projectCount} />
        <MiniStat label="Báo giá" value={team.quoteCount} />
        <MiniStat label="Hợp đồng" value={team.contractCount} />
        <MiniStat label="Quá SLA" value={team.quotesOverSlaCount} danger={team.quotesOverSlaCount > 0} />
        <MiniStat label="Pipeline" value={formatVND(team.pipelineValueVnd) || '0 đ'} isText />
      </div>

      <div className="progress-subtabs">
        {([
          ['overview', 'Tổng quan'],
          ['members', 'Thành viên'],
          ['action', `Cần xử lý${overdueQuotes.length ? ` (${overdueQuotes.length})` : ''}`],
        ] as Array<[TeamTab, string]>).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          <div className="progress-drawer-section">
            <h3>Cơ cấu record</h3>
            {compositionDonut.some(s => s.value > 0) ? <ProgressDonut segments={compositionDonut} centerLabel="record" /> : <p className="crm-empty-log">Chưa có record.</p>}
          </div>
          <div className="progress-drawer-section">
            <h3>Tình trạng báo giá</h3>
            {slaDonut.some(s => s.value > 0) ? <ProgressDonut segments={slaDonut} centerLabel="báo giá" /> : <p className="crm-empty-log">Chưa có báo giá trong team.</p>}
          </div>
        </>
      ) : tab === 'members' ? (
        <MembersTable members={detail.members} onOpenMember={onOpenMember} />
      ) : (
        <div className="progress-drawer-section">
          <h3>Báo giá quá SLA</h3>
          {overdueQuotes.length === 0 ? (
            <p className="crm-empty-log">Không có báo giá nào quá SLA. 🎉</p>
          ) : (
            <QuotesTable items={overdueQuotes} onOpen={onOpenQuote} showOwner />
          )}
        </div>
      )}
    </div>
  );
}

function MembersTable({ members, onOpenMember }: { members: ProgressTeamDetail['members']; onOpenMember: (userId: string, userName: string) => void }) {
  if (!members.length) return <p className="crm-empty-log">Team chưa có thành viên nào có record CRM.</p>;
  return (
    <div className="qc-table-wrap progress-table-wrap">
      <table className="qc-team-table">
        <thead>
          <tr>
            <th>Thành viên</th>
            <th>Lead</th>
            <th>KH</th>
            <th>Cơ hội</th>
            <th>Dự án</th>
            <th>Báo giá</th>
            <th>Hợp đồng</th>
            <th>Quá SLA</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.userId} className="progress-row-clickable" onClick={() => onOpenMember(m.userId, m.userName || m.userId)}>
              <td><b>{m.userName}</b></td>
              <td>{m.leadCount}</td>
              <td>{m.customerCount}</td>
              <td>{m.dealCount}</td>
              <td>{m.projectCount}</td>
              <td>{m.quoteCount}</td>
              <td>{m.contractCount}</td>
              <td>{m.quotesOverSlaCount > 0 ? <span className="qc-badge qc-badge-danger">{m.quotesOverSlaCount}</span> : <span className="qc-badge qc-badge-neutral">0</span>}</td>
              <td className="progress-arrow">›</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MiniStat({ label, value, danger, isText }: { label: string; value: number | string; danger?: boolean; isText?: boolean }) {
  return (
    <div className="progress-mini-stat">
      <span>{label}</span>
      <b className={danger ? 'danger' : ''}>{isText ? value : value}</b>
    </div>
  );
}
