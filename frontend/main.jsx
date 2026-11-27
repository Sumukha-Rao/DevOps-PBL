import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function copyWithTextarea(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('copy command was rejected');
}

function App() {
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  async function shorten(event) {
    event.preventDefault();
    setPending(true);
    setLink('');
    setError('');
    setCopyStatus('');
    try {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!response.ok) {
        setError(response.status === 422
          ? 'Enter a valid HTTP or HTTPS URL without credentials.'
          : 'Could not create a short link. Try again.');
        return;
      }
      const data = await response.json();
      setLink(data.short_url);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      // The Clipboard API exists only on secure origins (HTTPS or localhost).
      // Plain HTTP, such as an Ingress host, falls back to a hidden textarea.
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(link);
      } else {
        copyWithTextarea(link);
      }
      setCopyStatus('Copied to clipboard.');
    } catch {
      setCopyStatus('Select and copy the short link manually.');
    }
  }

  return (
    <main>
      <header>
        <span>Project 23</span>
        <a href="/docs">API docs</a>
      </header>
      <section aria-labelledby="title">
        <h1 id="title">URL Shortener</h1>
        <p className="lede">Paste a long link. Get a short one you can share.</p>
        <form onSubmit={shorten}>
          <label htmlFor="url">Destination URL</label>
          <div className="row">
            <input id="url" type="url" required placeholder="https://example.com/" value={url}
              onChange={(event) => setUrl(event.target.value)} />
            <button disabled={pending}>{pending ? 'Creating…' : 'Shorten'}</button>
          </div>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        {link && (
          <div className="result">
            <div>
              <strong>Short link</strong>
              <a href={link}>{link}</a>
            </div>
            <button type="button" onClick={copy}>Copy</button>
          </div>
        )}
        <div role="status">{copyStatus}</div>
      </section>
      <footer>
        <span>Client / API / Database</span>
        <span>React, FastAPI, PostgreSQL</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
