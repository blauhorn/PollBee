import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

const basePath = import.meta.env.VITE_BASE_PATH || '/pollapp/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basePath.replace(/\/$/, '')}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
