'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, PauseCircle, XCircle } from './icons';
import { DealCard } from './DealCard';
import { DEAL_STAGE_META, PIPELINE_COLUMNS, formatVND, hasFullCrmAccess } from '../constants/crmConfig';
import type { Deal, DealStage } from '../types';
import { useAppAuth } from '@/contexts/AppAuthContext';

type Props = {
  deals: Deal[];
  loading?: boolean;
  onCardClick: (deal: Deal) => void;
  onContractClick: (deal: Deal) => void;
  onCreateQuote?: (deal: Deal) => void;
  onRequestMove: (deal: Deal, toStage: DealStage) => void;
};

type TerminalStage = Extract<DealStage, 'won' | 'lost' | 'on_hold'>;

const terminalStages: TerminalStage[] = ['won', 'lost', 'on_hold'];

const terminalPalette = {
  won: {
    className: 'crm-terminal-zone--won',
    icon: CheckCircle2,
    resultLabel: 'Hoàn thành',
    helper: 'Kéo deal đã chốt vào đây để ghi nhận doanh thu.',
  },
  lost: {
    className: 'crm-terminal-zone--lost',
    icon: XCircle,
    resultLabel: 'Từ chối',
    helper: 'Kéo deal bị từ chối vào đây để đóng pipeline.',
  },
  on_hold: {
    className: 'crm-terminal-zone--hold',
    icon: PauseCircle,
    resultLabel: 'Tạm dừng',
    helper: 'Kéo deal đang tạm dừng vào đây và ghi rõ lý do.',
  },
} satisfies Record<TerminalStage, { className: string; icon: typeof CheckCircle2; resultLabel: string; helper: string }>;

export function CrmKanbanBoard({ deals, loading, onCardClick, onContractClick, onCreateQuote, onRequestMove }: Props) {
  const { user } = useAppAuth();
  // "Kết quả cuối cùng" (khu kéo-thả đóng deal + tổng doanh thu) chỉ admin/
  // leader/sale xem — member thường vẫn tự đóng deal của mình bình thường qua
  // nút "Chuyển giai đoạn tiếp theo" trong DetailDrawer (không cần khu này).
  const canSeeFinalResults = hasFullCrmAccess(user);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const grouped = useMemo(() => {
    const out = Object.fromEntries(
      [...PIPELINE_COLUMNS, ...terminalStages].map(stage => [stage, [] as Deal[]])
    ) as Record<DealStage, Deal[]>;
    deals.forEach(deal => out[deal.stage]?.push(deal));
    return out;
  }, [deals]);

  const terminalStats = useMemo(
    () =>
      Object.fromEntries(
        terminalStages.map(stage => [
          stage,
          {
            count: grouped[stage].length,
            value: grouped[stage].reduce((sum, deal) => sum + Number(deal.estimatedBudget || deal.lifetimeValue || deal.quote?.totalAmount || 0), 0),
          },
        ])
      ) as Record<TerminalStage, { count: number; value: number }>,
    [grouped]
  );

  function onDragStart(event: React.DragEvent, deal: Deal) {
    event.dataTransfer.setData('text/plain', deal.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDrop(event: React.DragEvent, stage: DealStage) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const deal = deals.find(item => item.id === id);
    setDragOverStage(null);
    if (!deal || deal.stage === stage) return;
    onRequestMove(deal, stage);
  }

  if (loading) {
    return (
      <div className="crm-board-loading">
        <Loader2 className="crm-spin-icon" />
        <span>Đang tải dữ liệu...</span>
      </div>
    );
  }

  return (
    <div className="crm-board">
      <section className="crm-board-section">
        <div className="crm-section-heading">
          <div>
            <h2>Pipeline bán hàng</h2>
            <p>Kéo thả deal qua từng giai đoạn. Trạng thái cuối nằm riêng bên dưới.</p>
          </div>
        </div>

        <div className="crm-pipeline-scroll">
          <div className="crm-pipeline-grid">
            {PIPELINE_COLUMNS.map(stage => (
              <div
                key={stage}
                data-crm-stage-column={stage}
                className={`crm-stage-column ${dragOverStage === stage ? 'crm-stage-column--active' : ''}`}
                onDragOver={event => {
                  event.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={event => onDrop(event, stage)}
              >
                <div className="crm-stage-header">
                  <div className="crm-stage-title">
                    <span className="crm-stage-dot" style={{ backgroundColor: DEAL_STAGE_META[stage].color }} />
                    <h3>{DEAL_STAGE_META[stage].label}</h3>
                  </div>
                  <span className="crm-stage-count">{grouped[stage].length}</span>
                </div>
                <div className="crm-stage-body">
                  {!grouped[stage].length ? <div className="crm-empty-dropzone">Kéo deal vào đây</div> : null}
                  {grouped[stage].map(deal => (
                    <DealCard key={deal.id} deal={deal} onClick={onCardClick} onContractClick={onContractClick} onCreateQuote={onCreateQuote} onDragStart={onDragStart} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {canSeeFinalResults ? (
        <>
          <div className="crm-terminal-divider">
            <span />
            <b>TRẠNG THÁI CUỐI</b>
            <span />
          </div>

          <section className="crm-board-section">
            <div className="crm-section-heading">
              <div>
                <h2>Kết quả cuối cùng</h2>
                <p>Kéo deal vào các trạng thái cuối để đóng vòng pipeline.</p>
              </div>
            </div>

            <div className="crm-terminal-zones">
              {terminalStages.map(stage => {
                const { className, helper, icon: Icon, resultLabel } = terminalPalette[stage];
                const stats = terminalStats[stage];
                return (
                  <div
                    key={stage}
                    className={`crm-terminal-zone ${className} ${dragOverStage === stage ? 'crm-terminal-zone--active' : ''}`}
                    onDragOver={event => {
                      event.preventDefault();
                      setDragOverStage(stage);
                    }}
                    onDragLeave={() => setDragOverStage(null)}
                    onDrop={event => onDrop(event, stage)}
                  >
                    <div className="crm-terminal-icon">
                      <Icon />
                    </div>
                    <h3>{resultLabel}</h3>
                    <p>{helper}</p>
                    <strong>
                      {stats.count} deal{stats.value > 0 ? ` · ${formatVND(stats.value)}` : ''}
                    </strong>
                  </div>
                );
              })}
            </div>

            <div className="crm-terminal-rows">
              {terminalStages.map(stage => {
                const Icon = terminalPalette[stage].icon;
                return (
                <div
                  key={stage}
                  data-crm-terminal-stage={stage}
                  className="crm-terminal-row"
                  onDragOver={event => {
                    event.preventDefault();
                    setDragOverStage(stage);
                  }}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={event => onDrop(event, stage)}
                >
                  <div className="crm-terminal-row-head">
                    <span className="crm-terminal-row-dot" style={{ backgroundColor: DEAL_STAGE_META[stage].color }} />
                    <Icon className="crm-line-icon" />
                    <h4>{DEAL_STAGE_META[stage].label}</h4>
                    <span className="crm-terminal-row-count">{grouped[stage].length}</span>
                  </div>
                  <div className="crm-terminal-card-list">
                    {!grouped[stage].length ? <div className="crm-terminal-empty">Kéo deal vào đây</div> : null}
                    {grouped[stage].map(deal => (
                      <DealCard key={deal.id} deal={deal} terminal onClick={onCardClick} onContractClick={onContractClick} onCreateQuote={onCreateQuote} onDragStart={onDragStart} />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

