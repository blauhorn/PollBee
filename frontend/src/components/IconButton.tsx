import { ReactNode, useState } from 'react'

type IconButtonProps = {
  onClick?: () => void
  icon: ReactNode
  title?: string
  disabled?: boolean

  variant?: 'default' | 'primary' | 'danger'
  size?: number
}

export default function IconButton({
  onClick,
  icon,
  title,
  disabled = false,
  variant = 'default',
  size = 44,
}: IconButtonProps) {
  const [pressed, setPressed] = useState(false)

  const isInteractive = !disabled

  function getColors() {
    if (!isInteractive) {
      return {
        background: '#f3f4f6',
        color: '#9ca3af',
        border: '#e5e7eb',
      }
    }

    switch (variant) {
      case 'primary':
        return {
          background: '#6085d3',
          color: '#ffffff',
          border: '#cbd5e1',
        }
      case 'danger':
        return {
          background: '#fee2e2',
          color: '#b91c1c',
          border: '#fecaca',
        }
      default:
        return {
          background: '#ffffff',
          color: '#111827',
          border: '#e2e8f0',
        }
    }
  }

  const colors = getColors()

  return (
    <button
      type="button"
      onClick={isInteractive ? onClick : undefined}
      title={title}
      disabled={!isInteractive}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: isInteractive ? 'pointer' : 'not-allowed',
        transform: pressed ? 'scale(0.95)' : 'scale(1)',
        boxShadow: pressed
          ? '0 2px 6px rgba(0,0,0,0.15)'
          : '0 8px 24px rgba(15, 23, 42, 0.15)',
        transition: 'transform 0.1s ease, box-shadow 0.1s ease',
      }}
    >
      {icon}
    </button>
  )
}