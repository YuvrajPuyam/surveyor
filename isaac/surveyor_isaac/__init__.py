"""surveyor_isaac — the certificate is the contract.

Pure-python contract loading lives in `surveyor_isaac.contract` and runs
anywhere. The Isaac Lab task package (`surveyor_isaac.tasks`) imports
isaaclab/gymnasium and is only importable on a machine with Isaac Lab.
"""

from .contract import ContractConfig, ContractRefused, load_contract

__all__ = ["ContractConfig", "ContractRefused", "load_contract"]
__version__ = "0.1.0"
