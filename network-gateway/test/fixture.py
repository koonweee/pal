import http.server
import socket
import subprocess
import threading

PRIVATE = ["10.77.0.3", "100.64.88.3", "169.254.77.3", "192.168.77.3", "172.20.77.3"]
for address in PRIVATE:
    subprocess.run(["ip", "address", "add", address + "/32", "dev", "eth0"], check=True)

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"gateway-fixture-ok")

    def log_message(self, *args):
        pass

for port in (443, 8443):
    threading.Thread(target=http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever, daemon=True).start()

def tcp_echo():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", 53))
    server.listen()
    while True:
        connection, _ = server.accept()
        with connection:
            connection.sendall(connection.recv(100))

threading.Thread(target=tcp_echo, daemon=True).start()
dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
dns.bind(("0.0.0.0", 53))

def udp_echo(server):
    while True:
        data, address = server.recvfrom(100)
        server.sendto(data, address)

threading.Thread(target=udp_echo, args=(dns,), daemon=True).start()
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", 9999))
while True:
    data, address = sock.recvfrom(100)
    sock.sendto(data, address)
