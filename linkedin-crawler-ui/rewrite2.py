import os

path = 'c:/Code/scraper-linkedin/linkedin-crawler-ui/modules/crm/components/'
panel_path = os.path.join(path, 'CrmContactsPanel.tsx')
tab_path = os.path.join(path, 'CustomerContactsTab.tsx')

if os.path.exists(panel_path):
    with open(panel_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    content = content.replace('CrmContactsPanel', 'CustomerContactsTab')
    
    with open(tab_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print('Created CustomerContactsTab.tsx')
