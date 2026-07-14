type PixelIconProps = {
  size?: number
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}

function pixelIcon(file: string) {
  function PixelIcon({ size = 16, className = '', ...rest }: PixelIconProps) {
    return (
      <img
        src={`/icons/${file}.png`}
        width={size}
        height={size}
        className={`inline-block shrink-0 object-contain align-middle ${className}`}
        alt=""
        {...rest}
      />
    )
  }
  return PixelIcon
}

export const Building2 = pixelIcon('building')
export const FolderKanban = pixelIcon('folder-badge')
export const FolderPlus = pixelIcon('folder-badge')
export const ListChecks = pixelIcon('checklist-pencil')
export const Clock = pixelIcon('clock')
export const AlarmClock = pixelIcon('clock')
export const BarChart3 = pixelIcon('chart-report-a')
export const Mail = pixelIcon('mail-alert')
export const Calendar = pixelIcon('calendar-grid')
export const CalendarDays = pixelIcon('calendar-11-check')
export const CalendarClock = pixelIcon('calendar-11-dots')
export const Film = pixelIcon('media-camera')
export const Flame = pixelIcon('flame')
export const Rocket = pixelIcon('rocket-a')
export const StickyNote = pixelIcon('notebook-badge')
