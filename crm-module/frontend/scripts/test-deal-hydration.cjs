const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../modules/crm/components/dealHydration.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { contactValues, hydrationConflicts, aiMayFill } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(contactValues({ id: 'b', name: 'Minh', phone: '0901234567' })),
  { contactName: 'Minh', phone: '0901234567', email: '' });
assert.deepEqual(plain(contactValues()), { contactName: '', phone: '', email: '' });
assert.deepEqual(plain(hydrationConflicts({ contactName: 'A', phone: 'old', email: '', companyName: 'CRM' },
  ['phone'], { phone: 'new', email: '' })), ['phone']);
assert.deepEqual(plain(hydrationConflicts({ contactName: 'A', phone: 'old', email: '', companyName: 'CRM' },
  [], { phone: 'new' })), []);
for (const field of ['contactName', 'phone', 'email', 'companyName', 'customerName']) {
  assert.equal(aiMayFill(field, 'customer-a', 'contact-a'), false);
}
assert.equal(aiMayFill('email', '', 'contact-a'), false);
assert.equal(aiMayFill('nextStep', 'customer-a', 'contact-a'), true);
assert.equal(aiMayFill('phone', '', ''), true);
console.log('PASS hydration helpers: missing fields clear, manual conflicts, linked CRM blocks AI including empty fields');
