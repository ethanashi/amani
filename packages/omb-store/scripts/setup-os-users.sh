#!/bin/sh
# Owner-run provisioning only. Never executed by library code or package tests.
# Usage: sudo sh setup-os-users.sh /absolute/new/authority-root
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run once with sudo.' >&2; exit 1; }
[ "$#" -eq 1 ] || { echo 'Supply an explicit NEW authority-root path.' >&2; exit 1; }
case "$1" in /*) ;; *) echo 'Absolute root required.' >&2; exit 1;; esac
[ ! -e "$1" ] && [ ! -L "$1" ] || { echo 'Root already exists; inspect manually.' >&2; exit 1; }
case "$(uname -s)" in
  Darwin)
    for user in _ombcert _ombrun; do
      if id "$user" >/dev/null 2>&1; then
        echo "$user already exists; inspect manually before provisioning." >&2; exit 1
      fi
    done
    # Select unused IDs in the local service range; never alter existing users.
    uid=400
    for user in _ombcert _ombrun; do
      while dscl . -search /Users UniqueID "$uid" | /usr/bin/grep -q . || dscl . -search /Groups PrimaryGroupID "$uid" | /usr/bin/grep -q .; do uid=$((uid + 1)); done
      [ "$uid" -lt 500 ] || { echo 'No free service UID below 500.' >&2; exit 1; }
      dscl . -create "/Groups/$user"
      dscl . -create "/Groups/$user" PrimaryGroupID "$uid"
      dscl . -create "/Users/$user"
      dscl . -create "/Users/$user" UniqueID "$uid"
      dscl . -create "/Users/$user" PrimaryGroupID "$uid"
      dscl . -create "/Users/$user" UserShell /usr/bin/false
      dscl . -create "/Users/$user" NFSHomeDirectory /var/empty
      dscl . -create "/Users/$user" IsHidden 1
      dscl . -create "/Users/$user" Password '*'
      uid=$((uid + 1))
    done
    ;;
  Linux)
    for user in _ombcert _ombrun; do
      if id "$user" >/dev/null 2>&1; then echo "$user already exists; inspect manually." >&2; exit 1; fi
    done
    for user in _ombcert _ombrun; do useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"; done
    ;;
  *) echo 'Unsupported OS.' >&2; exit 1;;
esac
umask 077
mkdir "$1"
chown _ombcert:_ombcert "$1"
chmod 700 "$1"
# Key generation stays with the owner/host; do not grant general sudo execution,
# mount this root for workers, or make _ombrun a member of the _ombcert group.
echo 'Users and authority root created. Configure a narrow audited launcher separately.'
