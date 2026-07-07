#!/bin/bash
# G3a: press Play on the pack; a rigid body must rest on the repaired floor.
#SBATCH -A bera89
#SBATCH -p a10
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -c 8
#SBATCH -t 00:40:00
#SBATCH -J surveyor-g3a
#SBATCH -o /scratch/gilbreth/gupta596/surveyor/g3a.out
set -x
cd /scratch/gilbreth/gupta596/surveyor
WORK=$(mktemp -d /tmp/isaac-kit-XXXX)
mkdir -p "$WORK/cache" "$WORK/data" "$WORK/logs" "$WORK/documents" "$WORK/ovcache"
apptainer exec --cleanenv --nv \
  --bind "$WORK/cache:/isaac-sim/kit/cache" \
  --bind "$WORK/data:/isaac-sim/kit/data" \
  --bind "$WORK/logs:/isaac-sim/kit/logs" \
  --bind "$WORK/documents:/root/Documents" \
  --bind "$WORK/ovcache:/root/.cache" \
  --env ACCEPT_EULA=Y --env OMNI_KIT_ACCEPT_EULA=YES --env PRIVACY_CONSENT=Y \
  isaac-lab-2.3.0.sif /workspace/isaaclab/isaaclab.sh -p /scratch/gilbreth/gupta596/surveyor/g3a.py
rm -rf "$WORK"
echo G3A_JOB_DONE
cat /scratch/gilbreth/gupta596/surveyor/g3a-results.txt
