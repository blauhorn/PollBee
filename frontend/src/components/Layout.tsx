import { Outlet } from 'react-router-dom'
import type { User } from '../api'

type LayoutProps = {
  currentUser: User | null
  onLogout: () => Promise<void>
}

export default function Layout({ currentUser, onLogout }: LayoutProps) {
  void currentUser
  void onLogout

  return (
    <div
      style={{
        fontFamily: 'Arial, sans-serif',
        minHeight: '100vh',
        background: '#ffffff',
      }}
    >
      <Outlet />
    </div>
  )
}
