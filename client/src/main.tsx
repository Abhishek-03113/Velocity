import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
// Applies theme/accent to <html> before first paint.
import './store/uiStore'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
