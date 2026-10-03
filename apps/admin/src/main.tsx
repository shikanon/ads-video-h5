import React from 'react';
import { createRoot } from 'react-dom/client';
import Admin from './Admin';
import './admin.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Admin /></React.StrictMode>);
