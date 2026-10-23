import http.server
import socket
import subprocess
import threading

PRIVATE = ["10.77.0.3", "100.64.77.3", "169.254.77.3", "192.168.77.3", "172.20.77.3"]
for address in PRIVATE:
    subprocess.run(["ip", "address", "add", address + "/32", "dev", "eth0"], check=True)

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"gateway-fixture-ok")

    def log_message(self, *args):
        pass

threading.Thread(target=http.server.ThreadingHTTPServer(("0.0.0.0", 8443), Handler).serve_forever, daemon=True).start()
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", 9999))
while True:
    data, address = sock.recvfrom(100)
    sock.sendto(data, address)
