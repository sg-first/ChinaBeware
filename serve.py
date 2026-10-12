"""雪岭逃亡 · 本地静态服务器（无需任何依赖）

用途：
    Windows 下注册表把 .js 的 Content Type 映射为 text/plain，
    `python -m http.server` 会照搬该映射，浏览器因此拒绝加载 ES Module
    （报错：Failed to load module script: ... MIME type of "text/plain"）。
    本脚本在服务端强制覆盖常见扩展名的 MIME，并禁用缓存，便于调试。

用法（在项目根目录执行）：
    python serve.py              # 默认端口 8734
    python serve.py 8080         # 指定端口
    python serve.py 8734 --open  # 启动后自动打开浏览器
"""

import http.server
import mimetypes
import os
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 8734
OPEN_BROWSER = '--open' in sys.argv

mimetypes.init()
# 先按 Python 内置表注册，再对关键类型强制覆盖
MIME_FIX = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.fbx': 'application/octet-stream',
}
for ext, mime in MIME_FIX.items():
    mimetypes.add_type(mime, ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        # 兜底：即使系统注册表映射错误，也保证 .js/.mjs 以 JS 类型返回
        if isinstance(path, str) and path.lower().endswith(('.js', '.mjs')):
            return 'text/javascript'
        return super().guess_type(path)

    def end_headers(self):
        # 调试期禁用缓存，改文件后刷新即可生效
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s - %s\n' % (self.address_string(), fmt % args))


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    url = 'http://localhost:%d/index.html' % PORT
    print('雪岭逃亡 · 本地服务器')
    print('  根目录 : %s' % ROOT)
    print('  地址   : %s' % url)
    print('  按 Ctrl+C 停止\n')
    if OPEN_BROWSER:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')


if __name__ == '__main__':
    main()
