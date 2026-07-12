import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// App-wide error boundary: one render error in a large tree should degrade
// gracefully to a recover screen instead of a white screen.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { try { this.setState({ stack: (info && info.componentStack) || '' }); } catch (_) {} }
  render() {
    if (this.state.err) {
      const e = this.state.err;
      const detail = String((e && e.message) || e || 'Unknown error') + '\n\n' + String((e && e.stack) || '').slice(0, 1400) + (this.state.stack ? '\n\n--- component ---' + String(this.state.stack).slice(0, 900) : '');
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0b0d', color: '#e8eaf0', fontFamily: 'Inter, system-ui, sans-serif', padding: '24px', textAlign: 'center' }}>
          <div style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#C5A95E', marginBottom: 10 }}>Just a display hiccup</div>
            <div style={{ fontSize: 14, color: '#9499b0', lineHeight: 1.5, marginBottom: 8 }}>Your data is completely safe. Everything is saved in the cloud — not on this device — so nothing was lost.</div>
            <div style={{ fontSize: 14, color: '#9499b0', lineHeight: 1.5, marginBottom: 18 }}>This is only a temporary glitch on screen. Try Reload first; if it keeps happening, Reset clears local settings (you'll sign in again — your data stays safe).</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
              <button onClick={() => { this.setState({ err: null }); window.location.reload(); }} style={{ background: '#C5A95E', color: '#111', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reload the app</button>
              <button onClick={() => { try { localStorage.clear(); } catch (_) {} window.location.reload(); }} style={{ background: 'transparent', color: '#9499b0', border: '1px solid #2a2d3a', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reset &amp; reload</button>
            </div>
            <details style={{ textAlign: 'left' }} open>
              <summary style={{ fontSize: 11, color: '#555b70', cursor: 'pointer', marginBottom: 6 }}>Technical details (screenshot this)</summary>
              <pre style={{ fontSize: 10, color: '#7a7f95', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto', background: '#111318', padding: 12, borderRadius: 8, lineHeight: 1.4, margin: 0 }}>{detail}</pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
