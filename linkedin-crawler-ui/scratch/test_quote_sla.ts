// Unit test THUAN cho computeQuoteSla() - chay bang:
//   node --experimental-strip-types scratch/test_quote_sla.ts
// Test boundary chinh xac tung yeu cau: dung bang deadline, truoc/sau 1
// giay, dung nguong 4 gio, khong co deadline, completedAt, fallback sentAt.
import { computeQuoteSla, QUOTE_SLA_DUE_SOON_THRESHOLD_MS } from '../modules/crm/utils/quoteSla.ts';

const RESULTS: [string, boolean][] = [];
function record(label: string, ok: boolean, detail = '') {
  RESULTS.push([label, ok]);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label} ${detail}`);
}

const DUE = new Date('2026-09-10T12:00:00.000Z');

// 1) Khong co slaDueAt -> not_set
record('Khong co slaDueAt -> not_set', computeQuoteSla({ slaDueAt: null, now: DUE }).status === 'not_set');

// 2) Dung bang deadline (chua hoan thanh) -> due_soon (0 <= nguong 4h)
{
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), now: DUE });
  record('Dung bang deadline (chua hoan thanh) -> due_soon', r.status === 'due_soon', r.status);
}

// 3) Truoc deadline 1 giay -> due_soon (con rat gan, trong nguong 4h)
{
  const now = new Date(DUE.getTime() - 1000);
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), now });
  record('Truoc deadline 1 giay -> due_soon', r.status === 'due_soon', r.status);
}

// 4) Sau deadline 1 giay -> overdue
{
  const now = new Date(DUE.getTime() + 1000);
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), now });
  record('Sau deadline 1 giay -> overdue', r.status === 'overdue', r.status);
}

// 5) Dung nguong 4 gio (con dung 4h00m00s) -> due_soon (bao gom bien)
{
  const now = new Date(DUE.getTime() - QUOTE_SLA_DUE_SOON_THRESHOLD_MS);
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), now });
  record('Dung nguong 4 gio -> due_soon (bien duoc tinh la sap den han)', r.status === 'due_soon', r.status);
}

// 5b) Vua qua nguong 4 gio 1 giay (con nhieu hon 4h) -> in_progress
{
  const now = new Date(DUE.getTime() - QUOTE_SLA_DUE_SOON_THRESHOLD_MS - 1000);
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), now });
  record('Ngoai nguong 4 gio (con nhieu hon) -> in_progress', r.status === 'in_progress', r.status);
}

// 6) completedAt <= slaDueAt -> completed_on_time (bao gom dung bang)
{
  const r1 = computeQuoteSla({ slaDueAt: DUE.toISOString(), completedAt: DUE.toISOString(), now: DUE });
  record('completedAt DUNG BANG slaDueAt -> completed_on_time', r1.status === 'completed_on_time', r1.status);
  const r2 = computeQuoteSla({ slaDueAt: DUE.toISOString(), completedAt: new Date(DUE.getTime() - 1000).toISOString(), now: DUE });
  record('completedAt TRUOC slaDueAt -> completed_on_time', r2.status === 'completed_on_time', r2.status);
}

// 7) completedAt > slaDueAt -> completed_late
{
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), completedAt: new Date(DUE.getTime() + 1000).toISOString(), now: DUE });
  record('completedAt SAU slaDueAt -> completed_late', r.status === 'completed_late', r.status);
}

// 8) Fallback sentAt khi CHUA co completedAt (du lieu cu)
{
  const r = computeQuoteSla({ slaDueAt: DUE.toISOString(), completedAt: null, sentAt: new Date(DUE.getTime() - 1000).toISOString(), now: DUE });
  record('Chua co completedAt nhung co sentAt (du lieu cu) -> van tinh la hoan thanh dung han', r.status === 'completed_on_time', r.status);
}

// 9) completedAt uu tien HON sentAt khi ca 2 cung co
{
  const r = computeQuoteSla({
    slaDueAt: DUE.toISOString(),
    completedAt: new Date(DUE.getTime() + 5000).toISOString(), // tre
    sentAt: new Date(DUE.getTime() - 5000).toISOString(), // dung han
    now: DUE,
  });
  record('Co ca completedAt va sentAt -> uu tien completedAt (tre)', r.status === 'completed_late', r.status);
}

// 10) not_set khong bi anh huong boi completedAt/sentAt
{
  const r = computeQuoteSla({ slaDueAt: null, completedAt: DUE.toISOString(), now: DUE });
  record('Khong co slaDueAt du co completedAt -> van la not_set', r.status === 'not_set', r.status);
}

console.log();
console.log('=== SUMMARY ===');
const nFail = RESULTS.filter(([, ok]) => !ok).length;
console.log(`${RESULTS.length - nFail}/${RESULTS.length} PASS`);
if (nFail > 0) process.exit(1);
