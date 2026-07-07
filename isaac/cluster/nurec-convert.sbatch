#!/bin/bash
# NuRec conversion: hero splat PLY -> USDZ via 3dgrut (needs GPU).
# The output feeds the pack's /World/Visuals payload -> photoreal robot video.
#SBATCH -A bera89
#SBATCH -p a10
#SBATCH --qos=standby
#SBATCH --gres=gpu:1
#SBATCH --mem=32G
#SBATCH -c 8
#SBATCH -t 00:20:00
#SBATCH -x gilbreth-h000,gilbreth-h014
#SBATCH -J surveyor-nurec
#SBATCH -o /scratch/gilbreth/gupta596/surveyor/nurec-convert.out
set -x
cd /scratch/gilbreth/gupta596/surveyor
source /etc/profile
module load cuda/12.6.0 gcc/11.5.0
unset CONDA_PREFIX CONDA_DEFAULT_ENV CONDA_EXE CONDA_SHLVL _CE_CONDA
export UV_CACHE_DIR=/scratch/gilbreth/gupta596/surveyor/uv-cache
# A10 = sm_86; without this, torch 2.8's JIT targets compute_100 (Blackwell)
# which CUDA 12.6's nvcc rejects
export TORCH_CUDA_ARCH_LIST="8.6"
cd 3dgrut
source .venv/bin/activate
# the venv activate re-exports the installer's full arch list (incl. Blackwell
# compute_100/120 that CUDA 12.6 nvcc rejects) — override AFTER activation
export TORCH_CUDA_ARCH_LIST="8.6"
python -c "import torch; print('cuda available:', torch.cuda.is_available())"
python -m threedgrut.export.scripts.ply_to_usd \
  /scratch/gilbreth/gupta596/surveyor/hero-100k.ply \
  --output_file /scratch/gilbreth/gupta596/surveyor/hero-100k.usdz
echo NUREC_$( [ -s /scratch/gilbreth/gupta596/surveyor/hero-100k.usdz ] && echo PASS || echo FAIL )
ls -la /scratch/gilbreth/gupta596/surveyor/hero-100k.usdz
