"""Headless contract validation — proves the certificate->config mapping
without Isaac installed.

    python -m surveyor_isaac.validate <bundle-dir> [--allow-failing-grade]

Exit 0: contract loads and is trainable. Exit 1: refused or invalid.
"""

from __future__ import annotations

import sys

from .contract import ContractRefused, load_contract


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    positional = [a for a in args if not a.startswith("--")]
    if not positional:
        print(__doc__)
        return 2
    allow = "--allow-failing-grade" in args

    try:
        c = load_contract(positional[0], allow_failing_grade=allow)
    except ContractRefused as e:
        print(f"CONTRACT REFUSED\n  {e}")
        return 1
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    print(f"CONTRACT OK — world {c.world_id} (grade {c.grade}, seed {c.seed}, certified {c.certified_at})")
    print(f"  sim.gravity            = (0, 0, {-c.gravity_mps2:.4f})  # {c.gravity_name}")
    print(f"  friction static range  = {c.friction_static_range}")
    print(f"  friction dynamic range = {c.friction_dynamic_range}")
    print(f"    basis: {c.friction_basis}")
    print(f"  reset poses            = {len(c.spawns)} verified spawn(s)")
    for s in c.spawns[:5]:
        print(f"    ({s.x:.2f}, {s.y:.2f}, {s.z:.2f})  {s.robot_id}, clearance {s.clearance_m:.2f} m")
    print(f"  termination masks      = {len(c.quarantine)} quarantine box(es)")
    for q in c.quarantine[:5]:
        print(f"    {q.min} .. {q.max}  # {q.reason[:60]}")
    if not c.spawns:
        print("  WARNING: no spawns — sample_spawn() will refuse; export a repaired bundle first")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
