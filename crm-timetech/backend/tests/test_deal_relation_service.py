"""Pure mock tests: no database or external API calls."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

path = Path(__file__).parents[1] / 'app/modules/all_platform/services/deal_relation_service.py'
spec = importlib.util.spec_from_file_location('deal_relation_under_test', path)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class DealRelationTests(unittest.TestCase):
    def setUp(self):
        self.customer = Mock()
        self.contact = Mock()
        self.project = Mock()
        customer_module = types.ModuleType('app.modules.all_platform.services.crm_customer_service')
        customer_module.get_customer = self.customer
        lead_module = types.ModuleType('app.modules.all_platform.services.customer_lead_service')
        lead_module.validate_contact_belongs_to_customer = self.contact
        lead_module.validate_project_belongs_to_customer = self.project
        modules = {customer_module.__name__: customer_module, lead_module.__name__: lead_module}
        for name in ['app', 'app.modules', 'app.modules.all_platform', 'app.modules.all_platform.services']:
            package = types.ModuleType(name)
            package.__path__ = []
            modules[name] = package
        patcher = patch.dict(sys.modules, modules)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_existing_links_revalidated_on_partial_update(self):
        service.validate_deal_relations({'note': 'edited'}, {'id': 'sale'},
            {'customer_id': 'A', 'primary_contact_id': 'contact-A', 'project_id': 'project-A'})
        self.customer.assert_called_once_with('A', {'id': 'sale'})
        self.contact.assert_called_once_with('contact-A', 'A')
        self.project.assert_called_once_with('project-A', 'A')

    def test_changing_customer_cannot_keep_foreign_contact(self):
        self.contact.side_effect = ValueError('contact mismatch')
        with self.assertRaises(ValueError):
            service.validate_deal_relations({'customer_id': 'B'}, {'id': 'sale'},
                {'customer_id': 'A', 'primary_contact_id': 'contact-A'})
        self.contact.assert_called_once_with('contact-A', 'B')

    def test_explicit_null_does_not_fall_back_to_old_customer(self):
        with self.assertRaises(ValueError):
            service.validate_deal_relations({'customer_id': None}, {'id': 'sale'},
                {'customer_id': 'A', 'primary_contact_id': 'contact-A'})

    def test_clearing_all_links_is_allowed(self):
        service.validate_deal_relations({'customer_id': None, 'primary_contact_id': None, 'project_id': None},
            {'id': 'sale'}, {'customer_id': 'A', 'primary_contact_id': 'contact-A'})
        self.customer.assert_not_called()

    def test_denied_customer_blocks_before_relation_or_save(self):
        self.customer.side_effect = PermissionError('denied or foreign tenant')
        with self.assertRaises(PermissionError):
            service.validate_deal_relations({'customer_id': 'foreign', 'primary_contact_id': 'contact'}, {'id': 'sale'})
        self.contact.assert_not_called()

    def test_actor_required_for_linked_customer(self):
        with self.assertRaises(PermissionError):
            service.validate_deal_relations({'customer_id': 'A'}, None)

if __name__ == '__main__':
    unittest.main()
