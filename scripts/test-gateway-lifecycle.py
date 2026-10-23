#!/usr/bin/env python3
"""Test real Squid/Nginx supervision in disposable Docker containers.

Run from the repository root after building pal-web-local (scripts/dev-local up):
  python3 scripts/test-gateway-lifecycle.py [--image pal-web-local:latest]
Requires Python 3 and Docker. Builds a temporary test image, starts containers with
no published ports or application volumes, then removes only its own resources.
The fixture replaces execution-boundary discovery; network policy is out of scope.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise RuntimeError(f"docker {args[0]} failed: {result.stderr.strip()}")
    return (result.stdout + result.stderr if args[0] == "logs" else result.stdout).strip()


def state(name):
    return json.loads(docker("inspect", name))[0]


def eventually(check, description, seconds=15):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError(description)


def ready(name):
    return state(name)["State"]["Running"] and docker(
        "exec", name, "sh", "-c",
        'wget -qO- http://127.0.0.1:8080/health >/dev/null && '
        'response=$(http_proxy=http://127.0.0.1:3128 wget -S -O /dev/null -T 2 '
        'http://169.254.169.254/ 2>&1 || true); '
        'case "$response" in *"403 Forbidden"*) echo ready;; esac', check=False,
    ) == "ready"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="pal-web-local:latest")
    args = parser.parse_args()
    prefix = "pal-gateway-lifecycle-" + uuid.uuid4().hex[:10]
    image = prefix + ":test"
    containers = []

    def start(suffix, setup="", restart="no"):
        name = prefix + "-" + suffix
        containers.append(name)
        docker("run", "-d", "--init", "--name", name, "--restart", restart,
               "--entrypoint", "sh", image, "-c", setup + "exec /usr/local/bin/pal-gateway")
        return name

    def exited(name):
        eventually(lambda: not state(name)["State"]["Running"], name + " did not exit")
        assert state(name)["State"]["ExitCode"] == 1, name + " did not report failure"

    try:
        with tempfile.TemporaryDirectory(prefix=prefix) as directory:
            context = Path(directory)
            for filename in ("start.sh", "squid.conf"):
                (context / filename).write_bytes((ROOT / "frontend/gateway" / filename).read_bytes())
            (context / "boundary.sh").write_text(
                "#!/bin/sh\nprintf '# lifecycle fixture\\n' > /etc/nginx/execution-deny.conf\n"
            )
            (context / "Dockerfile").write_text(
                "ARG BASE\nFROM ${BASE}\n"
                "COPY start.sh /usr/local/bin/pal-gateway\n"
                "COPY squid.conf /etc/squid/squid.conf\n"
                "COPY boundary.sh /docker-entrypoint.d/40-execution-boundary.sh\n"
                "RUN chmod +x /docker-entrypoint.d/40-execution-boundary.sh /usr/local/bin/pal-gateway\n"
            )
            docker("build", "--build-arg", "BASE=" + args.image, "-t", image, directory)

        name = start("restart", "echo 1 > /run/squid.pid; ")
        eventually(lambda: ready(name), "stale PID startup failed")
        docker("kill", "--signal", "KILL", name)
        docker("start", name)
        eventually(lambda: ready(name), "unclean container restart failed")
        docker("stop", "--time", "5", name)
        stop_code = state(name)["State"]["ExitCode"]
        assert stop_code == 0, f"graceful stop failed: {stop_code}"
        docker("start", name)
        eventually(lambda: ready(name), "graceful container restart failed")
        print("PASS stale PID, unclean restart, graceful stop and restart")

        name = start("squid-exit", restart="on-failure")
        eventually(lambda: ready(name), "Squid-exit fixture did not start")
        docker("exec", name, "sh", "-c", 'kill -KILL "$(cat /run/squid.pid)"')
        eventually(lambda: state(name)["RestartCount"] >= 1 and ready(name),
                   "Squid death did not restart the gateway")
        print("PASS Squid death triggers automatic container recovery")

        name = start("nginx-exit")
        eventually(lambda: ready(name), "Nginx-exit fixture did not start")
        docker("exec", name, "nginx", "-s", "stop")
        exited(name)
        print("PASS Nginx death terminates the gateway")

        for service, setup in [
            ("squid", "echo invalid_directive >> /etc/squid/squid.conf; "),
            ("nginx", "echo invalid_directive >> /etc/nginx/nginx.conf; "),
        ]:
            name = start(service + "-startup", setup)
            exited(name)
            print("PASS immediate " + service + " startup failure terminates the gateway")
    except Exception:
        for name in containers:
            print(docker("logs", "--tail", "20", name, check=False), flush=True)
        raise
    finally:
        for name in containers:
            docker("rm", "-f", name, check=False)
        docker("image", "rm", image, check=False)


if __name__ == "__main__":
    main()
