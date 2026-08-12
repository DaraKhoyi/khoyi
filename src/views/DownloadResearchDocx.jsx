// DownloadResearchDocx — export a contact's research as a .docx.
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../dataService';

export default function DownloadResearchDocx({ contactId, contactName }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function download(mode) {
    setBusy(true); setOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke('research-report-docx', { body: { contact_id: contactId, mode } });
      if (error || !data || !data.base64) throw new Error((error && error.message) || (data && data.error) || 'Could not generate the report');
      // base64 → Blob → download
      const bin = atob(data.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = data.filename || 'research.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (window.__notify) window.__notify('Word report downloaded.', 'success');
    } catch (e) {
      if (window.__notify) window.__notify('Report failed: ' + (e.message || 'unknown error'), 'error');
    } finally { setBusy(false); }
  }
  return (
    <>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }} style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        {busy ? 'Building…' : '⬇ Word report'}
      </button>
      {open && createPortal(
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1a1510', border: '1px solid rgba(203,163,92,0.4)', borderRadius: '18px 18px 0 0',
            width: '100%', maxWidth: '460px', padding: '8px 8px calc(18px + env(safe-area-inset-bottom,0px))',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', animation: 'sheetUp .22s ease-out',
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 4, background: 'rgba(203,163,92,0.5)', margin: '6px auto 12px' }} />
            <div style={{ padding: '0 12px 10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: '#EBCB82', marginBottom: 4 }}>Download Word report</div>
              <div style={{ fontSize: '13px', color: '#FFFFFF' }}>Who is this for? Pick what it should include.</div>
            </div>
            <button onClick={() => download('client')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(203,163,92,0.35)', color: '#FFFFFF', padding: '14px 16px', borderRadius: '12px', cursor: 'pointer', marginBottom: '10px' }}>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#FFFFFF' }}>Client-facing dossier</div>
              <div style={{ fontSize: '12.5px', color: '#E8E0D2', marginTop: '4px', lineHeight: 1.5 }}>A polished bio to share with the person or a referral partner. No behavioral read, no coaching.</div>
            </button>
            <button onClick={() => download('agent')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(203,163,92,0.35)', color: '#FFFFFF', padding: '14px 16px', borderRadius: '12px', cursor: 'pointer' }}>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#FFFFFF' }}>Agent prep sheet</div>
              <div style={{ fontSize: '12.5px', color: '#E8E0D2', marginTop: '4px', lineHeight: 1.5 }}>Adds the DISC behavioral read. Still excludes the rapport and things-to-avoid coaching.</div>
            </button>
            <button onClick={() => setOpen(false)} style={{ display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none', color: '#FFFFFF', padding: '14px', marginTop: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>Cancel</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
