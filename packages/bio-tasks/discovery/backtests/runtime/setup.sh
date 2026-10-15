#!/usr/bin/env bash
set -euo pipefail
runtime_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$runtime_dir"
nice -n 15 pixi install --frozen
archive_path="$runtime_dir/lawstat_3.4.tar.gz"
trap 'if [[ -f "$archive_path" ]]; then rm "$archive_path"; fi' EXIT
curl --fail --location --silent --show-error https://cran.r-project.org/src/contrib/Archive/lawstat/lawstat_3.4.tar.gz --output "$archive_path"
actual_hash="$(shasum -a 256 "$archive_path" | cut -d ' ' -f 1)"
test "$actual_hash" = 411d0bb84e42140eb944ced36261119528aae1c330fd884c96987687352d3dff
nice -n 15 .pixi/envs/default/bin/R CMD INSTALL "$archive_path"
