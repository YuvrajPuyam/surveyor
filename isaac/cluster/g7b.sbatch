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
#SBATCH -J surveyor-g7b
#SBATCH -o /scratch/gilbreth/gupta596/surveyor/g7b.out
set -x
cd /scratch/gilbreth/gupta596/surveyor
rm -f g7b-results.txt && rm -rf g7b-frames-fp g7b-frames-tp
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
    isaac-lab-2.3.0.sif /workspace/isaaclab/isaaclab.sh -p /scratch/gilbreth/gupta596/surveyor/g7b.py
  if grep -q "G7B_" /scratch/gilbreth/gupta596/surveyor/g7b-results.txt; then break; fi
  echo "RETRY after try $try (kit crashed before a verdict)"
done
rm -rf "$WORK"
# bank the footage as movies BEFORE any future run can rm the frames
bash -lc 'module load ffmpeg 2>/dev/null; for st in fp tp; do
  d=/scratch/gilbreth/gupta596/surveyor/g7b-frames-$st
  [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ] &&     ffmpeg -y -framerate 30 -i "$d/frame_%05d.png" -c:v mpeg4 -q:v 2 -pix_fmt yuv420p       /scratch/gilbreth/gupta596/surveyor/g7b-$st-job$SLURM_JOB_ID.mp4
done'
echo G7B_JOB_DONE


cat /scratch/gilbreth/gupta596/surveyor/g7b-results.txt
