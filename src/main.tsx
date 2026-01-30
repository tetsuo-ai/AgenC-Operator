/**
 * ============================================================================
 * TETSUO - AgenC Operator :: Entry Point
 * ============================================================================
 * Main React entry point for the Tauri application.
 * Initializes the app with cyberpunk styling and global providers.
 * ============================================================================
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
