"""Headless golden tests for the certificate->contract mapping.

Runs WITHOUT Isaac Lab (pure python):
    python -m unittest discover isaac/tests -v      (from the repo root)
"""

from __future__ import annotations

import json
import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from surveyor_isaac.contract import ContractRefused, QuarantineBox, load_contract  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
HABITAT = REPO / "assets" / "marble" / "7188e250-e2ff-43e7-babb-73834c22e932"


def synthetic_certificate(*, open_critical: bool, scale_open: bool) -> dict:
    defects = []
    if open_critical:
        defects.append({"id": "d-hole-0", "type": "collider_hole", "severity": "critical", "confidence": 0.95})
    if scale_open:
        defects.append({"id": "d-scale-0", "type": "scale_error", "severity": "critical", "confidence": 0.8})
    else:
        defects.append(
            {"id": "d-scale-0", "type": "scale_error", "severity": "critical", "confidence": 0.8, "outcome": "fixed"}
        )
    return {
        "schemaVersion": "0.1",
        "worldId": "syn-test",
        "seed": 7,
        "createdAt": "2026-07-06T00:00:00.000Z",
        "gravity": {"name": "moon", "g": 1.62},
        "grade": "F" if open_critical else "B",
        "trust": {"verifiedPct": 50, "lyingPct": 1},
        "defects": defects,
        "disclosures": ["test"],
    }


def write_bundle(d: Path, cert: dict, spawns=None, quarantine=None) -> None:
    (d / "certificate.json").write_text(json.dumps(cert), encoding="utf-8")
    if spawns is not None:
        (d / "spawns.json").write_text(json.dumps(spawns), encoding="utf-8")
    if quarantine is not None:
        (d / "quarantine.json").write_text(json.dumps(quarantine), encoding="utf-8")


class TestContract(unittest.TestCase):
    def test_habitat_certificate_loads(self):
        """The real (canonical) habitat certificate parses; refusal matches its open criticals."""
        cert = json.loads((HABITAT / "certificate.json").read_text(encoding="utf-8"))
        open_critical = [
            d
            for d in cert["defects"]
            if d["severity"] == "critical" and (not d.get("outcome") or d.get("outcome") == "escalated")
        ]
        if open_critical:
            with self.assertRaises(ContractRefused):
                load_contract(HABITAT)
            c = load_contract(HABITAT, allow_failing_grade=True)
        else:
            c = load_contract(HABITAT)
        self.assertEqual(c.world_id, cert["worldId"])
        self.assertAlmostEqual(c.gravity_mps2, cert["gravity"]["g"])
        self.assertEqual(c.gravity_vec[2], -cert["gravity"]["g"])

    def test_refusal_on_open_critical(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_bundle(d, synthetic_certificate(open_critical=True, scale_open=True))
            with self.assertRaises(ContractRefused) as ctx:
                load_contract(d)
            self.assertIn("OPEN CRITICAL", str(ctx.exception))

    def test_friction_widens_while_scale_unverified(self):
        """Mirror of frictionRange() in src/export/isaacContract.ts — same constants."""
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_bundle(d, synthetic_certificate(open_critical=False, scale_open=True))
            wide = load_contract(d, allow_failing_grade=True)
            self.assertEqual(wide.friction_static_range, (0.4, 1.1))
            self.assertEqual(wide.friction_dynamic_range, (0.3, 0.9))
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_bundle(d, synthetic_certificate(open_critical=False, scale_open=False))
            narrow = load_contract(d)
            self.assertEqual(narrow.friction_static_range, (0.6, 1.0))
            self.assertEqual(narrow.friction_dynamic_range, (0.45, 0.8))

    def test_spawns_and_quarantine_mapping(self):
        spawns = [
            {"x": 1.0, "y": 0.2, "z": 2.0, "robotId": "rover", "clearanceM": 1.1},
            {"x": 4.0, "y": 0.2, "z": 5.0, "robotId": "rover", "clearanceM": 0.8},
        ]
        quarantine = [{"region": {"min": [8, 0, 8], "max": [9, 2, 9]}, "reason": "ghost geometry"}]
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_bundle(d, synthetic_certificate(open_critical=False, scale_open=False), spawns, quarantine)
            c = load_contract(d)
            self.assertEqual(len(c.spawns), 2)
            self.assertEqual(c.spawns[0].robot_id, "rover")
            pos, yaw = c.sample_spawn(random.Random(7))
            self.assertIn(pos, [(1.0, 0.2, 2.0), (4.0, 0.2, 5.0)])
            self.assertTrue(c.in_quarantine((8.5, 1.0, 8.5)))
            self.assertFalse(c.in_quarantine((1.0, 0.2, 2.0)))

    def test_no_spawns_refuses_reset(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_bundle(d, synthetic_certificate(open_critical=False, scale_open=False), spawns=[])
            c = load_contract(d)
            with self.assertRaises(ContractRefused):
                c.sample_spawn(random.Random(1))

    def test_quarantine_box_margin(self):
        q = QuarantineBox(min=(0, 0, 0), max=(1, 1, 1), reason="r")
        self.assertTrue(q.contains((1.05, 0.5, 0.5), margin=0.1))
        self.assertFalse(q.contains((1.05, 0.5, 0.5), margin=0.0))


if __name__ == "__main__":
    unittest.main()
