# G4 recon: checkpoint structure (pure torch — no isaaclab imports).
import torch

d = torch.load(
    "/scratch/gilbreth/gupta596/surveyor/checkpoints/lift-rsl_rl-5.1.pt",
    map_location="cpu", weights_only=False,
)
print("checkpoint keys:", list(d.keys()))
sd = d["model_state_dict"]
for k, v in sd.items():
    if "actor" in k or "std" in k:
        print(k, tuple(v.shape))
