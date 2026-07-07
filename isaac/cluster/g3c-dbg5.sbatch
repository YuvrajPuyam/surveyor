#!/bin/bash
# G3c-DBG5: physics-prims-invisible cure test. Submit twice:
#   sbatch --export=ALL,G3C_FIX=usd g3c-dbg5.sbatch
#   sbatch --export=ALL,G3C_FIX=fsd g3c-dbg5.sbatch
#SBATCH -A bera89
#SBATCH -p a10
#SBATCH --qos=standby
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH -c 8
#SBATCH -t 00:15:00
#SBATCH -x gilbreth-h000,gilbreth-h014
#SBATCH -J surveyor-g3cdbg5
#SBATCH -o /scratch/gilbreth/gupta596/surveyor/g3c-dbg5-%j.out
set -x
cd /scratch/gilbreth/gupta596/surveyor
MODE="${G3C_FIX:-usd}"
rm -f "g3c-dbg5-${MODE}-results.txt" "g3c-dbg5-${MODE}-frame.png"
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
    --env G3C_FIX="$MODE" \
    isaac-lab-2.3.0.sif /workspace/isaaclab/isaaclab.sh -p /scratch/gilbreth/gupta596/surveyor/g3c-dbg5.py
  if grep -q "G3CDBG5_" "/scratch/gilbreth/gupta596/surveyor/g3c-dbg5-${MODE}-results.txt"; then break; fi
  echo "RETRY after try $try"
done
rm -rf "$WORK"
echo G3CDBG5_JOB_DONE
cat "/scratch/gilbreth/gupta596/surveyor/g3c-dbg5-${MODE}-results.txt"
