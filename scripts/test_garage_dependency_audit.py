"""Offline regression tests for dependency inventory coverage (no OSV calls)."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "audit", Path(__file__).with_name("audit-garage-dependencies.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class InventoryTests(unittest.TestCase):
    packages = [{"name": "server", "version": "2.4.1"},
                {"name": "parser", "version": "0.41.0", "source": "registry+example"},
                {"name": "test-only", "version": "1.0.0"}]

    def test_selects_only_resolved_packages(self):
        self.assertEqual(audit.select_packages(self.packages,
            "# normal/build\nserver v2.4.1 (/src)\nparser v0.41.0 (proc-macro)\n"),
            self.packages[:2])

    def test_rejects_empty_inventory(self):
        with self.assertRaises(ValueError):
            audit.select_packages(self.packages, "# nothing captured\n")

    def test_rejects_stale_version(self):
        with self.assertRaises(ValueError):
            audit.select_packages(self.packages, "parser v0.39.2")

    def test_rejects_malformed_lines(self):
        with self.assertRaises(ValueError):
            audit.select_packages(self.packages, "server v2.4.1\ntruncated tree")

    def test_rejects_ambiguous_sources(self):
        with self.assertRaises(ValueError):
            audit.select_packages(self.packages + [dict(self.packages[1], source="git+other")],
                                  "parser v0.41.0")

    def test_deduplicates_repeated_packages(self):
        self.assertEqual(audit.select_packages(self.packages, "server v2.4.1\nserver v2.4.1"),
                         self.packages[:1])


if __name__ == "__main__":
    unittest.main()
