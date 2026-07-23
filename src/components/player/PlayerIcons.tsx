import type { ReactNode } from 'react'

type IconProps = {
  size?: number
  className?: string
}

function Icon({
  size = 22,
  className,
  children,
  label,
}: IconProps & { children: ReactNode; label?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  )
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.5v13l11-6.5L8 5.5z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconPause(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconSkipBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 12L18 7v10l-7-5z" fill="currentColor" stroke="none" />
      <path d="M6 12L13 7v10L6 12z" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M5 6v12" />
    </Icon>
  )
}

export function IconSkipForward(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 12L6 7v10l7-5z" fill="currentColor" stroke="none" />
      <path d="M18 12L11 7v10l7-5z" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M19 6v12" />
    </Icon>
  )
}

export function IconRewind10(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.2-5.7" />
      <path d="M3 6.5v4.2h4.2" />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="7.5"
        fontWeight="700"
        fontFamily="var(--font-body), system-ui, sans-serif"
      >
        10
      </text>
    </Icon>
  )
}

export function IconForward10(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.2-5.7" />
      <path d="M21 6.5v4.2h-4.2" />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="7.5"
        fontWeight="700"
        fontFamily="var(--font-body), system-ui, sans-serif"
      >
        10
      </text>
    </Icon>
  )
}

export function IconVolume(props: IconProps & { level: 'off' | 'low' | 'high' }) {
  const { level, ...rest } = props
  return (
    <Icon {...rest}>
      <path d="M4 10h3.2L12 6.5v11L7.2 14H4v-4z" fill="currentColor" stroke="none" />
      {level === 'off' ? (
        <>
          <path d="M16 10l4 4" />
          <path d="M20 10l-4 4" />
        </>
      ) : (
        <>
          <path d="M15.2 9.2a3.2 3.2 0 0 1 0 5.6" />
          {level === 'high' ? <path d="M17.4 6.8a6.2 6.2 0 0 1 0 10.4" /> : null}
        </>
      )}
    </Icon>
  )
}

export function IconFullscreen(props: IconProps & { exit?: boolean }) {
  const { exit, ...rest } = props
  return (
    <Icon {...rest}>
      {exit ? (
        <>
          <path d="M9 3v6H3" />
          <path d="M15 21v-6h6" />
          <path d="M21 9h-6V3" />
          <path d="M3 15h6v6" />
        </>
      ) : (
        <>
          <path d="M9 3H3v6" />
          <path d="M15 21h6v-6" />
          <path d="M21 9V3h-6" />
          <path d="M3 15v6h6" />
        </>
      )}
    </Icon>
  )
}

export function IconPip(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6" />
    </Icon>
  )
}

export function IconNext(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 7l8 5-8 5V7z" fill="currentColor" stroke="none" />
      <path d="M18 6v12" />
    </Icon>
  )
}

export function IconCaptions(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 14h3.2M12.5 14H17M7 10.5h10" />
    </Icon>
  )
}

export function IconBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  )
}
