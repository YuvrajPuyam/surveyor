#!/bin/bash
# G3c: the g3b pick-and-place, captured to RGB frames headlessly.
#SBATCH -A bera89
#SBATCH -p a10
#SBATCH --qos=standby
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -c 8
#SBATCH -t 00:25:00
#SBATCH -x gilbreth-h000,gilbreth-h014
#SBATCH -J surveyor-g4
#SBATCH -o /scratch/gilbreth/gupta596/surveyor/g4.out
set -x
cd /scratch/gilbreth/gupta596/surveyor
rm -rf g4-frames
WORK=$(mktemp -d /tmp/isaac-kit-XXXX)
mkdir -p "$WORK/cache" "$WORK/data" "$WORK/logs" "$WORK/documents" "$WORK/ovcache"
for try in 1 2 3; do
  apptainer exec --cleanenv --nv \
    --bind "$WORK/cache:/isaac-sim/kit/cache" \
    --bind "$WORK/data:/isaac-sim/kit/data" \
    --bind "$WORK/logs:/isaac-sim/kit/logs" \
    --bind "$WORK/documents:/root/Documents" \
    --bind "$WORK/ovcache:/root/.cache" \
    --env ACCEPT_EULA=Y --env OMNI_KIT_ACCEPT_EULA=YES --env PRIVACY_CONSENT=Y \
    isaac-lab-2.3.0.sif /workspace/isaaclab/isaaclab.sh -p /scratch/gilbreth/gupta596/surveyor/g4.py
  if grep -q "G4_" /scratch/gilbreth/gupta596/surveyor/g4-results.txt; then break; fi
  echo "RETRY after try $try (kit crashed before a verdict)"
done
rm -rf "$WORK"
echo G4_JOB_DONE
ls /scratch/gilbreth/gupta596/surveyor/g4-frames | head -3
ls /scratch/gilbreth/gupta596/surveyor/g4-frames | wc -l
cat /scratch/gilbreth/gupta596/surveyor/g4-results.txt
