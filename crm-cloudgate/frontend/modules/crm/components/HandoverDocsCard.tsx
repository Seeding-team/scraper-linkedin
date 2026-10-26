'use client';

/** Link Doc/Sheet hạng mục báo giá dán lúc bàn giao Lead (crm_leads.handover_links) - hiện ở Customer Detail / Cơ hội sau convert. */

export type HandoverDoc = {
  leadId: string;
  leadName: string | null;
  leadCode: string | null;
  dealId: string | null;
  links: Array<{ url: string; title?: string }>;
  handedOverBy?: string | null;
  handedOverAt?: string | null;
  assignee?: string | null;
};

export function HandoverDocsCard({ docs, title = 'Tài liệu bàn giao' }: { docs: HandoverDoc[]; title?: string }) {
  if (!docs.length) return null;
  return (
    <div className="crm-handover-docs-card" data-testid="handover-docs-card">
      <h4>{title}</h4>
      {docs.map(doc => (
        <div key={doc.leadId} style={{ marginBottom: 6 }}>
          <small>
            {doc.leadCode ? `Mã LH ${doc.leadCode} · ` : ''}{doc.leadName || 'Lead'}
            {doc.handedOverBy ? ` · bàn giao bởi ${doc.handedOverBy}` : ''}
            {doc.handedOverAt ? ` · ${new Date(doc.handedOverAt).toLocaleString('vi-VN')}` : ''}
          </small>
          <ul>
            {doc.links.map(link => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer">{link.title || link.url}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
