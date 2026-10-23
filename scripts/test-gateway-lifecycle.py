#!/usr/bin/env python3
"""Exercise production egress policy and independent lifecycle in disposable Docker resources.

Run from any directory: python3 scripts/test-gateway-lifecycle.py
Requires Docker Engine >= 28.1, Compose >= 2.36, and free 172.30.233.0/24 + 203.0.114.0/24.
Use --network-prefix to select another unused private /24. No application volumes
or published ports are used. All test containers, networks and image tags are removed.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ["10.77.0.3", "100.64.77.3", "169.254.77.3", "192.168.77.3", "172.20.77.3"]


def run(*args, check=True, env=None, timeout=120):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(" ".join(args[:3]) + " failed: " + result.stderr[-2000:])
    return result


def eventually(check, description, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(description)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network-prefix", default="172.30.233")
    args = parser.parse_args()
    project = "pal-egress-test-" + uuid.uuid4().hex[:10]
    router_image, fixture_image = project + ":router", project + ":fixture"
    env = dict(os.environ, PAL_EXECUTION_NETWORK_PREFIX=args.network_prefix)
    config = json.loads(run("docker", "compose", "-f", str(ROOT / "backend/compose.yaml"),
                            "config", "--no-env-resolution", "--format", "json", env=env).stdout)
    router = config["services"]["egress"]
    router["image"] = router_image
    router["stop_grace_period"] = "1s"
    client = config["services"]["execution"]
    client = {key: client[key] for key in ["cap_drop", "security_opt", "sysctls", "networks", "init"]}
    client["security_opt"] = ["seccomp:" + str(ROOT / "backend/desktop/seccomp.json")]
    client.update(image=fixture_image, command=["sleep", "infinity"], stop_grace_period="1s")
    transit = config["networks"]["execution"]
    transit.pop("name", None)
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        path = Path(directory)
        (path / "Dockerfile").write_text(
            "FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8\nRUN apk add --no-cache python3 py3-aiohttp curl iproute2 nftables util-linux\n"
            "COPY fixture.py probe.py /test/\n")
        for filename in ["fixture.py", "probe.py"]:
            (path / filename).write_bytes((ROOT / "network-gateway/test" / filename).read_bytes())
        fixture = dict(image=fixture_image, build=str(path), cap_add=["NET_ADMIN"],
                       command=["python3", "/test/fixture.py"], stop_grace_period="1s",
                       networks={"egress": {"ipv4_address": "203.0.114.3"}})
        definition = dict(services=dict(egress=router, execution=client, fixture=fixture), networks={
            "execution": transit, "egress": {"ipam": {"config": [{"subnet": "203.0.114.0/24"}]}}
        })
        compose_file = path / "compose.json"
        compose_file.write_text(json.dumps(definition))
        compose = ["docker", "compose", "-p", project, "-f", str(compose_file)]

        def dc(*command, **kwargs):
            return run(*compose, *command, **kwargs)

        def execute(service, *command, **kwargs):
            return dc("exec", "-T", service, *command, **kwargs)

        def state(service):
            name = dc("ps", "-a", "-q", service).stdout.strip()
            return json.loads(run("docker", "inspect", name).stdout)[0]

        def ready():
            return state("egress")["State"].get("Health", {}).get("Status") == "healthy"

        def routes():
            for address in PRIVATE:
                execute("egress", "ip", "route", "replace", address + "/32", "via", "203.0.114.3", "dev", "palwan0")

        def probe():
            result = json.loads(execute("execution", "python3", "/test/probe.py").stdout)
            assert all(result[address] == "blocked" for address in PRIVATE), result
            assert result["203.0.114.3"] == 200 and result["raw_tcp"] == "connected" and result["udp"] == "udp-ok", result

        def denied(address):
            result = execute("execution", "curl", "--noproxy", "*", "--fail", "--silent", "--max-time", "1",
                             "http://" + address + ":8443/", check=False)
            assert result.returncode != 0, "Unexpected connection to " + address

        def identity():
            return execute("execution", "sh", "-c", "readlink /proc/self/ns/net; awk '{print $22}' /proc/1/stat").stdout

        try:
            dc("build", "egress", "fixture", timeout=240)
            dc("up", "-d", "fixture", "execution")
            before = identity()
            denied("203.0.114.3")
            denied(PRIVATE[0])
            # Delay the real bootstrap to test execution starting before policy installation.
            fixture_routes = "; ".join("ip route replace " + address + "/32 via 203.0.114.3 dev palwan0" for address in PRIVATE)
            router["command"] = ["sh", "-c", fixture_routes + "; sleep 3; exec sh /opt/pal-egress/start.sh"]
            compose_file.write_text(json.dumps(definition))
            dc("up", "-d", "egress")
            denied(PRIVATE[0])
            eventually(ready, "Router did not become ready")
            routes()
            # Prove private fixture reachability from the uplink before asserting denial.
            for address in PRIVATE:
                assert execute("egress", "wget", "-T", "2", "-qO-", "http://" + address + ":8443/").stdout == "gateway-fixture-ok"
            probe()
            print("PASS proxy-unaware HTTP, raw TCP/UDP, custom ports, private/Tailnet/link-local policy and delayed bootstrap", flush=True)
            for command in [
                ["ip", "route", "replace", "default", "via", args.network_prefix + ".2"],
                ["nft", "flush", "ruleset"],
                ["python3", "-c", "import socket; socket.socket(socket.AF_PACKET,socket.SOCK_RAW)"],
                ["unshare", "-Ur", "ip", "route", "replace", "default", "via", args.network_prefix + ".2"],
                ["unshare", "-Urn", "python3", "-c", "import socket; socket.create_connection(('203.0.114.3',8443),timeout=1)"],
                ["python3", "-c", "import socket; socket.create_connection(('::ffff:10.77.0.3',8443),timeout=1)"],
            ]:
                assert execute("execution", *command, check=False).returncode != 0, command
            assert execute("execution", "cat", "/proc/sys/net/ipv6/conf/all/disable_ipv6").stdout.strip() == "1"
            print("PASS root route/rule/raw-socket denial, user namespaces and disabled IPv6", flush=True)
            dc("stop", "-t", "1", "egress")
            denied("203.0.114.3")
            denied(PRIVATE[0])
            dc("start", "egress")
            eventually(ready, "Router did not recover after stop")
            routes()
            probe()
            assert identity() == before, "Execution restarted with the router"
            router.pop("command")
            compose_file.write_text(json.dumps(definition))
            dc("up", "-d", "--no-deps", "--force-recreate", "--wait", "egress")
            routes()
            probe()
            assert identity() == before, "Execution changed during router replacement"
            main_pid = execute("egress", "pgrep", "-x", "sleep").stdout.strip()
            execute("egress", "kill", "-KILL", main_pid)
            eventually(lambda: state("egress")["RestartCount"] > 0 and ready(), "Automatic router recovery failed")
            routes()
            probe()
            assert identity() == before, "Execution changed during automatic router recovery"
            dc("restart", "-t", "1", "execution")
            probe()
            print("PASS fail-closed outage, router replacement/automatic recovery, unchanged execution and independent execution restart", flush=True)
        except Exception:
            print(dc("logs", "--tail", "15", check=False).stdout, flush=True)
            raise
        finally:
            dc("down", "--volumes", "--remove-orphans", check=False)
            run("docker", "image", "rm", router_image, fixture_image, check=False)


if __name__ == "__main__":
    main()
