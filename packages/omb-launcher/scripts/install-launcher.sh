#!/bin/sh
# Owner-reviewed bootstrap. The manifest argument is a root-owned pinned copy.
set -eu
script=${0%/*}
[ "$script" != "$0" ] || script=.
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin HOME=/var/empty LANG=C /usr/bin/perl -T "$script/install-release.pl" "$@"
