import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url?.split('?')[0] === '/fixture') {
    const multiple = new URL(req.url, 'http://localhost').searchParams.has('multi');
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>jda test page</title><h1>Hello world</h1>
      ${Array.from({ length: multiple ? 4 : 1 }, (_, i) => `<div class="message-body" data-message-id="message-${i + 1}"><div class="message-text">${i ? `Message ${i + 1}` : 'Hello world'}</div><button aria-label="Reply">Reply</button></div>`).join('')}
      <input type="password" value="secret-input"><textarea hidden>secret-textarea</textarea>
      <div id="composer" hidden><div class="ProseMirror" contenteditable="true" aria-multiline="true" role="textbox" aria-label="Message"><p><br></p></div><button aria-label="Send" disabled>Send</button></div><button aria-label="Close replies" hidden>Close replies</button><div id="sent"></div>
      <script>
        let target;
        document.querySelectorAll('button[aria-label="Reply"]').forEach(button => button.onclick = () => {
          target = button.closest('.message-body').dataset.messageId;
          document.querySelector('#composer').hidden = false;
          document.querySelector('[aria-label="Close replies"]').hidden = false;
        });
        document.querySelector('[aria-label="Message"]').addEventListener('input', () => setTimeout(() => { document.querySelector('button[aria-label="Send"]').disabled = false; }, 50));
        document.querySelector('button[aria-label="Send"]').onclick = () => {
          const editor = document.querySelector('[aria-label="Message"]');
          const sent = document.createElement('p'); sent.dataset.messageId = target; sent.textContent = editor.innerText.trim();
          document.querySelector('#sent').append(sent); editor.innerHTML = '<p><br></p>'; document.querySelector('button[aria-label="Send"]').disabled = true; document.querySelector('#composer').hidden = true;
        };
        document.querySelector('[aria-label="Close replies"]').onclick = () => {
          document.body.dataset.closedAfterSend = String(document.querySelectorAll('#sent p').length);
          document.querySelector('#composer').hidden = true;
          document.querySelector('[aria-label="Close replies"]').hidden = true;
        };
        const secret = 'secret-script';
      </script>`); return;
  }
  res.writeHead(404).end();
}).listen(8790, '127.0.0.1');
