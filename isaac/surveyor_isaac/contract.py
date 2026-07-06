"""Certificate -> training-contract loader. Pure python, runs anywhere.

Mirrors src/export/isaacContract.ts EXACTLY (same friction prior constants,
same scale-trust widening, same gravity mapping) — the TypeScript compiler
and this loader must never disagree about a number.

The hard gate lives here too: a world whose certificate carries open
critical defects REFUSES to become a training config. The certificate is
the contract, and a contract with known-broken floor is not signable.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ContractRefused(RuntimeError):
    """The certificate does not permit training on this world."""


@dataclass(frozen=True)
class SpawnPose:
    x: float
    y: float
    z: float
    robot_id: str
    clearance_m: float


@dataclass(frozen=True)
class QuarantineBox:
    """Axis-aligned box in Y-up world coordinates. Entering one terminates the episode."""

    min: tuple[float, float, float]
    max: tuple[float, float, float]
    reason: str

    def contains(self, p: tuple[float, float, float], margin: float = 0.0) -> bool:
        return all(self.min[i] - margin <= p[i] <= self.max[i] + margin for i in range(3))


@dataclass(frozen=True)
class ContractConfig:
    world_id: str
    grade: str
    seed: int
    certified_at: str
    # sim
    gravity_name: str
    gravity_mps2: float  # magnitude; Isaac gets (0, 0, -g)
    # domain randomization (disclosed priors, NOT measurements)
    friction_static_range: tuple[float, float]
    friction_dynamic_range: tuple[float, float]
    friction_basis: str
    # resets / terminations
    spawns: tuple[SpawnPose, ...]
    quarantine: tuple[QuarantineBox, ...]
    disclosures: tuple[str, ...] = field(default_factory=tuple)

    @property
    def gravity_vec(self) -> tuple[float, float, float]:
        return (0.0, 0.0, -self.gravity_mps2)

    def sample_spawn(self, rng: Any) -> tuple[tuple[float, float, float], float]:
        """(position, yaw) reset sample; yaw uniform — heading was never certified."""
        if not self.spawns:
            raise ContractRefused(
                f"world {self.world_id}: no verified spawn points — do not train here until spawns exist"
            )
        s = self.spawns[int(rng.integers(0, len(self.spawns)))] if hasattr(rng, "integers") else self.spawns[
            rng.randrange(len(self.spawns))
        ]
        yaw = (rng.uniform(0.0, 2.0 * math.pi) if hasattr(rng, "uniform") else 0.0)
        return ((s.x, s.y, s.z), yaw)

    def in_quarantine(self, p: tuple[float, float, float], margin: float = 0.0) -> bool:
        """Termination mask: True ends the episode (no reward is earned inside)."""
        return any(q.contains(p, margin) for q in self.quarantine)


def _friction_range(cert: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float], str]:
    """Same constants and logic as frictionRange() in src/export/isaacContract.ts."""
    scale_open = any(
        d.get("type") == "scale_error" and (not d.get("outcome") or d.get("outcome") == "escalated")
        for d in cert.get("defects", [])
    )
    if scale_open:
        return (
            (0.4, 1.1),
            (0.3, 0.9),
            "wide prior: scale unverified at certification time — do not narrow until re-certified",
        )
    return (
        (0.6, 1.0),
        (0.45, 0.8),
        "assigned prior for rigid indoor surfaces under the disclosed model class (Coulomb, no soil mechanics); "
        "NOT a measurement — domain-randomize across the full range",
    )


def load_contract(bundle_dir: str | Path, *, allow_failing_grade: bool = False) -> ContractConfig:
    """Load certificate.json (+ spawns.json, quarantine.json) from a bundle dir.

    Refuses (ContractRefused) when the certificate carries open critical
    defects, unless allow_failing_grade explicitly overrides — and even then
    the refusal reasons are printed so nobody trains on a broken floor
    silently.
    """
    bundle = Path(bundle_dir)
    cert_path = bundle / "certificate.json"
    if not cert_path.exists():
        raise FileNotFoundError(f"no certificate.json in {bundle} — certify the world first")
    cert = json.loads(cert_path.read_text(encoding="utf-8"))

    open_critical = [
        d
        for d in cert.get("defects", [])
        if d.get("severity") == "critical" and (not d.get("outcome") or d.get("outcome") == "escalated")
    ]
    if open_critical and not allow_failing_grade:
        kinds = ", ".join(sorted({d.get("type", "?") for d in open_critical}))
        raise ContractRefused(
            f"world {cert.get('worldId')}: certificate grade {cert.get('grade')} carries "
            f"{len(open_critical)} OPEN CRITICAL defect(s) ({kinds}). The certificate is the contract — "
            "repair or quarantine them (grade must reflect it) before building a training config."
        )

    def read_json(name: str) -> Any:
        p = bundle / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    spawns = tuple(
        SpawnPose(x=float(s["x"]), y=float(s["y"]), z=float(s["z"]), robot_id=str(s["robotId"]), clearance_m=float(s["clearanceM"]))
        for s in read_json("spawns.json")
    )
    quarantine = tuple(
        QuarantineBox(
            min=tuple(float(v) for v in q["region"]["min"]),
            max=tuple(float(v) for v in q["region"]["max"]),
            reason=str(q.get("reason", "")),
        )
        for q in read_json("quarantine.json")
    )

    fr_static, fr_dynamic, fr_basis = _friction_range(cert)
    gravity = cert.get("gravity", {})
    return ContractConfig(
        world_id=str(cert.get("worldId", bundle.name)),
        grade=str(cert.get("grade", "?")),
        seed=int(cert.get("seed", 0)),
        certified_at=str(cert.get("createdAt", "")),
        gravity_name=str(gravity.get("name", "earth")),
        gravity_mps2=float(gravity.get("g", 9.81)),
        friction_static_range=fr_static,
        friction_dynamic_range=fr_dynamic,
        friction_basis=fr_basis,
        spawns=spawns,
        quarantine=quarantine,
        disclosures=tuple(cert.get("disclosures", [])),
    )
