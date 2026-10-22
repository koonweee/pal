import { createServer } from 'node:http';
createServer((request, response) => {
  if (request.url.startsWith('/login')) {
    response.setHeader(
      'Set-Cookie',
      'pal_session=migration-session; HttpOnly; Max-Age=86400; Path=/',
    );
    response.end('Logged in');
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      request.headers.cookie?.includes('pal_session=migration-session')
        ? '<h1>Existing login retained</h1>'
        : '<form action=/login><input name=username><input name=password type=password><button>Login</button></form>',
    );
  }
}).listen(8765, '127.0.0.1');
