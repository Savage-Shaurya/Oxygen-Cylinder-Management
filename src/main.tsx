import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/noto-sans/800.css';
import '@fontsource/noto-sans-devanagari/500.css';
import '@fontsource/noto-sans-devanagari/700.css';
import '@fontsource/noto-sans-devanagari/800.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
