/** Deterministic CRM hydration; AI never chooses a record or linked ID. */
export type ContactOption = {
  id: string; name: string; phone?: string | null; email?: string | null;
  is_primary?: boolean; position?: string | null; position_label_snapshot?: string | null;
};
export type EditableIdentity = 'contactName' | 'phone' | 'email' | 'companyName';
export function contactValues(contact?: ContactOption) {
  return { contactName: contact?.name || '', phone: contact?.phone || '', email: contact?.email || '' };
}
export function hydrationConflicts(
  current: Record<EditableIdentity, string>, edited: EditableIdentity[],
  next: Partial<Record<EditableIdentity, string>>,
) {
  return edited.filter(field => field in next && current[field] !== next[field]);
}
export function aiMayFill(field: string, customerId: string, contactId: string) {
  if (customerId && ['customerName', 'companyName'].includes(field)) return false;
  if ((customerId || contactId) && ['contactName', 'phone', 'email'].includes(field)) return false;
  return true;
}


