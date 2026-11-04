export interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  fileName: string;
  fileType: 'docx' | 'pdf' | 'txt';
  textLength: number;
  extractedText?: string;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}
