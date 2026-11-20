import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/themes/index.css'
import './styles/global.css'
// Applies theme/accent to <html> before first paint.
import './store/uiStore'
import { installPressFeedback, trackPointerOrigins } from './lib/motion'
import App from './App'

// Menus and sheets grow out of where the pointer pressed (lib/motion.ts).
trackPointerOrigins()
// Buttons marked data-press sink on pointerdown and spring back (cancellable by sliding off).
installPressFeedback()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
