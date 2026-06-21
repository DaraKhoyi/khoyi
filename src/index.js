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
            <div style={{ fontSize: 22, fontWeight: 800, color: '#C5A95E', marginBottom: 10 }}>Something went wrong</div>
            <div style={{ fontSize: 14, color: '#9499b0', lineHeight: 1.5, marginBottom: 20 }}>The app hit an unexpected error. Your data is safe. Reloading usually clears it.</div>
            <button onClick={() => { this.setState({ err: null }); window.location.reload(); }} style={{ background: '#C5A95E', color: '#111', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reload</button>
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
