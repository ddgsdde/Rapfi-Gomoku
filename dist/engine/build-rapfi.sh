#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
source_dir="$root/.cache/rapfi"
revision=1387d11312190ec66665d361ff07a7c70221b78a

if ! command -v emcmake >/dev/null; then
  echo "请先激活 Emscripten SDK 4.0.23。" >&2
  exit 1
fi

if [ ! -d "$source_dir/.git" ]; then
  mkdir -p "$source_dir"
  git -C "$source_dir" init
  git -C "$source_dir" remote add origin https://github.com/dotb1ue/rapfi.git
  git -C "$source_dir" fetch --depth 1 origin "$revision"
  git -C "$source_dir" checkout --detach FETCH_HEAD
fi
test "$(git -C "$source_dir" rev-parse HEAD)" = "$revision"
git -C "$source_dir" submodule update --init --depth 1 Networks

python3 - "$source_dir" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
networks = root / "Networks"
preset = (networks / "config-example/gomocalc-mix9svq.toml").read_text()
config = preset.replace(
    '[[model.evaluator.weights]]\nweight_file = "mix9svqstandard_bs15.bin.lz4"\n', ""
).replace(
    'coord_conversion_mode = "X_flipY"', 'coord_conversion_mode = "none"'
)
(networks / "web.toml").write_text(config)
(networks / "wasm_preloads.txt").write_text("\n".join([
    "web.toml@config.toml",
    "classical/model210901.bin@model210901.bin",
    "mix9svq/mix9svqfreestyle_bsmix.bin.lz4@mix9svqfreestyle_bsmix.bin.lz4",
    "mix9svq/mix9svqrenju_bs15_black.bin.lz4@mix9svqrenju_bs15_black.bin.lz4",
    "mix9svq/mix9svqrenju_bs15_white.bin.lz4@mix9svqrenju_bs15_white.bin.lz4",
]))

cmake = root / "Rapfi/CMakeLists.txt"
cmake.write_text(cmake.read_text().replace("--closure=1", "--closure=0").replace(
    "--pre-js ${CMAKE_SOURCE_DIR}/emscripten/preamble.js ",
    '--pre-js \\"${CMAKE_SOURCE_DIR}/emscripten/preamble.js\\" ',
))
PY

build="$root/.cache/wasm"
emcmake cmake -S "$source_dir/Rapfi" -B "$build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DNO_MULTI_THREADING=ON \
  -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF
cmake --build "$build" --parallel 6
target="$root/dist/engine"
mkdir -p "$target"
cp "$build"/rapfi-single-simd128.{js,wasm,data} "$target/"
cp "$source_dir/Copying.txt" "$target/GPL-3.0.txt"
cp "$source_dir/AUTHORS" "$target/Rapfi-AUTHORS.txt"
cp "$source_dir/Networks/LICENSE" "$target/CC0-1.0.txt"
