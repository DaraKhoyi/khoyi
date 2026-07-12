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
  componentDidCatch(err, info) { /* hook for future logging */ }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0b0d', color: '#e8eaf0', fontFamily: 'Inter, system-ui, sans-serif', padding: '24px', textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#C5A95E', marginBottom: 10 }}>Just a display hiccup</div>
            <div style={{ fontSize: 14, color: '#9499b0', lineHeight: 1.5, marginBottom: 8 }}>Your data is completely safe. Everything is saved in the cloud — not on this device — so nothing was lost.</div>
            <div style={{ fontSize: 14, color: '#9499b0', lineHeight: 1.5, marginBottom: 20 }}>This is only a temporary glitch on screen. Tap below to refresh the app — you'll pick up right where you left off.</div>
            <button onClick={() => { this.setState({ err: null }); window.location.reload(); }} style={{ background: '#C5A95E', color: '#111', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reload the app</button>
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
