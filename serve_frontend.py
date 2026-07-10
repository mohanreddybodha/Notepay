import http.server
import socketserver
import os

PORT = 3000
DIRECTORY = "frontend"

# Static route table: clean path → html filename
STATIC_ROUTES = {
    '/':                '/',             # serves index.html naturally
    '/dashboard':       'dashboard.html',
    '/login':           'login.html',
    '/join':            'join-event.html',
    '/create-event':    'create-event.html',
    '/profile':         'profile.html',
    '/profile/edit':    'edit-profile.html',
    '/profile/setup':   'profile-setup.html',
    '/admin':           'admin.html',
    '/guide':           'guide.html',
    '/privacy':         'privacy.html',
    '/terms':           'terms.html',
    '/donate':          'donate.html',
    '/error':           'error.html',
}

# Prefix routes: any path starting with these prefixes → html filename
# The full path (with segments) is passed to the browser JS via the URL
SEGMENT_ROUTES = [
    ('/event/',         'event.html'),
    ('/edit-event/',    'create-event.html'),
    ('/donate/',        'donate.html'),
    ('/join/',          'join-event.html'),
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def guess_type(self, path):
        # Force correct MIME types (Windows registry often messes up CSS)
        if path.endswith('.css'):
            return 'text/css'
        if path.endswith('.js'):
            return 'application/javascript'
        if path.endswith('.svg'):
            return 'image/svg+xml'
        return super().guess_type(path)

    def translate_path(self, path):
        # Strip query string and fragment for file resolution
        pure_path = path.split('?')[0].split('#')[0]

        # Check static routes first
        if pure_path in STATIC_ROUTES:
            html_file = STATIC_ROUTES[pure_path]
            if html_file == '/':
                return super().translate_path('/index.html')
            return os.path.join(os.getcwd(), DIRECTORY, html_file)

        # Check segment-based prefix routes
        for prefix, html_file in SEGMENT_ROUTES:
            if pure_path.startswith(prefix):
                return os.path.join(os.getcwd(), DIRECTORY, html_file)

        # Strip .html extension: /dashboard.html → serves dashboard.html (backward compat)
        if pure_path.endswith('.html'):
            return super().translate_path(path)

        # Fall through to the default handler (serves actual files: .css, .js, assets, etc.)
        return super().translate_path(path)

    def log_message(self, format, *args):
        # Suppress static asset noise, only log page requests
        path = args[0] if args else ''
        if any(ext in path for ext in ['.css', '.js', '.png', '.svg', '.ico', '.woff', '.json']):
            return
        super().log_message(format, *args)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"  Notepay dev server running at http://localhost:{PORT}")
        print(f"  Serving '{DIRECTORY}/' with clean URL routing enabled")
        httpd.serve_forever()
