import subprocess
import tempfile
import unittest
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("privacy_guard", Path(__file__).with_name("check-private-files.py"))
privacy_guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy_guard)
content_findings = privacy_guard.content_findings
index_blobs = privacy_guard.index_blobs
sensitive_path = privacy_guard.sensitive_path


class PrivacyChecks(unittest.TestCase):
    def test_private_paths_are_blocked(self):
        for path in ("user_data/config-btc-dryrun.json", "user_data/trades.sqlite", ".env.production", ".ssh/id_ed25519", "report.local.md", "account.private.json", "exports/trades.db", "trace.har"):
            with self.subTest(path=path):
                self.assertTrue(sensitive_path(path))

    def test_public_templates_and_code_are_allowed(self):
        for path in (".env.example", "user_data/data/.gitkeep", "config_examples/config_full.example.json", "config_examples/btc_dryrun.example.json", ".github/ISSUE_TEMPLATE/config.yml", "scripts/btc-dryrun.ps1", "strategies/BtcEmaCross.py"):
            with self.subTest(path=path):
                self.assertFalse(sensitive_path(path))

    def test_known_local_values_are_detected_in_any_field(self):
        value = b"example-private-value-123"
        findings = content_findings(b'comment="' + value + b'"', [("actual_local_credential", value)])
        self.assertEqual(findings, ["actual_local_credential"])
        self.assertNotIn(value.decode(), repr(findings))

    def test_literal_credentials_require_review(self):
        data = b'{"password": "' + b"non-placeholder-value-123" + b'"}'
        self.assertIn("credential_literal_review", content_findings(data, []))

    def test_documented_placeholders_are_allowed(self):
        data = b'{"password":"test-example-password", "secret":"your_exchange_secret"}'
        self.assertEqual(content_findings(data, []), [])

    def test_token_format_is_detected(self):
        data = b"gh" + b"p_" + b"A" * 36
        self.assertIn("github_token", content_findings(data, []))

    def test_scans_staged_blob_even_when_worktree_is_sanitized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            file = root / "note.txt"
            original = b"staged-private-value"
            file.write_bytes(original)
            subprocess.run(["git", "add", "note.txt"], cwd=root, check=True)
            file.write_bytes(b"sanitized-working-file")
            blobs = dict(index_blobs(root, {"note.txt"}))
            self.assertEqual(blobs["note.txt"], original)
            self.assertEqual(list(index_blobs(root, {"other.txt"})), [])


if __name__ == "__main__":
    unittest.main()
