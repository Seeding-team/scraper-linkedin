'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedingContractRepository } from '../repositories/SeedingContractRepository';
import { contractStatusClass, contractStatusLabel, CONTRACT_STATUS_TRANSITIONS, extractPaymentTermsFromClauses } from '../constants/contractConfig';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import type { Contract, ContractClause } from '../types';
import { CurrencyInput } from '@/components/CurrencyInput';

function pdfSafe(value?: string | number | null) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdf(lines: string[]) {
  const content = [
    'BT',
    '/F1 13 Tf',
    '50 790 Td',
    ...lines.flatMap((line, index) => [index === 0 ? `(${pdfSafe(line)}) Tj` : `0 -20 Td (${pdfSafe(line)}) Tj`]),
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach(object => {
    offsets.push(pdf.length);
    pdf += object;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function downloadContractPdf(contract: Contract) {
  const lines = [
    `HOP DONG: ${contract.contractNumber}`,
    contract.title,
    `Gia tri: ${formatVnd(contract.contractValue)}`,
    `Trang thai: ${contractStatusLabel(contract.status)}`,
    '',
    ...contract.clauses.flatMap(c => [c.title, c.body, '']),
  ];
  const pdf = buildSimplePdf(lines);
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${contract.contractNumber.replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ContractDetailPage({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [contract, setContract] = useState<Contract | null>(null);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [activeClauseIndex, setActiveClauseIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [paymentCollectedPercent, setPaymentCollectedPercent] = useState(0);
  const [contractValue, setContractValue] = useState<number | null>(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await seedingContractRepository.getContract(contractId);
      setContract(data);
      setClauses(data.clauses);
      setProgressPercent(data.progressPercent);
      setPaymentCollectedPercent(data.paymentCollectedPercent);
      setContractValue(data.contractValue);
      setStartDate(data.startDate || '');
      setEndDate(data.endDate || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được hợp đồng.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  function updateClause(index: number, field: 'title' | 'body', value: string) {
    setClauses(current => current.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  async function saveClauses() {
    if (!contract) return;
    setSaving(true);
    try {
      const updated = await seedingContractRepository.updateContract(contract.id, {
        clauses,
        progressPercent,
        paymentCollectedPercent,
        contractValue: contractValue ?? 0,
        // Dong bo lai payment_terms tu noi dung dieu khoan THAT (co the vua sua
        // tay o duoi) - tranh lech voi noi dung hop dong that (xem ContractAIWizard
        // luc tao, cung dung chung helper nay).
        paymentTerms: extractPaymentTermsFromClauses(clauses),
        startDate: startDate || null,
        endDate: endDate || null,
      });
      setContract(updated);
      setClauses(updated.clauses);
      setProgressPercent(updated.progressPercent);
      setPaymentCollectedPercent(updated.paymentCollectedPercent);
      setContractValue(updated.contractValue);
      setStartDate(updated.startDate || '');
      setEndDate(updated.endDate || '');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      setSaving(false);
    }
  }

  async function runAiReview() {
    if (!contract) return;
    setReviewing(true);
    try {
      const review = await seedingContractRepository.reviewRisk({
        clauses,
        quoteId: contract.quoteId,
        contractValue: contractValue ?? 0,
        paymentTerms: extractPaymentTermsFromClauses(clauses),
      });
      const updated = await seedingContractRepository.updateContract(contract.id, {
        aiRiskScore: review.score ?? undefined,
        aiReview: review.findings,
      });
      setContract(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'AI kiểm tra rủi ro thất bại.');
    } finally {
      setReviewing(false);
    }
  }

  async function changeStatus(status: string) {
    if (!contract) return;
    try {
      const updated = await seedingContractRepository.updateStatus(contract.id, status);
      setContract(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không đổi được trạng thái.');
    }
  }

  if (loading) return <main className="contract-detail-page"><section className="contract-state">Đang tải hợp đồng...</section></main>;
  if (error || !contract) return <main className="contract-detail-page"><section className="contract-state contract-state--error">{error || 'Không tìm thấy hợp đồng.'}</section></main>;

  const nextStatuses = CONTRACT_STATUS_TRANSITIONS[contract.status] || [];

  return (
    <main className="contract-detail-page">
      <header className="contract-detail-header">
        <div>
          <button type="button" className="contract-button contract-button--secondary" onClick={() => router.push('/all-platform/contracts')} style={{ marginBottom: '0.6rem' }}>
            ← Danh sách hợp đồng
          </button>
          <h1>{contract.contractNumber}</h1>
          <p>
            {contract.title} · {formatVnd(contract.contractValue)}
            {contract.dealCustomerName || contract.manualCustomerName
              ? ` · ${contract.dealCustomerName || contract.manualCustomerName}${contract.dealCompanyName ? ` (${contract.dealCompanyName})` : ''}`
              : ''}
            {contract.ownerName ? ` · Phụ trách: ${contract.ownerName}` : ''}
          </p>
        </div>
        <div className="contract-head-actions">
          <span className={`contract-badge ${contractStatusClass(contract.status)}`}>{contractStatusLabel(contract.status)}</span>
          {nextStatuses.map(status => (
            <button key={status} type="button" className="contract-button contract-button--secondary" onClick={() => void changeStatus(status)}>
              {contractStatusLabel(status)}
            </button>
          ))}
          <button type="button" className="contract-button contract-button--secondary" onClick={() => downloadContractPdf(contract)}>
            ↓ Tải PDF
          </button>
          <button type="button" className="contract-button contract-button--primary" disabled={saving} onClick={() => void saveClauses()}>
            {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </header>

      <section className="contract-stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <article className="contract-stat">
          <span>Giá trị hợp đồng</span>
          <div style={{ marginTop: '0.3rem' }}>
            <CurrencyInput
              value={contractValue}
              onChange={setContractValue}
              style={{ width: '100%', height: '2rem', borderRadius: '0.4rem', border: '1px solid #dce2e9', padding: '0 0.5rem' }}
            />
            {!contract.quoteId ? (
              <small style={{ color: '#bf7810', display: 'block', marginTop: '0.2rem' }}>Không gắn báo giá — sửa tay giá trị thật ở đây.</small>
            ) : null}
          </div>
        </article>
        <article className="contract-stat">
          <span>Thời hạn hợp đồng</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <input
              type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ height: '2rem', borderRadius: '0.4rem', border: '1px solid #dce2e9', padding: '0 0.4rem', fontSize: '0.78rem' }}
            />
            <span>–</span>
            <input
              type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={{ height: '2rem', borderRadius: '0.4rem', border: '1px solid #dce2e9', padding: '0 0.4rem', fontSize: '0.78rem' }}
            />
          </div>
        </article>
        <article className="contract-stat">
          <span>Tiến độ thực hiện</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem' }}>
            <input
              type="number" min={0} max={100} value={progressPercent}
              onChange={e => setProgressPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              style={{ width: '4.5rem', height: '2rem', borderRadius: '0.4rem', border: '1px solid #dce2e9', padding: '0 0.5rem' }}
            />
            <span>%</span>
            <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#edf0f4', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${progressPercent}%`, background: '#be1e4b' }} />
            </div>
          </div>
        </article>
        <article className="contract-stat">
          <span>Đã thu thanh toán</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem' }}>
            <input
              type="number" min={0} max={100} value={paymentCollectedPercent}
              onChange={e => setPaymentCollectedPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              style={{ width: '4.5rem', height: '2rem', borderRadius: '0.4rem', border: '1px solid #dce2e9', padding: '0 0.5rem' }}
            />
            <span>% · {formatVnd((contractValue ?? 0) * paymentCollectedPercent / 100)}</span>
          </div>
        </article>
      </section>

      <div className="contract-editor">
        <aside className="contract-clause-nav">
          <h3>Mục lục điều khoản</h3>
          {clauses.map((clause, index) => (
            <button
              key={clause.id || index}
              type="button"
              className={`contract-clause-nav-item ${index === activeClauseIndex ? 'active' : ''}`}
              onClick={() => {
                setActiveClauseIndex(index);
                document.getElementById(`contract-clause-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {clause.title || `Điều khoản ${index + 1}`}
              <span>{clause.body.trim().length > 0 ? '✓' : '!'}</span>
            </button>
          ))}
          {clauses.length === 0 ? <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chưa có điều khoản nào.</p> : null}
        </aside>

        <article className="contract-paper">
          <header>
            <small>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</small>
            <h2>{contract.title}</h2>
            <p>Số: {contract.contractNumber}</p>
          </header>
          {clauses.map((clause, index) => (
            <div key={clause.id || index} id={`contract-clause-${index}`} style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
              <input
                className="contract-clause-title"
                value={clause.title}
                onChange={event => updateClause(index, 'title', event.target.value)}
              />
              <textarea
                className="contract-clause-body"
                value={clause.body}
                onChange={event => updateClause(index, 'body', event.target.value)}
              />
            </div>
          ))}
        </article>

        <aside className="contract-ai-review">
          <h3>AI kiểm tra rủi ro</h3>
          {contract.aiRiskScore != null ? (
            <div className="contract-review-score">
              <b>{contract.aiRiskScore}</b>
              <span>/ 100<br />{contract.aiRiskScore >= 80 ? 'Mức an toàn tốt' : contract.aiRiskScore >= 50 ? 'Cần lưu ý' : 'Rủi ro cao'}</span>
            </div>
          ) : (
            <p style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chưa có kết quả kiểm tra.</p>
          )}
          {contract.aiReview.map((finding, index) => (
            <div key={index} className={`contract-review-item ${finding.severity}`}>
              <strong>{finding.severity === 'ok' ? '✓' : '!'} {finding.title}</strong>
              <small>{finding.detail}</small>
            </div>
          ))}
          <button type="button" className="contract-button contract-button--full" disabled={reviewing} onClick={() => void runAiReview()}>
            {reviewing ? 'Đang kiểm tra...' : '✦ AI kiểm tra rủi ro'}
          </button>
        </aside>
      </div>
    </main>
  );
}
