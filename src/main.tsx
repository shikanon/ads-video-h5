import React from 'react';
import { createRoot } from 'react-dom/client';
import Auth from './Auth';
import Admin from './Admin';
import './styles.css';
import './admin.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, '').endsWith('/admin') ? <Admin /> : <Auth />}
  </React.StrictMode>,
);
