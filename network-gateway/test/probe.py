import asyncio
import aiohttp
import json
import socket

async def main():
    result = {}
    for address in ["10.77.0.3", "100.64.88.3", "169.254.77.3", "192.168.77.3", "172.20.77.3", "203.0.114.3"]:
        try:
            # aiohttp's default client ignores HTTP_PROXY/HTTPS_PROXY.
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=1)) as session:
                async with session.get("http://" + address + ":8443/") as response:
                    result[address] = response.status
        except (aiohttp.ClientError, asyncio.TimeoutError):
            result[address] = "blocked"
    with socket.create_connection(("203.0.114.3", 8443), timeout=2):
        result["raw_tcp"] = "connected"
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(2)
    sock.sendto(b"udp-ok", ("203.0.114.3", 9999))
    result["udp"] = sock.recvfrom(100)[0].decode()
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=1)) as session:
            async with session.get("http://100.64.77.3:443/") as response:
                result["tailnet_https"] = response.status
    except (aiohttp.ClientError, asyncio.TimeoutError):
        result["tailnet_https"] = "blocked"
    try:
        with socket.create_connection(("100.64.77.3", 8443), timeout=1):
            result["tailnet_other_tcp"] = "connected"
    except OSError:
        result["tailnet_other_tcp"] = "blocked"
    try:
        with socket.create_connection(("100.64.77.3", 53), timeout=1) as dns:
            dns.sendall(b"dns-ok")
            result["tailnet_dns_tcp"] = dns.recv(100).decode()
    except OSError:
        result["tailnet_dns_tcp"] = "blocked"
    dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dns.settimeout(1)
    try:
        dns.sendto(b"dns-ok", ("100.64.77.3", 53))
        result["tailnet_dns_udp"] = dns.recvfrom(100)[0].decode()
    except OSError:
        result["tailnet_dns_udp"] = "blocked"
    other = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    other.settimeout(1)
    try:
        other.sendto(b"udp-ok", ("100.64.77.3", 9999))
        result["tailnet_other_udp"] = other.recvfrom(100)[0].decode()
    except OSError:
        result["tailnet_other_udp"] = "blocked"
    print(json.dumps(result))

asyncio.run(main())
