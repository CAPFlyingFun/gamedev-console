import http.server, socketserver, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')  # what GitHub Pages sends
        super().end_headers()
os.chdir('/home/user/TRADDOMIUM-Micro-Battle/public')
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(('127.0.0.1', 8804), H).serve_forever()
