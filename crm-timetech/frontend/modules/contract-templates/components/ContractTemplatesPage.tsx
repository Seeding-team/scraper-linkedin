'use client';

import Link from 'next/link';
import { ContractTemplatesPanel } from './ContractTemplatesPanel';

export function ContractTemplatesPage() {
  return (
    <main className="contract-page">
      <header className="contract-head">
        <div>
          <Link href="/all-platform/contracts" className="contract-button contract-button--secondary" style={{ marginBottom: '0.6rem', display: 'inline-flex' }}>
            ← Quay lại Hợp đồng
          </Link>
          <h1>Quản lý mẫu hợp đồng</h1>
          <p>Upload file hợp đồng mẫu (.docx, .pdf, .txt) để AI Contract Copilot tham chiếu văn phong/cấu trúc khi soạn thảo.</p>
        </div>
      </header>
      <ContractTemplatesPanel />
    </main>
  );
}
