import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './panel.css';

// BACKEND CONNECTION: the panel talks to the API at VITE_API_BASE_URL
// when the build sets it; otherwise it defaults to the deployed Render
// backend, so the published panel connects without a dashboard variable.
// Local development can override it with a .env file.
const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ??
  'https://pilot-system-backend.onrender.com';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App apiBaseUrl={apiBaseUrl} />
  </React.StrictMode>,
);
