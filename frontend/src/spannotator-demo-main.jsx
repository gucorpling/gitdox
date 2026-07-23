import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import Spannotator from './components/Spannotator';

const demoText = [
  'The cat sat on the mat',
  'A cat with a spot on its back',
  'The house had a red door'
].join('\n');

function DemoPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '16px' }}>
      <h1 style={{ margin: '0 0 12px 0', fontSize: '20px', fontWeight: 700 }}>Spannotator Demo</h1>
      <p style={{ margin: '0 0 12px 0', color: '#475569' }}>
        Select tokens, press Enter to create mentions, and switch color mode to test grouping.
      </p>
      <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
        <Spannotator initialText={demoText} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<DemoPage />);
