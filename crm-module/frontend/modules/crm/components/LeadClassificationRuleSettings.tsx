'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { Loader2 } from './icons';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

// PHAI khop CHINH XAC voi SQL_AND_LABELS/NURTURE_LABELS/UNQUALIFIED_OR_LABELS
// (backend, crm_lead_rule_service.py) - nhan hien thi lay tu day, key la
// nguon su that duy nhat dung o ca 2 phia.
const SQL_AND_ITEMS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'sql_product', label: 'Có sản phẩm / dịch vụ', hint: 'Khách đã xác định nhu cầu chính.' },
  { key: 'sql_interest', label: 'Có mức độ quan tâm', hint: 'Marketing đã xác định mức độ quan tâm.' },
  { key: 'sql_value', label: 'Có giá trị dự kiến', hint: 'Phải có giá trị cơ hội dự kiến.' },
  { key: 'sql_team', label: 'Đã chọn Sale nhận bàn giao', hint: 'Đã xác định ai sẽ nhận Lead này.' },
  { key: 'sql_next', label: 'Có việc tiếp theo', hint: 'Đã xác định next action cho Sale.' },
  { key: 'sql_follow', label: 'Có hạn follow-up', hint: 'Có thời điểm cụ thể để Sale xử lý.' },
  { key: 'sql_fit', label: 'Không ở trạng thái "Chưa phù hợp"', hint: 'Lead không bị loại bởi tiêu chí khách hàng mục tiêu.' },
];
const NURTURE_ITEMS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'nur_missing_value', label: 'Thiếu giá trị dự kiến', hint: 'Ví dụ mới biết nhu cầu nhưng chưa xác định ngân sách/quy mô.' },
  { key: 'nur_missing_handoff', label: 'Thiếu thông tin bàn giao Sale', hint: 'Thiếu Sale nhận bàn giao, việc tiếp theo hoặc follow-up.' },
  { key: 'nur_unknown_fit', label: 'Chưa xác định nhóm khách hàng', hint: 'Dùng nếu muốn buộc xác định ICP trước khi lên SQL.' },
];
const UNQUALIFIED_OR_ITEMS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'inv_fit', label: 'Đúng nhóm khách hàng = "Chưa phù hợp"', hint: 'Lead không thuộc nhóm khách hàng mục tiêu.' },
  { key: 'inv_no_contact', label: 'Không có thông tin liên hệ hợp lệ', hint: 'Loại Lead không có SĐT/email hợp lệ.' },
];

type Conditions = Record<string, boolean>;

/** Trang cấu hình "Điều kiện phân loại Lead" (WIP full-flow, prototype
 * markee_crm_v26_compact_opportunity_name.html, mục "Danh mục & cấu hình").
 * CHỈ Admin được sửa (yêu cầu riêng "chỉ có admin mới được tick chọn") -
 * mirror can_manage_lead_classification_rules() ở backend, cùng pattern
 * hard-content-swap của QuoteApprovalRuleSettings.tsx (không phải chỉ disable
 * input, ẩn hẳn form nếu không phải Admin). */
export function LeadClassificationRuleSettings() {
  const { user } = useAppAuth();
  const canManage = user?.role === 'admin';

  const [conditions, setConditions] = useState<Conditions>({});
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads/classification-rules`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body?.message || 'Không tải được điều kiện phân loại Lead.');
        return body.data as { conditions: Conditions; summary: string };
      })
      .then(data => {
        if (!alive) return;
        setConditions(data.conditions || {});
        setSummary(data.summary || '');
      })
      .catch(err => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Không tải được điều kiện phân loại Lead.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  function toggle(key: string) {
    if (!canManage) return;
    setConditions(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/classification-rules`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ conditions }),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được điều kiện phân loại Lead.');
      const data = body.data as { conditions: Conditions; summary: string };
      setConditions(data.conditions || {});
      setSummary(data.summary || '');
      setNotice('Đã lưu điều kiện phân loại Lead.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được điều kiện phân loại Lead.');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div style={{ padding: '1.25rem', color: '#b3261e', fontSize: '0.85rem', fontWeight: 600 }}>
        Bạn không có quyền truy cập trang này. Chỉ Admin mới được cấu hình Điều kiện phân loại Lead.
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '1.25rem', fontSize: '0.85rem', color: '#64748b' }}>Đang tải…</div>;
  }
  if (loadError) {
    return <div style={{ padding: '1.25rem', color: '#b3261e', fontSize: '0.85rem' }}>{loadError}</div>;
  }

  return (
    <div className="rule-editor" style={{ display: 'grid', gap: '0.9rem', maxWidth: '760px' }}>
      <div>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>Điều kiện phân loại Lead</h1>
        <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.3rem 0 0' }}>
          Tick các điều kiện muốn áp dụng. Hệ thống dùng các rule này để tự động xác định SQL / Nuôi dưỡng / Không đạt chuẩn ở màn Xác minh Lead.
        </p>
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {notice ? <p className="crm-verify-ok">{notice}</p> : null}

      <RuleCard title="Đạt chuẩn (SQL)" mode="AND" description="Tất cả điều kiện được tick phải thỏa." items={SQL_AND_ITEMS} conditions={conditions} onToggle={toggle} />
      <RuleCard title="Nuôi dưỡng" mode="FALLBACK" description="Chỉ áp dụng khi chưa đạt SQL và không rơi vào điều kiện loại — chỉ ảnh hưởng lý do hiển thị." items={NURTURE_ITEMS} conditions={conditions} onToggle={toggle} />
      <RuleCard title="Không đạt chuẩn" mode="OR" description="Chỉ cần thỏa một điều kiện được tick là Lead bị loại." items={UNQUALIFIED_OR_ITEMS} conditions={conditions} onToggle={toggle} />

      <div className="rule-summary" style={{ border: '1px solid #dbe5f2', background: '#f8fafc', borderRadius: '0.75rem', padding: '0.7rem 0.8rem' }}>
        <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rule đang áp dụng</div>
        <div style={{ fontSize: '0.8rem', color: '#334155', marginTop: '0.3rem' }}>{summary}</div>
      </div>

      <div>
        <button type="button" className="crm-primary-button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="crm-save-spinner" /> : null}
          {saving ? 'Đang lưu...' : 'Lưu điều kiện'}
        </button>
      </div>
    </div>
  );
}

function RuleCard({
  title,
  mode,
  description,
  items,
  conditions,
  onToggle,
}: {
  title: string;
  mode: string;
  description: string;
  items: Array<{ key: string; label: string; hint: string }>;
  conditions: Conditions;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="rule-card" style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', background: '#fff', overflow: 'hidden' }}>
      <div className="rule-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', padding: '0.8rem 0.9rem', borderBottom: '1px solid #e2e8f0', background: '#fbfcfe' }}>
        <div>
          <h3 style={{ fontSize: '0.85rem', margin: 0 }}>{title}</h3>
          <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.25rem 0 0' }}>{description}</p>
        </div>
        <span style={{ fontSize: '0.65rem', fontWeight: 850, padding: '0.3rem 0.5rem', borderRadius: '999px', background: '#f1f4f8', color: '#61728a', whiteSpace: 'nowrap' }}>{mode}</span>
      </div>
      <div style={{ padding: '0.4rem 0.9rem' }}>
        {items.map(item => (
          <label key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', padding: '0.55rem 0', borderBottom: '1px dashed #edf1f6', cursor: 'pointer' }}>
            <input type="checkbox" checked={Boolean(conditions[item.key])} onChange={() => onToggle(item.key)} style={{ width: '16px', height: '16px', marginTop: '1px' }} />
            <span>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#34455c', fontWeight: 750 }}>{item.label}</span>
              <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '0.1rem' }}>{item.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
