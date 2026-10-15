# Launcher status and owner installation

The designed client path is `/usr/bin/sudo -n -u _ombcert /usr/local/libexec/omb/bin/cert-launch attest`. The owner-installed NOPASSWD rule delegates exactly the installed launcher binary. This drops to the less-privileged certification account; it does not grant Studio root access.

Installation detection uses filesystem existence checks for cert-launch and `/etc/sudoers.d/omb-launcher`, plus `/usr/bin/id -u _ombcert`. Detection never invokes sudo. Missing or unreadable components report **Not installed**. Presence is only an installation hint, never a successful attestation.

The engine caches the initial status check, including failures, and shares in-flight checks. Status notifications, ordinary status reads, and reconnecting clients reuse that cache. **Refresh launcher status** explicitly refreshes it, requesting at most one attest call if installed; absent installations make zero requests. There is no attestation polling loop. An engine restart starts a new cache. Investigation certification checks retain their own authoritative attestation requirements; the displayed cache cannot award scientific labels or OS separation.

**Install or repair launcher** displays the documented owner command and prerequisites; Studio never executes it:

```sh
/usr/bin/sudo /bin/sh <root-owned-temp>/install-launcher.sh <absolute-staging-dir> <root-owned-temp>/MANIFEST <manifest-sha256>
```

Follow [the launcher's owner installation procedure](../../packages/omb-launcher/BUILD-NOTES.md) for a verified release, current hashes, root-owned staging and separate administrator account. After installation/repair, explicitly refresh the status. A refused or malformed attestation remains unavailable/degraded.

Regression tests inject fake launcher executors and installation probes. They assert zero privileged requests while absent and at most one per explicit refresh while installed, including concurrent status reads and reconnected clients. They never execute sudo or contact a model provider.
