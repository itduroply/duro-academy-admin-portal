import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import './DBMSMPerformanceDashboard.css'

// DBM & SM Performance Dashboard (admin view).
// All figures come from the get_admin_dbmsm_* database functions
// (supabase/migrations/20261026000100_create_admin_dbmsm_dashboard_functions.sql). They use the
// same downline rule and MV rows as each manager's own app dashboard, so the numbers match it.

const COLORS = {
  primary: '#E63946',
  primaryDeep: '#B42318',
  success: '#12B76A',
  warning: '#F79009',
  danger: '#D92D20',
  textMain: '#0D1117',
  textMuted: '#667085',
  ratio: '#0891B2',
}

const GRADIENTS = {
  hero: ['#B42318', '#E63946', '#F08175'],
  overall: ['#FFFFFF', '#FFF8F7', '#FFF3F1'],
  sheet: ['#1D4ED8', '#3B82F6', '#60A5FA'],
  dmi: ['#6D28D9', '#8B5CF6', '#A78BFA'],
  behavior: ['#D97706', '#F59E0B', '#FBBF24'],
  ratio: ['#0E7490', '#0891B2', '#22D3EE'],
  success: ['#047857', '#0EA871', '#34D399'],
}

// Sheet Points breakdown rows, in display order, and the sheet breakdown column each reads.
const SHEET_BRAND_COLUMNS = [
  { brandCategory: 'Duro Deco', column: 'duro_deco_sheets' },
  { brandCategory: 'Duro VAP', column: 'duro_vap_sheets' },
  { brandCategory: 'Duro', column: 'duro_sheets' },
  { brandCategory: 'Tower', column: 'tower_sheets' },
  { brandCategory: 'Other', column: 'other_sheets' },
]

// DMI tier rows, in display order. aliases = other spellings tried in dmi_raw_points_master.
const DMI_TIER_COLUMNS = [
  { tier: 'Titanium', column: 'titanium_dmi_count', aliases: [] },
  { tier: 'Gold', column: 'gold_dmi_count', aliases: [] },
  { tier: 'Silver', column: 'silver_dmi_count', aliases: [] },
  { tier: 'Bronze', column: 'bronze_dmi_count', aliases: [] },
  { tier: 'Base Tier', column: 'base_tier_dmi_count', aliases: ['Base'] },
  { tier: 'Unknown', column: 'unknown_tier_dmi_count', aliases: [] },
]

// Behavior parameters per role. Display only: the points always come from behavior_points.
const BEHAVIOR_PARAMS_BY_ROLE = {
  DGO: [
    { label: 'S/G/T Coverage', weightage: 40, achieved: 'sgt_achieved', goal: 'sgt_goal' },
    { label: 'DMI+Site Visits', weightage: 35, achieved: 'dmi_site_achieved', goal: 'dmi_site_goal' },
    { label: 'War Task Completion', weightage: 25, achieved: 'war_completed', goal: 'war_assigned' },
  ],
  ASM: [
    { label: 'S/G/T Coverage', weightage: 30, achieved: 'sgt_achieved', goal: 'sgt_goal' },
    { label: 'War Task Completion', weightage: 30, achieved: 'war_completed', goal: 'war_assigned' },
    { label: 'Buddy Working', weightage: 20, achieved: 'buddy_completed', goal: 'buddy_assigned' },
    { label: 'Team Performance', weightage: 20, achieved: 'team_behavior_points', goal: 'team_behavior_goal' },
  ],
}

const DOT_COLORS = ['#3B82F6', '#F59E0B', '#0EA871', '#F43F5E', '#8B5CF6', '#EC4899', '#14B8A6', '#FB923C']

const TIER_ROW_GRADIENTS = {
  Silver: ['#9EA2A9', '#B5B8BD'],
  Gold: ['#C89B35', '#DDB64F'],
  Titanium: ['#353C4C', '#7A8EA3'],
  Bronze: ['#A96923', '#FAA85F'],
  'Base Tier': ['#F3F4F6', '#E5E7EB'],
}

const GREEN_LIGHT = ['#6EE7B7', '#34D399', '#10B981']
const RATIO_ZONES = [
  { from: 0, to: 62, gradId: 'dbmsmZoneRed', colors: GRADIENTS.hero },
  { from: 62, to: 67, gradId: 'dbmsmZoneGreenLow', colors: GREEN_LIGHT },
  { from: 67, to: 72.5, gradId: 'dbmsmZoneSweetSpot', colors: GRADIENTS.success },
  { from: 72.5, to: 77, gradId: 'dbmsmZoneGreenHigh', colors: GREEN_LIGHT },
  { from: 77, to: 100, gradId: 'dbmsmZoneAmber', colors: GRADIENTS.behavior },
]

const OVERALL_WEIGHTS = { secondaryPrimaryRatio: 50, teamPerformance: 50 }
const HALF_MONTHS = { H1: [4, 5, 6, 7, 8, 9], H2: [10, 11, 12, 1, 2, 3] }
const MONTH_LABELS = { 1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec' }
const TEAM_PAGE_SIZE = 5
const REPORT_BATCH_SIZE = 3

// ===== Pure helpers =====
function getCurrentFYStart() {
  const now = new Date()
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
}

function getCurrentHalf() {
  const month = new Date().getMonth() + 1
  return month >= 4 && month <= 9 ? 'H1' : 'H2'
}

function fyLabel(fyStart) {
  return `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`
}

// Month starts for the RPC filter, e.g. ['2026-04-01', '2026-05-01'].
function toMonthStarts(fyStart, half, selectedMonths) {
  const months = selectedMonths.includes('All') ? HALF_MONTHS[half] : selectedMonths
  return months.map(month => {
    const year = month >= 4 ? fyStart : fyStart + 1
    return `${year}-${String(month).padStart(2, '0')}-01`
  })
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase()
}

function formatCount(value) {
  return Math.round(toNumber(value)).toLocaleString('en-US')
}

function formatPct(value, decimals = 1) {
  return toNumber(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function cappedPct(achieved, goal) {
  return goal > 0 ? Math.min((achieved / goal) * 100, 100) : 0
}

function cssGradient(colors, angle = 90) {
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

// Team View row status, from the row's overall %.
function getStatusMeta(pct) {
  const value = toNumber(pct)
  if (value < 70) return { label: 'Needs attention', color: COLORS.danger, bg: '#FEF3F2' }
  if (value < 100) return { label: 'On track', color: COLORS.warning, bg: '#FFFAEB' }
  return { label: 'Ahead of goal', color: COLORS.success, bg: '#ECFDF3' }
}

// Display only: the band does not change the score.
function getRatioStatus(ratioPct) {
  const value = Math.max(0, Math.min(toNumber(ratioPct), 100))
  if (value >= 67 && value <= 72.5) return { text: 'In Sweet Spot', icon: 'fa-arrow-up', color: '#15803D' }
  if (value < 67) return { text: 'Below Sweet Spot', icon: 'fa-arrow-down', color: '#B42318' }
  return { text: 'Above Sweet Spot', icon: 'fa-arrow-up', color: '#B54708' }
}

function buildRatio(secondaryCount, primaryCount) {
  const ratioPct = primaryCount > 0 ? (secondaryCount / primaryCount) * 100 : 0
  return {
    secondaryCount,
    primaryCount,
    ratioPct: Number(ratioPct.toFixed(1)),
    achievementPct: Number(Math.min(ratioPct, 100).toFixed(1)),
  }
}

function buildOverallPct(ratioAchievementPct, teamPerformancePct) {
  const combined = (ratioAchievementPct * OVERALL_WEIGHTS.secondaryPrimaryRatio / 100) +
    (teamPerformancePct * OVERALL_WEIGHTS.teamPerformance / 100)
  return Number(Math.min(combined, 100).toFixed(1))
}

// Section 7.3: the overview figures for one manager row.
function buildManagerMetrics(row) {
  const secondaryCount = toNumber(row.secondary_count)
  const primaryCount = toNumber(row.primary_count)
  const ratio = buildRatio(secondaryCount, primaryCount)
  const achieved = toNumber(row.sheet_points) + toNumber(row.dmi_points) + toNumber(row.behavior_points)
  const goal = toNumber(row.sheet_goal) + toNumber(row.dmi_goal) + toNumber(row.behavior_goal)
  const teamPerformancePct = goal > 0 ? Number(((achieved / goal) * 100).toFixed(1)) : 0
  return {
    ...row,
    secondaryCount,
    primaryCount,
    ratioPct: ratio.ratioPct,
    ratioAchievementPct: ratio.achievementPct,
    teamAchieved: achieved,
    teamGoal: goal,
    teamPerformancePct,
    overallPct: buildOverallPct(ratio.achievementPct, teamPerformancePct),
  }
}

function buildSheetData(row, pointsRows) {
  const pointsPerSheetByBrand = {}
  ;(pointsRows || []).forEach(p => { pointsPerSheetByBrand[normalizeKey(p.brand_name)] = toNumber(p.points_per_sheet) })
  const brandBreakdown = SHEET_BRAND_COLUMNS.map(({ brandCategory, column }) => {
    const qty = toNumber(row?.[column])
    const pointsPerSheet = pointsPerSheetByBrand[normalizeKey(brandCategory)] || 0
    return { brandCategory, qty, pointsPerSheet, totalPoints: qty * pointsPerSheet }
  })
  return {
    points: brandBreakdown.reduce((sum, brand) => sum + brand.totalPoints, 0),
    goal: toNumber(row?.sheet_goal),
    brandBreakdown,
  }
}

function buildDmiData(row, tierRows) {
  const num = key => toNumber(row?.[key])
  const pointsPerDmiByTier = {}
  ;(tierRows || []).forEach(t => { pointsPerDmiByTier[normalizeKey(t.tier)] = toNumber(t.points_per_dmi) })
  const tierBreakdown = DMI_TIER_COLUMNS
    .map(({ tier, column, aliases }) => {
      const match = [tier, ...aliases].map(normalizeKey).find(key => pointsPerDmiByTier[key] !== undefined)
      return { tier, count: num(column), pointsPerDmi: match ? pointsPerDmiByTier[match] : 0 }
    })
    .filter(t => t.count > 0)
  const finalRawPoints = num('final_raw_points')
  const newDmiPoints = num('new_dmi_points')
  const tierUpgradePoints = num('tier_upgrade_points')
  return {
    achievedPoints: finalRawPoints + newDmiPoints + tierUpgradePoints,
    goal: num('dmi_goal'),
    finalRawPoints,
    newDmiCount: num('new_dmi_count'),
    newDmiPoints,
    tierUpgradeCount: num('tier_upgrade_count'),
    tierUpgradePoints,
    tierBreakdown,
  }
}

function buildBehaviorData(rows) {
  const rowsByRole = {}
  ;(rows || []).forEach(r => { rowsByRole[normalizeKey(r.role)] = r })
  const toPct = (achieved, goal) => {
    if (goal === 0 && achieved === 0) return 100
    if (goal <= 0) return 0
    return Math.min((Math.min(achieved, goal) / goal) * 100, 100)
  }
  const breakdown = []
  let achievedPoints = 0
  let goal = 0
  ;['DGO', 'ASM'].forEach(role => {
    const row = rowsByRole[role]
    if (!row || !(toNumber(row.row_count) > 0)) return
    achievedPoints += toNumber(row.behavior_points)
    goal += toNumber(row.behavior_goal)
    BEHAVIOR_PARAMS_BY_ROLE[role].forEach(param => {
      const achieved = Math.round(toNumber(row[param.achieved]))
      const paramGoal = Math.round(toNumber(row[param.goal]))
      breakdown.push({
        label: `${param.label} (${role})`,
        weightage: param.weightage,
        value: Math.round(toPct(achieved, paramGoal)),
        achieved,
        goal: paramGoal,
      })
    })
  })
  achievedPoints = Math.round(achievedPoints)
  goal = Math.round(goal)
  return { achievedPoints, goal, pct: cappedPct(achievedPoints, goal), breakdown }
}

function buildTeamRows(rows) {
  return (rows || []).map(m => {
    const sheetAchieved = toNumber(m.sheet_points)
    const sheetGoal = toNumber(m.sheet_goal)
    const dmiAchieved = toNumber(m.dmi_points)
    const dmiGoal = toNumber(m.dmi_goal)
    const behaviorAchieved = toNumber(m.behavior_points)
    const behaviorGoal = toNumber(m.behavior_goal)
    const achieved = sheetAchieved + dmiAchieved + behaviorAchieved
    const goal = sheetGoal + dmiGoal + behaviorGoal
    return {
      id: m.user_id,
      name: m.full_name || m.employee_id || 'Team member',
      employeeId: m.employee_id,
      role: m.role,
      pillars: [
        { key: 'sheet', title: 'Sheet Points', icon: 'fa-file-lines', gradient: GRADIENTS.sheet, achieved: sheetAchieved, goal: sheetGoal },
        { key: 'dmi', title: 'DMI Points', icon: 'fa-chart-line', gradient: GRADIENTS.dmi, achieved: dmiAchieved, goal: dmiGoal },
        { key: 'behavior', title: 'Behavior Points', icon: 'fa-users', gradient: GRADIENTS.behavior, achieved: behaviorAchieved, goal: behaviorGoal },
      ],
      overallPct: goal > 0 ? Number(((achieved / goal) * 100).toFixed(1)) : 0,
      pointGap: Math.round(achieved - goal),
    }
  }).sort((a, b) => a.pointGap - b.pointGap)
}

function getInitials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
}

// ===== Small shared components =====
function useAnimatedNumber(target, duration = 1200) {
  const [display, setDisplay] = useState(0)
  const currentRef = useRef(0)

  useEffect(() => {
    const to = toNumber(target)
    const from = currentRef.current
    const start = performance.now()
    let frame
    const step = now => {
      const t = Math.min((now - start) / duration, 1)
      const value = from + (to - from) * easeOutCubic(t)
      currentRef.current = value
      setDisplay(value)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return display
}

function AnimatedCount({ value, decimals = 0, suffix = '', useGrouping = true, className, style }) {
  const display = useAnimatedNumber(value)
  const text = display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping })
  return <span className={className} style={style}>{`${text}${suffix}`}</span>
}

function ProgressBar({ percentage, color, gradientColors, thin = false }) {
  const [width, setWidth] = useState(0)
  const clamped = Math.max(0, Math.min(toNumber(percentage), 100))

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(clamped))
    return () => cancelAnimationFrame(frame)
  }, [clamped])

  return (
    <div className={`dbmsm-bar ${thin ? 'dbmsm-bar-thin' : ''}`}>
      <div
        className="dbmsm-bar-fill"
        style={{ width: `${width}%`, background: gradientColors ? cssGradient(gradientColors) : color }}
      />
    </div>
  )
}

function CircularProgress({ percentage, size = 132, strokeWidth = 11, trackColor = '#FECFD4', progressStart = COLORS.primaryDeep, progressEnd = COLORS.primary }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const animated = useAnimatedNumber(Math.min(toNumber(percentage), 100))
  const dashOffset = circumference - (animated / 100) * circumference

  return (
    <div className="dbmsm-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="dbmsmRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={progressStart} />
            <stop offset="100%" stopColor={progressEnd} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="transparent"
          stroke="url(#dbmsmRingGrad)" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="dbmsm-ring-text">{Math.round(toNumber(percentage))}%</span>
    </div>
  )
}

// Needle runs from 0 up to (value + 1.8) in 1250 ms, then settles on the value in 180 ms.
function useGaugeValue(target) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const to = Math.max(0, Math.min(toNumber(target), 100))
    const peak = Math.min(to + 1.8, 100)
    const start = performance.now()
    let frame
    const step = now => {
      const elapsed = now - start
      if (elapsed < 1250) {
        setValue(peak * easeOutCubic(elapsed / 1250))
      } else if (elapsed < 1430) {
        setValue(peak + (to - peak) * easeOutCubic((elapsed - 1250) / 180))
      } else {
        setValue(to)
        return
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return value
}

function RatioArcGauge({ percentage, size = 320, strokeWidth = 22 }) {
  const outerMargin = strokeWidth * 2.2
  const cx = size / 2
  const cy = size / 2
  const radius = (size - strokeWidth) / 2 - outerMargin
  const needlePct = useGaugeValue(percentage)

  const pointAt = (pct, r) => {
    const theta = (pct / 100) * Math.PI
    return { x: cx - r * Math.cos(theta), y: cy - r * Math.sin(theta) }
  }
  const zoneArcPath = (fromPct, toPct) => {
    const p1 = pointAt(fromPct, radius)
    const p2 = pointAt(toPct, radius)
    return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y}`
  }

  const tickInner = radius + strokeWidth / 2 + 2
  const tickOuter = tickInner + 6
  const fontSize = Math.max(8.5, strokeWidth * 0.64)
  const labelRadius = tickOuter + fontSize * 0.9
  const ticks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(mark => {
    const p1 = pointAt(mark, tickInner)
    const p2 = pointAt(mark, tickOuter)
    const label = pointAt(mark, labelRadius)
    return { mark, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, labelX: label.x, labelY: label.y }
  })

  const marker = pointAt(needlePct, radius)
  const markerR = strokeWidth * 0.58
  const sweetStart = pointAt(67, radius + strokeWidth * 0.45)
  const sweetEnd = pointAt(72.5, radius + strokeWidth * 0.45)
  const sweetTop = pointAt(73.5, radius + strokeWidth + 40)
  const height = cy + strokeWidth / 2

  return (
    <svg className="dbmsm-gauge-svg" width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
      <defs>
        {RATIO_ZONES.map(zone => (
          <linearGradient key={zone.gradId} id={zone.gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={zone.colors[0]} />
            <stop offset="50%" stopColor={zone.colors[1]} />
            <stop offset="100%" stopColor={zone.colors[2]} />
          </linearGradient>
        ))}
        <filter id="dbmsmNeedleShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#0F172A" floodOpacity="0.2" />
        </filter>
      </defs>

      {RATIO_ZONES.map(zone => (
        <path
          key={zone.gradId} d={zoneArcPath(zone.from, zone.to)} fill="none"
          stroke={`url(#${zone.gradId})`} strokeWidth={strokeWidth} strokeLinecap="butt"
        />
      ))}

      <path
        d={`M ${sweetStart.x} ${sweetStart.y} L ${sweetTop.x} ${sweetTop.y} L ${sweetEnd.x} ${sweetEnd.y} Z`}
        fill="rgba(16, 185, 129, 0.11)"
      />
      <line x1={sweetStart.x} y1={sweetStart.y} x2={sweetTop.x} y2={sweetTop.y} stroke="rgba(16, 185, 129, 0.28)" strokeDasharray="3,3" strokeWidth={1} />
      <line x1={sweetEnd.x} y1={sweetEnd.y} x2={sweetTop.x} y2={sweetTop.y} stroke="rgba(16, 185, 129, 0.28)" strokeDasharray="3,3" strokeWidth={1} />
      <text x={sweetTop.x} y={sweetTop.y - 10} fontSize={Math.max(9, strokeWidth * 0.56)} fill="#059669" textAnchor="middle" fontWeight="700">
        Sweet Spot
      </text>

      {ticks.map(({ mark, x1, y1, x2, y2, labelX, labelY }) => {
        const isKeyTick = mark === 0 || mark === 50 || mark === 70 || mark === 100
        return (
          <g key={mark}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isKeyTick ? COLORS.textMuted : 'rgba(102, 112, 133, 0.55)'} strokeWidth={isKeyTick ? 1.7 : 1.2} />
            <text
              x={labelX} y={labelY + fontSize / 3}
              fontSize={isKeyTick ? fontSize + 0.3 : fontSize - 0.2}
              fill={isKeyTick ? COLORS.textMuted : 'rgba(102, 112, 133, 0.68)'}
              textAnchor="middle"
            >
              {mark}
            </text>
          </g>
        )
      })}

      <g filter="url(#dbmsmNeedleShadow)">
        <circle cx={marker.x} cy={marker.y} r={markerR} fill="#FFFFFF" stroke="#0B1530" strokeWidth={2.6} />
      </g>
      <circle cx={marker.x} cy={marker.y} r={markerR * 0.38} fill={COLORS.textMain} />
    </svg>
  )
}

function GradientChip({ icon, colors, small = false }) {
  return (
    <span className={`dbmsm-icon-chip ${small ? 'dbmsm-icon-chip-sm' : ''}`} style={{ background: cssGradient(colors, 135) }}>
      <i className={`fa-solid ${icon}`}></i>
    </span>
  )
}

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dbmsm-overlay" onClick={onClose}>
      <div className="dbmsm-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function PillarCard({ icon, gradientColors, title, percentage, achieved, goal, expanded, onToggle, children, hasBreakdown }) {
  const accent = gradientColors[1]
  const valueColor = value => (toNumber(value) > 0 ? COLORS.textMain : COLORS.danger)

  return (
    <div className="dbmsm-card dbmsm-pillar">
      <div className="dbmsm-accent-bar" style={{ background: accent }} />
      <button type="button" className="dbmsm-pillar-toggle" onClick={onToggle} disabled={!hasBreakdown}>
        <div className="dbmsm-pillar-header">
          <div className="dbmsm-pillar-left">
            <GradientChip icon={icon} colors={gradientColors} />
            <span className="dbmsm-pillar-title">{title}</span>
          </div>
          <AnimatedCount value={percentage} decimals={1} suffix="%" useGrouping={false} className="dbmsm-pillar-pct" style={{ color: accent }} />
        </div>

        <div className="dbmsm-achieved-goal">
          <div>
            <AnimatedCount value={achieved} className="dbmsm-ag-value" style={{ color: valueColor(achieved) }} />
            <span className="dbmsm-ag-label">Achieved</span>
          </div>
          <div className="dbmsm-ag-divider" />
          <div>
            <AnimatedCount value={goal} className="dbmsm-ag-value" />
            <span className="dbmsm-ag-label">Goal</span>
          </div>
        </div>

        <ProgressBar percentage={percentage} gradientColors={gradientColors} />

        {hasBreakdown && (
          <span className="dbmsm-pillar-hint">
            <i className={`fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            {expanded ? 'Hide breakdown' : 'Click for breakdown'}
          </span>
        )}
      </button>

      {expanded && hasBreakdown && <div className="dbmsm-breakdown">{children}</div>}
    </div>
  )
}

// ===== Screen =====
export default function DBMSMPerformanceDashboard() {
  const currentFYStart = getCurrentFYStart()
  const fyOptions = [currentFYStart, currentFYStart - 1]

  const [selectedFYStart, setSelectedFYStart] = useState(currentFYStart)
  const [selectedHalf, setSelectedHalf] = useState(getCurrentHalf())
  const [selectedMonths, setSelectedMonths] = useState(['All'])
  const [fyDialogOpen, setFyDialogOpen] = useState(false)
  const [monthDialogOpen, setMonthDialogOpen] = useState(false)
  const [draftMonths, setDraftMonths] = useState(['All'])

  const [overviewRows, setOverviewRows] = useState([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [branchFilter, setBranchFilter] = useState('All Branches')
  const [roleFilter, setRoleFilter] = useState('All')
  const [sort, setSort] = useState({ key: 'full_name', dir: 'asc' })
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 })
  const [exportError, setExportError] = useState(null)

  const [pointMasters, setPointMasters] = useState({ sheet: [], dmi: [] })
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [expandedPillar, setExpandedPillar] = useState(null)
  const [ratioInfoOpen, setRatioInfoOpen] = useState(false)

  const [teamOpen, setTeamOpen] = useState(false)
  const [teamRows, setTeamRows] = useState([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamPage, setTeamPage] = useState(1)
  const [expandedMemberId, setExpandedMemberId] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  const overviewRequestRef = useRef(0)

  const monthStarts = useMemo(
    () => toMonthStarts(selectedFYStart, selectedHalf, selectedMonths),
    [selectedFYStart, selectedHalf, selectedMonths]
  )
  const monthsKey = monthStarts.join(',')

  const monthsChipLabel = selectedMonths.includes('All')
    ? 'All Months'
    : selectedMonths.length === 1 ? '1 Month' : `${selectedMonths.length} Months`

  // ----- Overview: one row per DBM and SM -----
  useEffect(() => {
    const requestId = ++overviewRequestRef.current
    const run = async () => {
      setOverviewLoading(true)
      setOverviewError(null)
      const [overviewRes, refreshedRes] = await Promise.all([
        supabase.rpc('get_admin_dbmsm_overview', { p_months: monthStarts }),
        supabase.rpc('get_admin_dbmsm_mv_refreshed_at'),
      ])
      if (requestId !== overviewRequestRef.current) return
      if (overviewRes.error) {
        setOverviewError(overviewRes.error.message)
      } else {
        setOverviewRows((overviewRes.data || []).map(buildManagerMetrics))
      }
      setRefreshedAt(refreshedRes.error ? null : refreshedRes.data)
      setOverviewLoading(false)
    }
    run()
    // monthsKey stands in for monthStarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey, reloadToken])

  // ----- Point masters: loaded once -----
  useEffect(() => {
    Promise.all([
      supabase.from('sheet_point_master').select('brand_name, points_per_sheet'),
      supabase.from('dmi_raw_points_master').select('tier, points_per_dmi'),
    ]).then(([sheetRes, dmiRes]) => {
      setPointMasters({ sheet: sheetRes.data || [], dmi: dmiRes.data || [] })
    })
  }, [])

  // Close the pop-up if the open manager is no longer in the list after a reload.
  useEffect(() => {
    if (overviewLoading || !selectedManagerId) return
    if (!overviewRows.some(row => row.manager_user_id === selectedManagerId)) setSelectedManagerId('')
  }, [overviewRows, overviewLoading, selectedManagerId])

  // Escape closes the pop-up, unless the ratio guide is open on top of it.
  useEffect(() => {
    if (!selectedManagerId || ratioInfoOpen) return
    const onKey = event => { if (event.key === 'Escape') setSelectedManagerId('') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedManagerId, ratioInfoOpen])

  // ----- Drill-down: Sheet, DMI and Behavior breakdowns for the selected manager -----
  useEffect(() => {
    if (!selectedManagerId) return
    let cancelled = false
    const run = async () => {
      setDetailLoading(true)
      setDetailError(null)
      const params = { p_manager_id: selectedManagerId, p_months: monthStarts }
      const [sheetRes, dmiRes, behaviorRes] = await Promise.all([
        supabase.rpc('get_admin_dbmsm_sheet_breakdown', params),
        supabase.rpc('get_admin_dbmsm_dmi_breakdown', params),
        supabase.rpc('get_admin_dbmsm_behavior_breakdown', params),
      ])
      if (cancelled) return
      const firstError = [sheetRes, dmiRes, behaviorRes].find(res => res.error)
      if (firstError) {
        setDetailError(firstError.error.message)
        setDetailLoading(false)
        return
      }
      setDetail({
        managerId: selectedManagerId,
        sheetRow: (Array.isArray(sheetRes.data) ? sheetRes.data[0] : sheetRes.data) || {},
        dmiRow: (Array.isArray(dmiRes.data) ? dmiRes.data[0] : dmiRes.data) || {},
        behaviorRows: behaviorRes.data || [],
      })
      setDetailLoading(false)
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManagerId, monthsKey, reloadToken])

  // ----- Team View: loads the first time the list is opened -----
  useEffect(() => {
    if (!teamOpen || !selectedManagerId) return
    let cancelled = false
    const run = async () => {
      setTeamLoading(true)
      const { data, error } = await supabase.rpc('get_admin_dbmsm_team_members', {
        p_manager_id: selectedManagerId,
        p_months: monthStarts,
      })
      if (cancelled) return
      setTeamRows(error ? [] : buildTeamRows(data))
      setTeamLoading(false)
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamOpen, selectedManagerId, monthsKey, reloadToken])

  useEffect(() => {
    setTeamRows([])
    setTeamPage(1)
    setExpandedMemberId(null)
    setExpandedPillar(null)
  }, [selectedManagerId])

  // ----- Derived figures -----
  const selectedManager = useMemo(
    () => overviewRows.find(row => row.manager_user_id === selectedManagerId) || null,
    [overviewRows, selectedManagerId]
  )

  const sheetData = useMemo(() => (detail ? buildSheetData(detail.sheetRow, pointMasters.sheet) : null), [detail, pointMasters.sheet])
  const dmiData = useMemo(() => (detail ? buildDmiData(detail.dmiRow, pointMasters.dmi) : null), [detail, pointMasters.dmi])
  const behaviorData = useMemo(() => (detail ? buildBehaviorData(detail.behaviorRows) : null), [detail])

  const ratioData = useMemo(() => {
    if (!selectedManager) return null
    const ratio = buildRatio(selectedManager.secondaryCount, selectedManager.primaryCount)
    return { ...ratio, dataAvailable: ratio.secondaryCount > 0 || ratio.primaryCount > 0 }
  }, [selectedManager])

  const teamTotals = useMemo(() => {
    const achieved = toNumber(sheetData?.points) + toNumber(dmiData?.achievedPoints) + toNumber(behaviorData?.achievedPoints)
    const goal = toNumber(sheetData?.goal) + toNumber(dmiData?.goal) + toNumber(behaviorData?.goal)
    return { achieved, goal, pct: goal > 0 ? Number(((achieved / goal) * 100).toFixed(1)) : 0 }
  }, [sheetData, dmiData, behaviorData])

  const overallPct = buildOverallPct(toNumber(ratioData?.achievementPct), teamTotals.pct)
  const sheetPct = cappedPct(toNumber(sheetData?.points), toNumber(sheetData?.goal))
  const dmiPct = cappedPct(toNumber(dmiData?.achievedPoints), toNumber(dmiData?.goal))
  const behaviorPct = toNumber(behaviorData?.pct)

  const branchOptions = useMemo(() => {
    const names = [...new Set(overviewRows.map(row => String(row.branch_name || '').trim()).filter(Boolean))]
    return ['All Branches', ...names.sort((a, b) => a.localeCompare(b))]
  }, [overviewRows])

  const visibleRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = overviewRows.filter(row => {
      const matchesSearch = !query ||
        String(row.full_name || '').toLowerCase().includes(query) ||
        String(row.employee_id || '').toLowerCase().includes(query)
      const matchesBranch = branchFilter === 'All Branches' || String(row.branch_name || '').trim() === branchFilter
      const matchesRole = roleFilter === 'All' || row.role === roleFilter
      return matchesSearch && matchesBranch && matchesRole
    })
    const direction = sort.dir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      const left = a[sort.key]
      const right = b[sort.key]
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction
      return String(left || '').localeCompare(String(right || '')) * direction
    })
  }, [overviewRows, searchTerm, branchFilter, roleFilter, sort])

  const totalTeamPages = Math.max(1, Math.ceil(teamRows.length / TEAM_PAGE_SIZE))
  const pagedTeamRows = teamRows.slice((teamPage - 1) * TEAM_PAGE_SIZE, teamPage * TEAM_PAGE_SIZE)

  // ----- Handlers -----
  const selectHalf = half => {
    setSelectedHalf(half)
    setSelectedMonths(['All'])
  }

  const openMonthDialog = () => {
    setDraftMonths(selectedMonths)
    setMonthDialogOpen(true)
  }

  const toggleDraftMonth = month => {
    if (month === 'All') {
      setDraftMonths(['All'])
      return
    }
    setDraftMonths(previous => {
      const base = previous.includes('All') ? [] : previous
      const next = base.includes(month) ? base.filter(m => m !== month) : [...base, month]
      if (next.length === 0 || next.length === HALF_MONTHS[selectedHalf].length) return ['All']
      return HALF_MONTHS[selectedHalf].filter(m => next.includes(m))
    })
  }

  const closeFyDialog = useCallback(() => setFyDialogOpen(false), [])
  const closeMonthDialog = useCallback(() => setMonthDialogOpen(false), [])
  const closeRatioInfo = useCallback(() => setRatioInfoOpen(false), [])

  const selectManager = id => setSelectedManagerId(id)
  const closeManager = () => setSelectedManagerId('')

  const toggleSort = key => {
    setSort(previous => (previous.key === key
      ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: typeof overviewRows[0]?.[key] === 'number' ? 'desc' : 'asc' }))
  }

  // Full report for every DBM and SM (filters on the list are ignored), for the selected period.
  // One workbook: Overview, Sheet Points, DMI Points, Behavior, Team Members.
  const downloadReport = async () => {
    const managers = [...overviewRows].sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
    if (managers.length === 0) return
    setExporting(true)
    setExportProgress({ done: 0, total: managers.length })
    setExportError(null)

    try {
      const details = new Array(managers.length)
      let done = 0
      const fetchOne = async index => {
        const params = { p_manager_id: managers[index].manager_user_id, p_months: monthStarts }
        const [sheetRes, dmiRes, behaviorRes, teamRes] = await Promise.all([
          supabase.rpc('get_admin_dbmsm_sheet_breakdown', params),
          supabase.rpc('get_admin_dbmsm_dmi_breakdown', params),
          supabase.rpc('get_admin_dbmsm_behavior_breakdown', params),
          supabase.rpc('get_admin_dbmsm_team_members', params),
        ])
        const failed = [sheetRes, dmiRes, behaviorRes, teamRes].find(res => res.error)
        if (failed) throw new Error(`${managers[index].full_name}: ${failed.error.message}`)
        details[index] = {
          sheet: buildSheetData((Array.isArray(sheetRes.data) ? sheetRes.data[0] : sheetRes.data) || {}, pointMasters.sheet),
          dmi: buildDmiData((Array.isArray(dmiRes.data) ? dmiRes.data[0] : dmiRes.data) || {}, pointMasters.dmi),
          behavior: buildBehaviorData(behaviorRes.data || []),
          team: buildTeamRows(teamRes.data || []),
        }
        done += 1
        setExportProgress({ done, total: managers.length })
      }
      for (let start = 0; start < managers.length; start += REPORT_BATCH_SIZE) {
        const batch = []
        for (let index = start; index < Math.min(start + REPORT_BATCH_SIZE, managers.length); index += 1) batch.push(fetchOne(index))
        await Promise.all(batch)
      }

      const round1 = value => Number(toNumber(value).toFixed(1))
      const managerColumns = row => ({
        'Employee ID': row.employee_id,
        Name: row.full_name,
        Role: row.role,
        Branch: row.branch_name || '',
      })

      const overviewSheet = managers.map((row, index) => {
        const { sheet, dmi, behavior } = details[index]
        const achieved = sheet.points + dmi.achievedPoints + behavior.achievedPoints
        const goal = sheet.goal + dmi.goal + behavior.goal
        const teamPct = goal > 0 ? (achieved / goal) * 100 : 0
        return {
          ...managerColumns(row),
          'Direct Reportees': toNumber(row.member_count),
          'Primary Count': Math.round(row.primaryCount),
          'Secondary Count': Math.round(row.secondaryCount),
          'Sec/Pri Ratio %': row.ratioPct,
          'Ratio Achievement %': row.ratioAchievementPct,
          'Sheet Points': round1(sheet.points),
          'Sheet Goal': round1(sheet.goal),
          'DMI Points': round1(dmi.achievedPoints),
          'DMI Goal': round1(dmi.goal),
          'Behavior Points': round1(behavior.achievedPoints),
          'Behavior Goal': round1(behavior.goal),
          'Team Achieved Points': round1(achieved),
          'Team Goal Points': round1(goal),
          'Team Performance %': round1(teamPct),
          'Overall %': buildOverallPct(row.ratioAchievementPct, Number(teamPct.toFixed(1))),
        }
      })

      const sheetPointsSheet = managers.map((row, index) => {
        const { sheet } = details[index]
        const brandColumns = {}
        sheet.brandBreakdown.forEach(brand => {
          brandColumns[`${brand.brandCategory} Sheets`] = Math.round(brand.qty)
          brandColumns[`${brand.brandCategory} Points`] = round1(brand.totalPoints)
        })
        return {
          ...managerColumns(row),
          ...brandColumns,
          'Total Sheets': Math.round(sheet.brandBreakdown.reduce((sum, brand) => sum + brand.qty, 0)),
          'Sheet Points': round1(sheet.points),
          'Sheet Goal': round1(sheet.goal),
          'Sheet %': round1(cappedPct(sheet.points, sheet.goal)),
        }
      })

      const dmiSheet = managers.map((row, index) => {
        const { dmi } = details[index]
        const tierColumns = {}
        DMI_TIER_COLUMNS.forEach(({ tier }) => {
          tierColumns[`${tier} DMIs`] = Math.round(dmi.tierBreakdown.find(item => item.tier === tier)?.count || 0)
        })
        return {
          ...managerColumns(row),
          ...tierColumns,
          'Final Raw Points': round1(dmi.finalRawPoints),
          'New DMI Count': Math.round(dmi.newDmiCount),
          'New DMI Points': round1(dmi.newDmiPoints),
          'Tier Upgrade Count': Math.round(dmi.tierUpgradeCount),
          'Tier Upgrade Points': round1(dmi.tierUpgradePoints),
          'DMI Points': round1(dmi.achievedPoints),
          'DMI Goal': round1(dmi.goal),
          'DMI %': round1(cappedPct(dmi.achievedPoints, dmi.goal)),
        }
      })

      const behaviorSheet = managers.flatMap((row, index) => details[index].behavior.breakdown.map(item => ({
        ...managerColumns(row),
        Parameter: item.label,
        'Weight %': item.weightage,
        Achieved: item.achieved,
        Goal: item.goal,
        '%': item.value,
      })))

      const teamSheet = managers.flatMap((row, index) => details[index].team.map(member => {
        const [sheetPillar, dmiPillar, behaviorPillar] = member.pillars
        return {
          'Manager ID': row.employee_id,
          'Manager Name': row.full_name,
          'Member ID': member.employeeId,
          'Member Name': member.name,
          'Member Role': member.role,
          'Sheet Points': round1(sheetPillar.achieved),
          'Sheet Goal': round1(sheetPillar.goal),
          'DMI Points': round1(dmiPillar.achieved),
          'DMI Goal': round1(dmiPillar.goal),
          'Behavior Points': round1(behaviorPillar.achieved),
          'Behavior Goal': round1(behaviorPillar.goal),
          'Overall %': member.overallPct,
          'Point Gap': member.pointGap,
          Status: getStatusMeta(member.overallPct).label,
        }
      }))

      const workbook = XLSX.utils.book_new()
      const addSheet = (rows, name) => {
        const worksheet = XLSX.utils.json_to_sheet(rows)
        const headers = Object.keys(rows[0] || {})
        worksheet['!cols'] = headers.map(header => ({
          wch: Math.max(header.length, ...rows.map(item => String(item[header] ?? '').length)) + 2,
        }))
        XLSX.utils.book_append_sheet(workbook, worksheet, name)
      }
      addSheet(overviewSheet, 'Overview')
      addSheet(sheetPointsSheet, 'Sheet Points')
      addSheet(dmiSheet, 'DMI Points')
      addSheet(behaviorSheet, 'Behavior')
      addSheet(teamSheet, 'Team Members')

      const monthsLabel = selectedMonths.includes('All')
        ? 'AllMonths'
        : selectedMonths.map(month => MONTH_LABELS[month]).join('-')
      XLSX.writeFile(workbook, `DBM_SM_Report_${fyLabel(selectedFYStart).replace(' ', '')}_${selectedHalf}_${monthsLabel}.xlsx`)
    } catch (error) {
      setExportError(error.message)
    } finally {
      setExporting(false)
    }
  }

  const sortIcon = key => {
    if (sort.key !== key) return 'fa-sort'
    return sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'
  }

  const columns = [
    { key: 'full_name', label: 'Manager' },
    { key: 'role', label: 'Role' },
    { key: 'branch_name', label: 'Branch' },
    { key: 'member_count', label: 'Reportees', numeric: true },
    { key: 'primaryCount', label: 'Primary', numeric: true },
    { key: 'secondaryCount', label: 'Secondary', numeric: true },
    { key: 'ratioPct', label: 'Sec/Pri %', numeric: true },
    { key: 'teamPerformancePct', label: 'Team Perf. %', numeric: true },
    { key: 'overallPct', label: 'Overall %', numeric: true },
  ]

  const ratioStatus = getRatioStatus(ratioData?.ratioPct)
  const detailReady = detail && detail.managerId === selectedManagerId
  const firstLoad = overviewLoading && overviewRows.length === 0

  return (
    <main className="dbmsm-main">
      {/* Header bar */}
      <section className="dbmsm-header">
        <div>
          <h2>DBM &amp; SM Dashboard</h2>
          <p>Team Performance Overview</p>
        </div>
        <div className="dbmsm-header-actions">
          {refreshedAt && (
            <span className="dbmsm-refreshed">
              <i className="fa-regular fa-clock"></i>
              Data as of {new Date(refreshedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
          <button type="button" className="dbmsm-fy-chip" onClick={() => setFyDialogOpen(true)}>
            {fyLabel(selectedFYStart)}
            <i className="fa-solid fa-chevron-down"></i>
          </button>
          <button type="button" className="dbmsm-btn" onClick={() => setReloadToken(token => token + 1)} disabled={overviewLoading}>
            <i className={`fa-solid fa-rotate-right ${overviewLoading ? 'fa-spin' : ''}`}></i>
            Refresh
          </button>
          <button
            type="button" className="dbmsm-btn dbmsm-btn-primary" onClick={downloadReport}
            disabled={exporting || overviewLoading || overviewRows.length === 0}
            title="Excel report for all DBM and SM users in the selected period"
          >
            <i className={`fa-solid ${exporting ? 'fa-spinner fa-spin' : 'fa-file-arrow-down'}`}></i>
            {exporting ? `Preparing ${exportProgress.done} / ${exportProgress.total}` : 'Download Report'}
          </button>
        </div>
      </section>

      {exportError && (
        <div className="dbmsm-notice dbmsm-notice-error">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>Could not prepare the report: {exportError}</span>
        </div>
      )}

      {/* Filter bar */}
      <section className="dbmsm-filter-bar">
        {['H1', 'H2'].map(half => (
          <button
            key={half} type="button"
            className={`dbmsm-chip ${selectedHalf === half ? 'dbmsm-chip-active' : ''}`}
            onClick={() => selectHalf(half)}
          >
            {half}
          </button>
        ))}
        <button type="button" className="dbmsm-chip" onClick={openMonthDialog}>
          <i className="fa-regular fa-calendar"></i>
          {monthsChipLabel}
          <i className="fa-solid fa-chevron-down"></i>
        </button>
      </section>

      {firstLoad ? (
        <div className="dbmsm-page-loading">
          <i className="fa-solid fa-spinner fa-spin"></i>
          <span>Loading team data...</span>
        </div>
      ) : overviewError && overviewRows.length === 0 ? (
        <div className="dbmsm-notice dbmsm-notice-error">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>Could not load DBM &amp; SM data: {overviewError}</span>
        </div>
      ) : (
        <>
          {/* Manager overview */}
          <section className="dbmsm-card dbmsm-overview">
            <div className="dbmsm-overview-toolbar">
              <div className="dbmsm-search">
                <i className="fa-solid fa-search"></i>
                <input
                  type="text" value={searchTerm} placeholder="Search name or employee ID"
                  onChange={event => setSearchTerm(event.target.value)}
                />
              </div>
              <select value={branchFilter} onChange={event => setBranchFilter(event.target.value)}>
                {branchOptions.map(branch => <option key={branch} value={branch}>{branch}</option>)}
              </select>
              <div className="dbmsm-segment">
                {['All', 'DBM', 'SM'].map(option => (
                  <button
                    key={option} type="button"
                    className={roleFilter === option ? 'active' : ''}
                    onClick={() => setRoleFilter(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <span className="dbmsm-overview-count">{visibleRows.length} of {overviewRows.length} managers</span>
            </div>

            {overviewError && (
              <div className="dbmsm-notice dbmsm-notice-error">
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>Could not refresh: {overviewError}. Showing the last loaded figures.</span>
              </div>
            )}

            {overviewLoading && (
              <div className="dbmsm-inline-loading">
                <i className="fa-solid fa-spinner fa-spin"></i>
                <span>Refreshing team totals…</span>
              </div>
            )}

            <div className="dbmsm-table-wrap">
              <table className="dbmsm-table">
                <thead>
                  <tr>
                    {columns.map(column => (
                      <th key={column.key} className={column.numeric ? 'num' : ''}>
                        <button type="button" onClick={() => toggleSort(column.key)}>
                          {column.label}
                          <i className={`fa-solid ${sortIcon(column.key)}`}></i>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr><td colSpan={columns.length} className="dbmsm-table-empty">No DBM or SM users match these filters.</td></tr>
                  ) : visibleRows.map(row => {
                    const status = getStatusMeta(row.overallPct)
                    return (
                      <tr
                        key={row.manager_user_id}
                        className={row.manager_user_id === selectedManagerId ? 'selected' : ''}
                        onClick={() => selectManager(row.manager_user_id)}
                      >
                        <td>
                          <span className="dbmsm-cell-name">{row.full_name}</span>
                          <span className="dbmsm-cell-sub">{row.employee_id}</span>
                        </td>
                        <td><span className={`dbmsm-role-badge dbmsm-role-${String(row.role).toLowerCase()}`}>{row.role}</span></td>
                        <td>{row.branch_name || '—'}</td>
                        <td className="num">{formatCount(row.member_count)}</td>
                        <td className="num">{formatCount(row.primaryCount)}</td>
                        <td className="num">{formatCount(row.secondaryCount)}</td>
                        <td className="num">{formatPct(row.ratioPct)}%</td>
                        <td className="num">{formatPct(row.teamPerformancePct)}%</td>
                        <td className="num">
                          <span className="dbmsm-overall-pill" style={{ color: status.color, background: status.bg }}>
                            {formatPct(row.overallPct)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Selected manager drill-down, in a pop-up */}
          {selectedManager && (
            <div className="dbmsm-overlay dbmsm-detail-overlay" onClick={closeManager}>
            <section
              className="dbmsm-detail dbmsm-detail-modal" role="dialog" aria-modal="true"
              aria-label={`${selectedManager.full_name} performance`}
              onClick={event => event.stopPropagation()}
            >
              <div className="dbmsm-detail-title">
                <div>
                  <h3>{selectedManager.full_name}</h3>
                  <p>
                    {selectedManager.employee_id} · {selectedManager.role}
                    {selectedManager.branch_name ? ` · ${selectedManager.branch_name}` : ''}
                    {` · ${formatCount(selectedManager.member_count)} direct reportees`}
                  </p>
                  <p className="dbmsm-detail-period">
                    {fyLabel(selectedFYStart)} · {selectedHalf} · {monthsChipLabel}
                  </p>
                </div>
                <div className="dbmsm-detail-actions">
                  {detailLoading && detailReady && (
                    <div className="dbmsm-inline-loading">
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Refreshing team totals…</span>
                    </div>
                  )}
                  <button type="button" className="dbmsm-close-btn" onClick={closeManager} aria-label="Close">
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>

              {detailError ? (
                <div className="dbmsm-notice dbmsm-notice-error">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>Could not load this manager&apos;s breakdown: {detailError}</span>
                </div>
              ) : !detailReady ? (
                <div className="dbmsm-page-loading dbmsm-detail-loading">
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>Loading team data...</span>
                </div>
              ) : (
                <>
                  <div className="dbmsm-top-grid">
                    {/* Overall Achievement */}
                    <div className="dbmsm-card dbmsm-overall-card" style={{ background: cssGradient(GRADIENTS.overall, 180) }}>
                      <div className="dbmsm-overall-head">
                        <span className="dbmsm-card-title">Overall Achievement</span>
                        <span className="dbmsm-pct-pill">{formatPct(overallPct)}%</span>
                      </div>
                      <p className="dbmsm-card-sub">Weighted mix of Team Performance and Sec/Pri Ratio</p>
                      <div className="dbmsm-overall-ring">
                        <CircularProgress percentage={overallPct} size={104} strokeWidth={9} />
                      </div>
                      <div className="dbmsm-goal-row">
                        <div><strong>100%</strong><span>Goal</span></div>
                        <div><strong>{formatPct(overallPct)}%</strong><span>Achieved</span></div>
                      </div>
                      <div className="dbmsm-overall-breakdown">
                        <div>
                          <strong>{formatPct(ratioData?.achievementPct)}%</strong>
                          <span>Secondary/Primary Ratio</span>
                          <em>Wt {OVERALL_WEIGHTS.secondaryPrimaryRatio}%</em>
                        </div>
                        <div>
                          <strong>{formatPct(teamTotals.pct)}%</strong>
                          <span>Team Performance</span>
                          <em>Wt {OVERALL_WEIGHTS.teamPerformance}%</em>
                        </div>
                      </div>
                    </div>

                    {/* Secondary / Primary Ratio */}
                    <div className="dbmsm-card dbmsm-ratio-card">
                      <div className="dbmsm-accent-bar" style={{ background: COLORS.ratio }} />
                      <div className="dbmsm-ratio-head">
                        <GradientChip icon="fa-right-left" colors={GRADIENTS.ratio} />
                        <span className="dbmsm-card-title">Secondary / Primary Ratio</span>
                        <button type="button" className="dbmsm-info-btn" onClick={() => setRatioInfoOpen(true)} aria-label="Sec/Pri Ratio Guide">
                          <i className="fa-solid fa-circle-info"></i>
                        </button>
                      </div>
                      <p className="dbmsm-card-sub">Balance between secondary and primary sales</p>

                      {!ratioData?.dataAvailable ? (
                        <div className="dbmsm-notice">
                          <i className="fa-solid fa-triangle-exclamation"></i>
                          <span>
                            {overviewLoading
                              ? 'Loading Secondary/Primary Ratio for your team...'
                              : 'No data available for Secondary/Primary Ratio in the selected period.'}
                          </span>
                        </div>
                      ) : (
                        <div className="dbmsm-gauge">
                          <div className="dbmsm-gauge-wrap">
                            <RatioArcGauge percentage={ratioData.ratioPct} size={260} strokeWidth={18} />
                            <div className="dbmsm-gauge-center">
                              <strong>{Math.round(ratioData.ratioPct)}%</strong>
                              <span>Sec : Pri</span>
                            </div>
                          </div>
                          <span className="dbmsm-ratio-status" style={{ color: ratioStatus.color }}>
                            <i className={`fa-solid ${ratioStatus.icon}`}></i>
                            {ratioStatus.text}
                          </span>
                          <span className="dbmsm-ratio-target">Target Range: 67% - 72.5%</span>
                        </div>
                      )}

                      <div className="dbmsm-count-row">
                        <div>
                          <span>Primary Count</span>
                          <strong>{formatCount(ratioData?.primaryCount)}</strong>
                        </div>
                        <div>
                          <span>Secondary Count</span>
                          <strong>{formatCount(ratioData?.secondaryCount)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Team Performance */}
                  <button type="button" className="dbmsm-section-header" onClick={() => setTeamOpen(open => !open)}>
                    <span>Team Performance</span>
                    <span className="dbmsm-section-meta">
                      {formatPct(teamTotals.pct)}% Overall
                      <i className={`fa-solid ${teamOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                    </span>
                  </button>

                  <div className="dbmsm-card dbmsm-team-summary">
                    <div className="dbmsm-team-top">
                      <AnimatedCount value={teamTotals.pct} decimals={1} suffix="%" useGrouping={false} className="dbmsm-team-big" />
                      <span className="dbmsm-team-pts">{formatCount(teamTotals.achieved)} / {formatCount(teamTotals.goal)} pts</span>
                    </div>
                    <div className="dbmsm-divider" />
                    <div className="dbmsm-mini-row">
                      {[
                        { label: 'Sheets', pct: sheetPct, color: GRADIENTS.sheet[1] },
                        { label: 'DMI', pct: dmiPct, color: GRADIENTS.dmi[1] },
                        { label: 'Behavior', pct: behaviorPct, color: GRADIENTS.behavior[0] },
                      ].map(item => (
                        <div key={item.label}>
                          <span className="dbmsm-mini-label">{item.label}</span>
                          <span className="dbmsm-mini-pct">{Math.round(item.pct)}%</span>
                          <ProgressBar percentage={item.pct} color={item.color} thin />
                        </div>
                      ))}
                    </div>
                    <button type="button" className="dbmsm-team-cta" onClick={() => setTeamOpen(open => !open)}>
                      {teamOpen ? 'Hide Team View' : 'Click for Team View'}
                      <i className={`fa-solid ${teamOpen ? 'fa-chevron-up' : 'fa-chevron-right'}`}></i>
                    </button>
                  </div>

                  {teamOpen && (
                    <div className="dbmsm-card dbmsm-team-list">
                      {teamLoading && teamRows.length === 0 ? (
                        <div className="dbmsm-inline-loading">
                          <i className="fa-solid fa-spinner fa-spin"></i>
                          <span>Loading team members…</span>
                        </div>
                      ) : teamRows.length === 0 ? (
                        <p className="dbmsm-empty">No direct reportees with a DGO, ASM or SM dashboard.</p>
                      ) : (
                        <>
                          <div className="dbmsm-team-hint">
                            <i className="fa-solid fa-sort"></i>
                            Team members · By point gap
                            {teamLoading && <i className="fa-solid fa-spinner fa-spin"></i>}
                          </div>
                          {pagedTeamRows.map(member => {
                            const status = getStatusMeta(member.overallPct)
                            const isOpen = expandedMemberId === member.id
                            return (
                              <div key={member.id} className="dbmsm-team-row-wrap">
                                <button
                                  type="button" className="dbmsm-team-row"
                                  onClick={() => setExpandedMemberId(isOpen ? null : member.id)}
                                >
                                  <span className="dbmsm-avatar" style={{ color: status.color, background: status.bg }}>
                                    {getInitials(member.name)}
                                  </span>
                                  <span className="dbmsm-team-main">
                                    <span className="dbmsm-team-name">
                                      {member.name}
                                      <em>{member.employeeId} · {member.role}</em>
                                    </span>
                                    <ProgressBar percentage={member.overallPct} color={status.color} thin />
                                    <span className="dbmsm-team-status" style={{ color: status.color }}>
                                      {Math.round(member.overallPct)}% · {status.label}
                                    </span>
                                  </span>
                                  <span className="dbmsm-team-gap" style={{ color: status.color }}>
                                    {member.pointGap > 0 ? '+' : ''}{member.pointGap.toLocaleString('en-US')}
                                    <em>pts</em>
                                  </span>
                                  <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} dbmsm-team-chevron`}></i>
                                </button>

                                {isOpen && (
                                  <div className="dbmsm-member-panel">
                                    {member.pillars.map(pillar => {
                                      const pct = cappedPct(pillar.achieved, pillar.goal)
                                      return (
                                        <div key={pillar.key} className="dbmsm-member-pillar">
                                          <div className="dbmsm-accent-bar" style={{ background: pillar.gradient[1] }} />
                                          <div className="dbmsm-member-pillar-head">
                                            <GradientChip icon={pillar.icon} colors={pillar.gradient} small />
                                            <span>{pillar.title}</span>
                                          </div>
                                          <strong style={{ color: pillar.gradient[1] }}>{formatPct(pct)}%</strong>
                                          <div className="dbmsm-achieved-goal dbmsm-achieved-goal-sm">
                                            <div><span className="dbmsm-ag-value">{formatCount(pillar.achieved)}</span><span className="dbmsm-ag-label">Achieved</span></div>
                                            <div className="dbmsm-ag-divider" />
                                            <div><span className="dbmsm-ag-value">{formatCount(pillar.goal)}</span><span className="dbmsm-ag-label">Goal</span></div>
                                          </div>
                                          <ProgressBar percentage={pct} gradientColors={pillar.gradient} thin />
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {totalTeamPages > 1 && (
                            <div className="dbmsm-pagination">
                              <button type="button" disabled={teamPage === 1} onClick={() => setTeamPage(page => page - 1)}>Prev</button>
                              <span>{teamPage} / {totalTeamPages}</span>
                              <button type="button" disabled={teamPage === totalTeamPages} onClick={() => setTeamPage(page => page + 1)}>Next</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Pillar cards */}
                  <div className="dbmsm-pillar-grid">
                    <PillarCard
                      icon="fa-file-lines" gradientColors={GRADIENTS.sheet} title="Sheet Points"
                      percentage={sheetPct} achieved={sheetData.points} goal={sheetData.goal}
                      expanded={expandedPillar === 'sheet'}
                      onToggle={() => setExpandedPillar(current => (current === 'sheet' ? null : 'sheet'))}
                      hasBreakdown={sheetData.brandBreakdown.length > 0}
                    >
                      <h4>Brand Breakdown</h4>
                      <table className="dbmsm-mini-table">
                        <thead><tr><th>Brand</th><th>Sheets</th><th>Mult.</th><th>Points</th></tr></thead>
                        <tbody>
                          {sheetData.brandBreakdown.map(brand => (
                            <tr key={brand.brandCategory}>
                              <td>{brand.brandCategory}</td>
                              <td className={brand.qty > 0 ? '' : 'zero'}>{formatCount(brand.qty)}</td>
                              <td>{brand.pointsPerSheet.toLocaleString('en-US')}</td>
                              <td className={brand.totalPoints > 0 ? '' : 'zero'}>{formatCount(brand.totalPoints)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </PillarCard>

                    <PillarCard
                      icon="fa-chart-line" gradientColors={GRADIENTS.dmi} title="DMI Points"
                      percentage={dmiPct} achieved={dmiData.achievedPoints} goal={dmiData.goal}
                      expanded={expandedPillar === 'dmi'}
                      onToggle={() => setExpandedPillar(current => (current === 'dmi' ? null : 'dmi'))}
                      hasBreakdown
                    >
                      <h4>Active DMI Breakdown</h4>
                      {dmiData.tierBreakdown.length > 0 && (
                        <table className="dbmsm-mini-table">
                          <thead><tr><th>Tier</th><th>Count</th><th>Mult.</th><th>Points</th></tr></thead>
                          <tbody>
                            {dmiData.tierBreakdown.map(tier => (
                              <tr
                                key={tier.tier}
                                className={tier.tier === 'Titanium' ? 'tier-dark' : ''}
                                style={{ background: cssGradient(TIER_ROW_GRADIENTS[tier.tier] || TIER_ROW_GRADIENTS['Base Tier']) }}
                              >
                                <td>{tier.tier}</td>
                                <td>{formatCount(tier.count)}</td>
                                <td>{tier.pointsPerDmi.toLocaleString('en-US')}</td>
                                <td>{formatCount(tier.count * tier.pointsPerDmi)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="dbmsm-extra">
                        <div><span>Final Raw Points</span><strong className={dmiData.finalRawPoints > 0 ? '' : 'zero'}>{formatCount(dmiData.finalRawPoints)}</strong></div>
                        <div><span>New DMI Points ({formatCount(dmiData.newDmiCount)} x 10)</span><strong className={dmiData.newDmiPoints > 0 ? '' : 'zero'}>{formatCount(dmiData.newDmiPoints)}</strong></div>
                        <div><span>Tier Upgraded Points ({formatCount(dmiData.tierUpgradeCount)} x 25)</span><strong className={dmiData.tierUpgradePoints > 0 ? '' : 'zero'}>{formatCount(dmiData.tierUpgradePoints)}</strong></div>
                      </div>
                    </PillarCard>

                    <PillarCard
                      icon="fa-users" gradientColors={GRADIENTS.behavior} title="Behavior Points"
                      percentage={behaviorPct} achieved={behaviorData.achievedPoints} goal={behaviorData.goal}
                      expanded={expandedPillar === 'behavior'}
                      onToggle={() => setExpandedPillar(current => (current === 'behavior' ? null : 'behavior'))}
                      hasBreakdown={behaviorData.breakdown.length > 0}
                    >
                      <h4>Behavior Breakdown</h4>
                      {behaviorData.breakdown.map((item, index) => {
                        const dotColor = DOT_COLORS[index % DOT_COLORS.length]
                        return (
                          <div key={item.label} className="dbmsm-behavior-row">
                            <div className="dbmsm-behavior-top">
                              <span><i className="dbmsm-dot" style={{ background: dotColor }}></i>{item.label}</span>
                              <span className="dbmsm-behavior-wt">Wt: {item.weightage}%</span>
                            </div>
                            <ProgressBar percentage={item.value} color={dotColor} thin />
                            <div className="dbmsm-behavior-foot">
                              <span>Achieved: <strong className={item.achieved > 0 ? '' : 'zero'}>{formatCount(item.achieved)}</strong></span>
                              <span>Goal: <strong>{formatCount(item.goal)}</strong></span>
                            </div>
                          </div>
                        )
                      })}
                    </PillarCard>
                  </div>
                </>
              )}
            </section>
            </div>
          )}
        </>
      )}

      {fyDialogOpen && (
        <Dialog title="Select Financial Year" onClose={closeFyDialog}>
          <div className="dbmsm-dialog-options">
            {fyOptions.map(fyStart => (
              <button
                key={fyStart} type="button"
                className={`dbmsm-dialog-option ${selectedFYStart === fyStart ? 'active' : ''}`}
                onClick={() => { setSelectedFYStart(fyStart); setFyDialogOpen(false) }}
              >
                {fyLabel(fyStart)}
                {selectedFYStart === fyStart && <i className="fa-solid fa-check"></i>}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {monthDialogOpen && (
        <Dialog title="Select Months" onClose={closeMonthDialog}>
          <div className="dbmsm-month-grid">
            {['All', ...HALF_MONTHS[selectedHalf]].map(month => {
              const active = month === 'All' ? draftMonths.includes('All') : draftMonths.includes(month)
              return (
                <button
                  key={month} type="button"
                  className={`dbmsm-chip ${active ? 'dbmsm-chip-active' : ''}`}
                  onClick={() => toggleDraftMonth(month)}
                >
                  {month === 'All' ? 'All' : MONTH_LABELS[month]}
                </button>
              )
            })}
          </div>
          <button
            type="button" className="dbmsm-done-btn"
            onClick={() => { setSelectedMonths(draftMonths); setMonthDialogOpen(false) }}
          >
            Done
          </button>
        </Dialog>
      )}

      {ratioInfoOpen && (
        <Dialog title="Sec/Pri Ratio Guide" onClose={closeRatioInfo}>
          <ul className="dbmsm-guide">
            <li>Target: 67% - 72.5%</li>
            <li>Below 67%: overstocking risk</li>
            <li>Above 77%: understocking risk</li>
          </ul>
          <button type="button" className="dbmsm-done-btn" onClick={closeRatioInfo}>OK</button>
        </Dialog>
      )}
    </main>
  )
}
