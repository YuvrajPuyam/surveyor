#!/bin/bash
# 3dgrut installer v2 — repo uses UV now (install_env_uv.sh).
# Login node: internet OK, no GPU needed to build. Logs to 3dgrut-install.log.
set -x
cd /scratch/gilbreth/gupta596/surveyor

source /etc/profile
module load cuda/12.6.0 gcc/11.5.0

# uv + caches on scratch (home quota safety)
export UV_CACHE_DIR=/scratch/gilbreth/gupta596/surveyor/uv-cache
export UV_INSTALL_DIR=/scratch/gilbreth/gupta596/surveyor/uv-bin
export PATH="$UV_INSTALL_DIR:$PATH"
mkdir -p "$UV_CACHE_DIR"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
uv --version || exit 1

cd 3dgrut
# the login profile activates conda base; that makes the installer take its
# "conda manages CUDA" branch and never detect the system toolkit. Force the
# system-CUDA path:
unset CONDA_PREFIX CONDA_DEFAULT_ENV CONDA_EXE CONDA_SHLVL _CE_CONDA
echo "CUDA_HOME=$CUDA_HOME nvcc=$(which nvcc) gcc=$(gcc --version | head -1)"
./install_env_uv.sh 2>&1
echo INSTALL_UV_DONE

# smoke: does the export module import? (no GPU on login node — import only)
source .venv/bin/activate 2>/dev/null || source */bin/activate 2>/dev/null
python -c "import torch; print('torch', torch.__version__, 'cuda', torch.version.cuda)" && echo TORCH_OK
python -c "import threedgrut; print('threedgrut import OK')" && echo ENV_OK
