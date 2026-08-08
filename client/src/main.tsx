import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './velocity.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <div data-velocity-root style={{ height: '100%' }}>
      <App />
    </div>
  </React.StrictMode>,
)
