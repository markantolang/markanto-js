#!/usr/bin/env bash
# The gate before every commit, the one definition of it: `bun run verify` and CI run this script. Cheap checks
# first: the conformance corpus and its spec references under Bun, the type and boundary checks, the tests under Bun
# with coverage, the corpus and the same test files under Node, the facts check (it reruns the Bun tests and the
# corpus), the package smoke test (it builds dist/, the gate's one build, and runs the packed package in a consumer
# project on the Node on the PATH and on Bun), and gitleaks on the commits and on what is staged.
# No step writes a tracked file: generated reports are compared with what the code produces, and only their own
# commands rewrite them (named in the failure).
# It guards against mistakes in an ordinary clone, not against deliberate circumvention: NODE_OPTIONS, git
# update-index flags, symlinked index entries or .gitattributes tricks that hide or redirect changes are outside it.
# It needs Bun, Node, git, and npm, tar and gzip for the package smoke test, and mise, which fetches gitleaks; only
# without mise (an isolated runner without network) is the secret scan left out, and the gate says so.
# check:spec-sync is left out: it needs a checkout of the specification beside this repository.
set -euo pipefail
# Run from the repository root, the directory of this script, with no tool to find it.
if [[ $0 == */* ]]; then cd "${0%/*}"; fi

missing=()
for tool in bun node git npm tar gzip; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if ((${#missing[@]} > 0)); then
  echo "check.sh: needed and not on the PATH: ${missing[*]}" >&2
  exit 1
fi
secret_scan=yes
if ! command -v mise >/dev/null; then
  secret_scan=no
  echo 'check.sh: mise is not on the PATH, so the gitleaks secret scan is left out'
fi
gitleaks() { mise exec gitleaks@8.30.1 -- gitleaks "$@" --redact --no-banner --log-level warn; }

# Each step is called directly, or a package script through `npm --ignore-scripts run`, never through `bun run`, so
# that no package lifecycle hook (a `pretest`) runs with it.

# A temporary directory for what the steps write outside the tree, removed on exit.
work_directory=$(mktemp -d)
trap 'rm -rf "$work_directory"' EXIT

# The test-file convention: every file of the working tree outside node_modules and .git, ignored or not, whose name
# has the test marker (`.test.` or `_spec.` and the like, in any case) is test/**/*.test.ts or test/**/*.test.mjs with
# no name below test/ starting with a dot (both runtimes skip those), so that the Node globs below run every file Bun
# runs and no test file has an extension neither loads.
find . \( -name node_modules -o -name .git \) -prune -o -type f -print0 >"$work_directory/files"
test_marker='[._](test|spec)\.'
convention='^test/([^./][^/]*/)*[^./][^/]*\.test\.(ts|mjs)$'
misnamed=()
while IFS= read -r -d '' path; do
  path=${path#./}
  shopt -s nocasematch
  [[ ${path##*/} =~ $test_marker ]] && has_marker=yes || has_marker=no
  shopt -u nocasematch
  if [[ $has_marker == yes && ! $path =~ $convention ]]; then misnamed+=("$path"); fi
done <"$work_directory/files"
if ((${#misnamed[@]} > 0)); then
  echo "check.sh: named like a test but not test/**/*.test.ts or test/**/*.test.mjs outside dot directories:" >&2
  printf '%s\n' "${misnamed[@]}" >&2
  exit 1
fi

bun scripts/validate-corpus.mjs
bun scripts/audit-corpus.mjs
npm --ignore-scripts run check
# Bun's tests run in its CI mode (this Bun has no --ci), so that a missing snapshot fails instead of being written,
# with the empty configuration scripts/bunfig.empty.toml, so that no bunfig.toml redirects their output, and with the
# coverage output in a temporary directory.
CI=true bun test --config=scripts/bunfig.empty.toml --coverage --coverage-dir="$work_directory/coverage"
node scripts/validate-corpus.mjs
# Node runs the same test files by the naming convention's globs; it has no discovery of its own.
node --test 'test/**/*.test.ts' 'test/**/*.test.mjs'
CI=true bun scripts/facts.ts --check
node test/package-smoke.ts
if [[ $secret_scan == yes ]]; then
  gitleaks git .
  gitleaks git . --pre-commit --staged
fi
