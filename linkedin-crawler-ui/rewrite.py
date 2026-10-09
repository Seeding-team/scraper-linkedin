import os, re

path = 'c:/Code/scraper-linkedin/linkedin-crawler-ui/modules/crm/components/'
files = ['CustomerActivityTab.tsx', 'CustomerContractsTab.tsx', 'CustomerDealsTab.tsx', 'CustomerProjectsTab.tsx', 'CustomerQuotesTab.tsx', 'CrmContactsPanel.tsx']

for f in files:
    filepath = os.path.join(path, f)
    if not os.path.exists(filepath): continue
    
    with open(filepath, 'r', encoding='utf-8') as file:
        content = file.read()
        
    # Replace table tags
    content = re.sub(r'<table className="[^"]*">', '<table className="w-full text-sm">', content)
    # thead
    content = re.sub(r'<thead[^>]*>', '<thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">', content)
    # tbody
    content = re.sub(r'<tbody[^>]*>', '<tbody className="divide-y divide-slate-100">', content)
    
    # Remove crm-table, crm-td, crm-td--right, etc.
    content = content.replace('crm-table', '')
    content = content.replace('crm-td--right', 'text-right')
    content = content.replace('crm-td', 'px-4 py-3 align-middle text-slate-700')
    content = content.replace('crm-muted', 'text-slate-500')
    
    # Replace general container styles
    content = content.replace('border-border/70', 'border-slate-200')
    content = content.replace('border-border/80', 'border-slate-200')
    content = content.replace('shadow-xs', 'shadow-sm')
    
    with open(filepath, 'w', encoding='utf-8') as file:
        file.write(content)
    print(f'Updated {f}')

