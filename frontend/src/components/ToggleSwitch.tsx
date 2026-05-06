type ToggleSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          onChange(!checked)
        }
      }}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        position: 'relative',
        width: '3.2rem',
        height: '1.8rem',
        borderRadius: '999px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        background: checked ? '#2563eb' : '#cbd5e1',
        opacity: disabled ? 0.6 : 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '0.2rem',
          left: checked ? '1.6rem' : '0.2rem',
          width: '1.4rem',
          height: '1.4rem',
          borderRadius: '50%',
          background: '#ffffff',
          transition: 'all 0.2s ease',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}