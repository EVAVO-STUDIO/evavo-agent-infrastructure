from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "config" / "chatgpt-fleet-readonly-app-v1.json"
DOCUMENTATION = ROOT / "docs" / "CHATGPT_FLEET_READONLY_APP.md"


class ChatGptFleetReadonlyAppContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.documentation = DOCUMENTATION.read_text(encoding="utf-8")

    def test_contract_is_canonical_and_read_only(self) -> None:
        self.assertEqual(cls := self.contract["kind"], "evavo-chatgpt-fleet-readonly-app-contract-v1", cls)
        self.assertEqual(self.contract["status"], "canonical")
        self.assertEqual(self.contract["serviceName"], "evavo-fleet-readonly")
        self.assertTrue(self.contract["discovery"]["everyAdvertisedToolMustDeclareReadOnly"])
        self.assertTrue(self.contract["discovery"]["unknownToolFailsClosed"])

    def test_forbidden_effectful_classes_remain_explicit(self) -> None:
        forbidden = set(self.contract["forbiddenCapabilityClasses"])
        for capability in (
            "raw-shell",
            "raw-powershell",
            "filesystem-write",
            "git-mutation",
            "source-publication",
            "credential-read",
            "browser-control",
            "hid-control",
            "kvm-control",
            "power-control",
            "firmware-control",
            "arbitrary-network-request",
        ):
            self.assertIn(capability, forbidden)

    def test_transport_never_confers_authority(self) -> None:
        authority = self.contract["authority"]
        self.assertFalse(authority["transportConfersExecutionAuthority"])
        self.assertFalse(authority["readOnlyAppMayCreateExecutionRequest"])
        self.assertFalse(authority["readOnlyAppMayApproveExecutionRequest"])
        self.assertFalse(authority["readOnlyAppMayPublishSource"])
        self.assertFalse(authority["readOnlyAppMayElevatePrivileges"])
        self.assertEqual(authority["effectfulFallback"], "governed-chatgpt-github-issue-relay")

    def test_visibility_requires_chatgpt_side_observation(self) -> None:
        lifecycle = self.contract["chatgptLifecycle"]
        acceptance = self.contract["acceptance"]
        self.assertFalse(lifecycle["currentConversationHotInjectionSupportedByRepositoryChange"])
        self.assertTrue(lifecycle["appAttachmentRequired"])
        self.assertTrue(lifecycle["sourceDeploymentAloneIsNotUserVisibleToolProof"])
        self.assertTrue(acceptance["toolsListObservedByChatgptRequired"])
        self.assertTrue(acceptance["readOnlyClassificationVerifiedRequired"])
        self.assertTrue(acceptance["forbiddenToolAbsenceVerifiedRequired"])
        self.assertTrue(acceptance["freshWorkspaceObservationRequired"])

    def test_documentation_preserves_product_and_evidence_boundaries(self) -> None:
        for marker in (
            "Transport is not authority.",
            "effectful work uses the separately governed ChatGPT GitHub issue relay",
            "Repository changes cannot hot-inject a top-level tool namespace",
            "fresh ChatGPT-side observation of `tools/list`",
        ):
            self.assertIn(marker, self.documentation)


if __name__ == "__main__":
    unittest.main()
