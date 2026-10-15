#!/usr/bin/env python3
"""A loopback HTTPS CONNECT proxy that only tunnels to an allowlist of hosts on port 443,
so an arm running under an OS seatbelt (which denies all outbound except this proxy) can reach
its own model API and nothing else. Every request is logged, allowed or not.

  egress_proxy.py --allow HOST[,HOST...] --log FILE [--port 0] [--portfile FILE]

* Only `CONNECT host:443` to an allowlisted host (exact or a subdomain of one) is tunnelled.
* Everything else gets 403 and is logged with "ok": false. Plain HTTP (GET/POST) is refused.
* With --port 0 the OS picks a free port; the chosen port is printed and written to --portfile.
Standard library only; one thread per connection, daemonised, so the parent can kill the group.
"""
from __future__ import annotations

import argparse
import json
import select
import socket
import socketserver
import sys
import threading
import time


def host_allowed(allow: set[str], host: str, port: str) -> bool:
    """A CONNECT target is allowed only on port 443 and only to an allowlisted host or a subdomain
    of one. Exposed as a function so the decision can be unit-tested without sockets."""
    if port != "443":
        return False
    host = host.lower().rstrip(".")
    return any(host == a or host.endswith("." + a) for a in allow)


class Handler(socketserver.BaseRequestHandler):
    def log(self, line: str, ok: bool, note: str = "") -> None:
        rec = {"t": round(time.time(), 3), "req": line[:200], "ok": ok}
        if note:
            rec["note"] = note
        with self.server.log_lock:  # type: ignore[attr-defined]
            with open(self.server.log_path, "a") as fh:  # type: ignore[attr-defined]
                fh.write(json.dumps(rec) + "\n")

    def allowed(self, host: str, port: str) -> bool:
        return host_allowed(self.server.allow, host, port)  # type: ignore[attr-defined]

    def handle(self) -> None:
        s = self.request
        s.settimeout(30)
        buf = b""
        try:
            while b"\r\n\r\n" not in buf:
                d = s.recv(4096)
                if not d:
                    return
                buf += d
                if len(buf) > 65536:
                    return
        except OSError:
            return
        line = buf.split(b"\r\n", 1)[0].decode("latin1", "replace")
        parts = line.split()
        if len(parts) < 2 or parts[0].upper() != "CONNECT":
            self.log(line, False, "non-connect")
            try:
                s.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            return
        host, _, port = parts[1].rpartition(":")
        if not self.allowed(host, port):
            self.log(line, False, "not-allowed")
            try:
                s.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            return
        self.log(line, True)
        try:
            upstream = socket.create_connection((host, int(port)), timeout=30)
        except OSError as e:
            try:
                s.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.log(line, False, f"upstream-fail:{e}")
            return
        try:
            s.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        except OSError:
            upstream.close()
            return
        socks = [s, upstream]
        try:
            while True:
                r, _, _ = select.select(socks, [], [], 300)
                if not r:
                    break
                for x in r:
                    try:
                        data = x.recv(65536)
                    except OSError:
                        return
                    if not data:
                        return
                    (upstream if x is s else s).sendall(data)
        finally:
            upstream.close()


class Proxy(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--portfile")
    a = ap.parse_args()
    srv = Proxy(("127.0.0.1", a.port), Handler)
    srv.allow = {h.strip().lower() for h in a.allow.split(",") if h.strip()}  # type: ignore[attr-defined]
    srv.log_path = a.log  # type: ignore[attr-defined]
    srv.log_lock = threading.Lock()  # type: ignore[attr-defined]
    port = srv.server_address[1]
    if a.portfile:
        with open(a.portfile, "w") as fh:
            fh.write(str(port) + "\n")
    print(port, flush=True)
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
