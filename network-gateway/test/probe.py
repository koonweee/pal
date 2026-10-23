import asyncio
import aiohttp
import json
import socket

async def main():
    result = {}
    for address in ["10.77.0.3", "100.64.77.3", "169.254.77.3", "192.168.77.3", "172.20.77.3", "203.0.114.3"]:
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
    print(json.dumps(result))

asyncio.run(main())
