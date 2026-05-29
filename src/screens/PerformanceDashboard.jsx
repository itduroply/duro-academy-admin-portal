import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { cachedFetch, TTL } from '../utils/cacheDB'
import './PerformanceDashboard.css'

const QUARTER_MONTHS = {
  Q1: [4, 5, 6],
  Q2: [7, 8, 9],
  Q3: [10, 11, 12],
  Q4: [1, 2, 3],
}

const MONTH_LABELS = {
  1: 'Jan',
  2: 'Feb',
  3: 'Mar',
  4: 'Apr',
  5: 'May',
  6: 'Jun',
  7: 'Jul',
  8: 'Aug',
  9: 'Sep',
  10: 'Oct',
  11: 'Nov',
  12: 'Dec',
}

function getQuarterFactor(month) {
  if ([4, 5, 6].includes(month)) return 0.9
  if ([1, 2, 3].includes(month)) return 1.1
  return 1
}

function getCurrentFYStart() {
  const now = new Date()
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
}

async function fetchPaged(getQuery) {
  const PAGE = 1000
  let from = 0
  let all = []
  while (true) {
    const { data, error } = await getQuery(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseDateSafe(v) {
  if (!v) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  const s = String(v).trim()
  if (!s) return null

  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmy) {
    const dd = Number(dmy[1])
    const mm = Number(dmy[2])
    const yyyy = Number(dmy[3])
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const dt = new Date(yyyy, mm - 1, dd)
      return Number.isNaN(dt.getTime()) ? null : dt
    }
  }

  const dt = new Date(s)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function monthYearKey(month, year) {
  return `${year}-${month}`
}

function monthYearIndex(month, year) {
  return (year * 12) + month
}

function buildDateWindow(pairs) {
  if (!pairs || pairs.length === 0) return { startDate: null, endDateExclusive: null }
  const sorted = [...pairs].sort((a, b) => (a.year - b.year) || (a.month - b.month))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const startDate = `${first.year}-${String(first.month).padStart(2, '0')}-01`

  const nextMonth = last.month === 12 ? 1 : last.month + 1
  const nextMonthYear = last.month === 12 ? last.year + 1 : last.year
  const endDateExclusive = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`

  return { startDate, endDateExclusive }
}

function buildTwoFyMonthKeySet(fyStart) {
  const keys = new Set()
  const start = new Date(fyStart - 1, 3, 1) // Apr of previous FY
  const endExclusive = new Date(fyStart + 1, 3, 1) // Apr after current FY
  const cur = new Date(start)

  while (cur < endExclusive) {
    keys.add(monthYearKey(cur.getMonth() + 1, cur.getFullYear()))
    cur.setMonth(cur.getMonth() + 1)
  }
  return keys
}

function normalizeStatus(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export default function PerformanceDashboard() {
  const mountedRef = useRef(true)

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const [selectedUserId, setSelectedUserId] = useState('')

  const currentFYStart = getCurrentFYStart()
  const fyOptions = [
    { label: `FY ${currentFYStart}-${String(currentFYStart + 1).slice(-2)}`, start: currentFYStart },
    { label: `FY ${currentFYStart - 1}-${String(currentFYStart).slice(-2)}`, start: currentFYStart - 1 },
  ]

  const [selectedFYStart, setSelectedFYStart] = useState(currentFYStart)
  const [selectedQuarters, setSelectedQuarters] = useState(['All'])
  const [selectedMonths, setSelectedMonths] = useState(['All'])

  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [fromCache, setFromCache] = useState(false)

  const selectedUser = useMemo(
    () => users.find(u => u.id === selectedUserId) || null,
    [users, selectedUserId]
  )

  const availableMonths = useMemo(() => {
    if (selectedQuarters.includes('All')) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    return [...new Set(selectedQuarters.flatMap(q => QUARTER_MONTHS[q] || []))].sort((a, b) => a - b)
  }, [selectedQuarters])

  const monthYearPairs = useMemo(() => {
    const months = selectedMonths.includes('All') ? availableMonths : selectedMonths.map(Number)
    return months.map(month => ({
      month,
      year: month >= 4 ? selectedFYStart : selectedFYStart + 1,
    }))
  }, [selectedFYStart, availableMonths, selectedMonths])

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => {
      const name = (u.full_name || '').toLowerCase()
      const email = (u.email || '').toLowerCase()
      const emp = (u.employee_id || '').toLowerCase()
      return name.includes(q) || email.includes(q) || emp.includes(q)
    })
  }, [users, searchTerm])

  const loadUsers = useCallback(async () => {
    try {
      setUsersLoading(true)
      setUsersError(null)
      const { data } = await cachedFetch(
        'perf_dashboard_all_users',
        async () => {
          const { data, error } = await supabase    
            .from('users')
            .select('id, full_name, email, employee_id, department_id')
            .order('full_name', { ascending: true })
          if (error) throw error
          return data || []
        },
        TTL.SHORT
      )
      if (!mountedRef.current) return
      setUsers(Array.isArray(data) ? data : [])
      if (!selectedUserId && data && data.length > 0) {
        setSelectedUserId(data[0].id)
      }
    } catch (err) {
      if (mountedRef.current) setUsersError(err.message)
    } finally {
      if (mountedRef.current) setUsersLoading(false)
    }
  }, [selectedUserId])

  const computePerformance = useCallback(async (employeeId, pairs, fyStart) => {
    const sortedPairs = [...pairs].sort((a, b) => (a.year - b.year) || (a.month - b.month))
    const selectedPairKeySet = new Set(sortedPairs.map(p => monthYearKey(p.month, p.year)))
    const { startDate, endDateExclusive } = buildDateWindow(sortedPairs)
    const twoFyMonthKeySet = buildTwoFyMonthKeySet(fyStart)
    const twoFyStartDate = `${fyStart - 1}-04-01`
    const twoFyEndExclusive = `${fyStart + 1}-04-01`

    const pairMatch = (dateStr) => {
      const d = parseDateSafe(dateStr)
      if (!d) return false
      return selectedPairKeySet.has(monthYearKey(d.getMonth() + 1, d.getFullYear()))
    }

    // Sheet points
    const claimDateClaims = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('influencer_claim_details')
            .select('claimed_qty_sheets, claim_date')
            .eq('mapped_isr_code', employeeId)
            .gte('claim_date', startDate)
            .lt('claim_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const statusDateClaims = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('influencer_claim_details')
            .select('account_number, approved_qty, product_code, status_date')
            .eq('mapped_isr_code', employeeId)
            .gte('status_date', startDate)
            .lt('status_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const filteredClaimDateClaims = claimDateClaims.filter(c => pairMatch(c.claim_date))
    const filteredStatusDateClaims = statusDateClaims.filter(c => pairMatch(c.status_date))

    const { data: goalRow } = await supabase
      .from('goals_master')
      .select('monthly_sheet_goal')
      .eq('employee_code', employeeId)
      .maybeSingle()

    const monthlyGoal = toNumber(goalRow?.monthly_sheet_goal)
    const sheetGoal = sortedPairs.reduce((sum, pair) => sum + (monthlyGoal * getQuarterFactor(pair.month)), 0)

    const dmiGoal = sortedPairs.reduce((sum, pair) => {
      const spg = monthlyGoal * getQuarterFactor(pair.month)
      const a = spg / 55
      const b = Math.round(a)
      const c = b > 8 ? b : 8
      return sum + (c * 40)
    }, 0)

    const totalClaimedSheets = filteredClaimDateClaims.reduce((sum, c) => sum + toNumber(c.claimed_qty_sheets), 0)
    const totalApprovedSheets = filteredStatusDateClaims.reduce((sum, c) => sum + toNumber(c.approved_qty), 0)

    const productQtyMap = {}
    filteredStatusDateClaims.forEach(c => {
      if (!c.product_code) return
      productQtyMap[c.product_code] = (productQtyMap[c.product_code] || 0) + toNumber(c.approved_qty)
    })

    const uniqueProductCodes = Object.keys(productQtyMap)
    const { data: brandMaster } = uniqueProductCodes.length
      ? await supabase
          .from('brand_category_master')
          .select('brand_name, brand_category')
          .in('brand_name', uniqueProductCodes)
      : { data: [] }

    const productToCategoryMap = {}
    ;(brandMaster || []).forEach(b => {
      productToCategoryMap[b.brand_name] = b.brand_category
    })

    const categoryQtyMap = {}
    Object.entries(productQtyMap).forEach(([productCode, qty]) => {
      const category = productToCategoryMap[productCode] || 'Other'
      categoryQtyMap[category] = (categoryQtyMap[category] || 0) + qty
    })

    const categoryNames = Object.keys(categoryQtyMap)
    const { data: pointsMaster } = categoryNames.length
      ? await supabase
          .from('sheet_point_master')
          .select('brand_name, points_per_sheet')
          .in('brand_name', categoryNames)
      : { data: [] }

    const categoryPointsMap = {}
    ;(pointsMaster || []).forEach(p => {
      categoryPointsMap[p.brand_name] = toNumber(p.points_per_sheet)
    })

    let sheetPoints = 0
    const brandBreakdown = Object.entries(categoryQtyMap).map(([category, qty]) => {
      const pps = categoryPointsMap[category] || 0
      const totalPoints = qty * pps
      sheetPoints += totalPoints
      return {
        brandCategory: category,
        qty,
        pointsPerSheet: pps,
        totalPoints,
      }
    })

    const brandOrder = ['Duro Deco', 'Duro VAP', 'Duro', 'Tower']
    brandBreakdown.sort((a, b) => {
      const ia = brandOrder.indexOf(a.brandCategory)
      const ib = brandOrder.indexOf(b.brandCategory)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.brandCategory.localeCompare(b.brandCategory)
    })

    const sheetData = {
      achieved: totalApprovedSheets,
      claimed: totalClaimedSheets,
      approvedSummary: totalApprovedSheets,
      points: sheetPoints,
      goal: sheetGoal,
      baseMonthlyGoal: monthlyGoal,
      brandBreakdown,
    }

    // DMI points: claims for selected period + 2-FY history
    const dmiHistoryClaims = await fetchPaged((from, to) =>
      supabase
        .from('influencer_claim_details')
        .select('account_number, approved_qty, status_date')
        .eq('mapped_isr_code', employeeId)
        .gte('status_date', twoFyStartDate)
        .lt('status_date', twoFyEndExclusive)
        .range(from, to)
    )

    const approvedSheetsByAccountMonth = {}
    dmiHistoryClaims.forEach(c => {
      if (!c.account_number) return
      const d = parseDateSafe(c.status_date)
      if (!d) return
      const key = monthYearKey(d.getMonth() + 1, d.getFullYear())
      if (!twoFyMonthKeySet.has(key)) return

      const account = String(c.account_number).trim()
      if (!account) return
      if (!approvedSheetsByAccountMonth[account]) approvedSheetsByAccountMonth[account] = {}
      approvedSheetsByAccountMonth[account][key] = (approvedSheetsByAccountMonth[account][key] || 0) + toNumber(c.approved_qty)
    })

    const selectedActiveCandidates = []
    const newDmiSet = new Set()
    const activeDmiSet = new Set()

    sortedPairs.forEach(pair => {
      const selectedKey = monthYearKey(pair.month, pair.year)
      const selectedIdx = monthYearIndex(pair.month, pair.year)

      Object.entries(approvedSheetsByAccountMonth).forEach(([account, monthMap]) => {
        const thisMonthSheets = toNumber(monthMap[selectedKey])
        if (thisMonthSheets < 10) return

        const hasPriorActive = Object.entries(monthMap).some(([mk, qty]) => {
          if (toNumber(qty) < 10 || !twoFyMonthKeySet.has(mk)) return false
          const [y, m] = mk.split('-').map(Number)
          return monthYearIndex(m, y) < selectedIdx
        })

        if (hasPriorActive) {
          activeDmiSet.add(account)
          selectedActiveCandidates.push({ account, month: pair.month, year: pair.year })
        } else {
          newDmiSet.add(account)
        }
      })
    })

    const selectedStatusByAccountMonth = {}
    filteredStatusDateClaims.forEach(c => {
      if (!c.account_number) return
      const d = parseDateSafe(c.status_date)
      if (!d) return
      const mk = monthYearKey(d.getMonth() + 1, d.getFullYear())
      if (!selectedPairKeySet.has(mk)) return

      const account = String(c.account_number).trim()
      if (!account) return
      if (!selectedStatusByAccountMonth[account]) selectedStatusByAccountMonth[account] = {}
      selectedStatusByAccountMonth[account][mk] = (selectedStatusByAccountMonth[account][mk] || 0) + toNumber(c.approved_qty)
    })

    const activeAccounts = [...activeDmiSet]
    const claimedDmiCount = new Set(
      filteredStatusDateClaims
        .map(e => String(e.account_number || '').trim())
        .filter(Boolean)
    ).size

    let mEnrollmentRows = []
    if (activeAccounts.length > 0) {
      mEnrollmentRows = await fetchPaged((from, to) =>
        supabase
          .from('m_enrollment_details')
          .select('account_no, tier, created_at')
          .ilike('mapped_isr', `${employeeId}%`)
          .in('account_no', activeAccounts)
          .gte('created_at', twoFyStartDate)
          .lt('created_at', twoFyEndExclusive)
          .range(from, to)
      )
    }

    const primaryTierByAccountMonth = new Map()
    mEnrollmentRows.forEach(r => {
      const account = String(r.account_no || '').trim()
      const tier = String(r.tier || '').trim()
      const d = parseDateSafe(r.created_at)
      if (!account || !tier || !d) return
      const mk = monthYearKey(d.getMonth() + 1, d.getFullYear())
      const key = `${account}__${mk}`
      const ts = d.getTime()
      const prev = primaryTierByAccountMonth.get(key)
      if (!prev || ts > prev.ts) primaryTierByAccountMonth.set(key, { tier, ts })
    })

    let fallbackRows = []
    if (activeAccounts.length > 0) {
      const CHUNK = 200
      for (let i = 0; i < activeAccounts.length; i += CHUNK) {
        const chunk = activeAccounts.slice(i, i + CHUNK)
        const chunkRows = await fetchPaged((from, to) =>
          supabase
            .from('influencer_enrollment_details')
            .select('influencer_id, influencer_tier, enrollment_date')
            .in('influencer_id', chunk)
            .range(from, to)
        )
        fallbackRows = fallbackRows.concat(chunkRows)
      }
    }

    const fallbackTierByAccount = new Map()
    fallbackRows.forEach(r => {
      const account = String(r.influencer_id || '').trim()
      const tier = String(r.influencer_tier || '').trim()
      if (!account || !tier) return
      const d = parseDateSafe(r.enrollment_date)
      const ts = d ? d.getTime() : -1
      const prev = fallbackTierByAccount.get(account)
      if (!prev || ts > prev.ts) fallbackTierByAccount.set(account, { tier, ts })
    })

    const resolvedActiveByAccount = new Map()
    selectedActiveCandidates.forEach(entry => {
      const mk = monthYearKey(entry.month, entry.year)
      const idx = monthYearIndex(entry.month, entry.year)
      const primary = primaryTierByAccountMonth.get(`${entry.account}__${mk}`)?.tier || null
      const fallback = fallbackTierByAccount.get(entry.account)?.tier || null
      const tier = primary || fallback || 'Base'
      const source = primary ? 'primary' : (fallback ? 'fallback' : 'unknown')
      const prev = resolvedActiveByAccount.get(entry.account)
      if (!prev || idx >= prev.idx) {
        resolvedActiveByAccount.set(entry.account, { tier, source, idx })
      }
    })

    const activePrimaryAccounts = [...resolvedActiveByAccount.entries()]
      .filter(([, v]) => v.source === 'primary')
      .map(([account]) => account)

    const allKnownTiers = ['Titanium', 'Gold', 'Silver', 'Bronze', 'Base']
    const uniqueTiers = [...new Set([
      ...allKnownTiers,
      ...[...resolvedActiveByAccount.values()].map(v => v.tier).filter(Boolean),
    ])]

    const { data: tierPoints } = uniqueTiers.length
      ? await supabase
          .from('dmi_raw_points_master')
          .select('tier, points_per_dmi')
          .in('tier', uniqueTiers)
      : { data: [] }

    const tierPointsMap = {}
    ;(tierPoints || []).forEach(tp => {
      tierPointsMap[String(tp.tier || '').trim()] = toNumber(tp.points_per_dmi)
    })

    const tierCountMap = {}
    activePrimaryAccounts.forEach(account => {
      const tier = resolvedActiveByAccount.get(account)?.tier || 'Base'
      if (!tierCountMap[tier]) tierCountMap[tier] = 0
      tierCountMap[tier] += 1
    })

    let totalRawPoints = 0
    Object.entries(tierCountMap).forEach(([tier, count]) => {
      totalRawPoints += toNumber(count) * toNumber(tierPointsMap[tier])
    })

    const activeDmiCount = activePrimaryAccounts.length
    const sheetsByUniqueActiveDmis = activePrimaryAccounts.reduce((sum, account) => {
      const monthMap = selectedStatusByAccountMonth[account] || {}
      return sum + Object.values(monthMap).reduce((s, v) => s + toNumber(v), 0)
    }, 0)
    const averageSheetsPerDmi = activeDmiCount > 0 ? (sheetsByUniqueActiveDmis / activeDmiCount) : 0

    let rawPointsMultiplier = 1
    if (averageSheetsPerDmi < 15) rawPointsMultiplier = 0.15
    else if (averageSheetsPerDmi < 40) rawPointsMultiplier = 0.5

    const finalRawPoints = Math.round(totalRawPoints * rawPointsMultiplier)

    const newDmiCount = newDmiSet.size
    const newEnrolledPoints = newDmiCount * 10

    const tierUpgradeRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('tier_upgrade_performance_report')
            .select('mapped_isr, change_type, previous_tier, tier_change_date')
            .ilike('mapped_isr', `${employeeId}%`)
            .gte('tier_change_date', startDate)
            .lt('tier_change_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const qualifyingUpgrades = tierUpgradeRows.filter(r =>
      pairMatch(r.tier_change_date) &&
      String(r.change_type || '').trim() === 'Tier Upgrade' &&
      ['Bronze', 'Gold', 'Silver'].includes(String(r.previous_tier || '').trim())
    )

    const tierUpgradedDmiCount = qualifyingUpgrades.length
    const dmiUpdatePoints = tierUpgradedDmiCount * 25

    const tierOrder = ['Titanium', 'Gold', 'Silver', 'Bronze', 'Base']
    const tierBreakdown = Object.entries(tierCountMap)
      .map(([tier, count]) => ({
        tier,
        activeDmiCount: count,
        pointsPerDmi: toNumber(tierPointsMap[tier]),
      }))
      .sort((a, b) => {
        const ia = tierOrder.indexOf(a.tier)
        const ib = tierOrder.indexOf(b.tier)
        if (ia !== -1 && ib !== -1) return ia - ib
        if (ia !== -1) return -1
        if (ib !== -1) return 1
        return a.tier.localeCompare(b.tier)
      })

    const dmiData = {
      achievedPoints: finalRawPoints + newEnrolledPoints + dmiUpdatePoints,
      finalRawPoints,
      newEnrolledPoints,
      dmiUpdatePoints,
      claimedDmiCount,
      activeDmiCount,
      newDmiCount,
      tierUpgradedDmiCount,
      averageSheetsPerDmi,
      rawPointsMultiplier,
      tierBreakdown,
    }

    // S/G/T Coverage
    const enrollmentRows = await fetchPaged((from, to) =>
      supabase
        .from('m_enrollment_details')
        .select('account_no, tier')
        .ilike('mapped_isr', `${employeeId}%`)
        .in('tier', ['Silver', 'Gold', 'Titanium'])
        .range(from, to)
    )

    const uniqueTierByAccount = {}
    enrollmentRows.forEach(r => {
      if (r.account_no && !uniqueTierByAccount[r.account_no]) uniqueTierByAccount[r.account_no] = r.tier
    })

    let monthlyVisitGoal = 0
    const tierMonthlyGoalMap = { Silver: 0, Gold: 0, Titanium: 0 }
    Object.values(uniqueTierByAccount).forEach(tier => {
      if (tier === 'Silver') {
        monthlyVisitGoal += 1
        tierMonthlyGoalMap.Silver += 1
      } else if (tier === 'Gold' || tier === 'Titanium') {
        monthlyVisitGoal += 2
        tierMonthlyGoalMap[tier] += 2
      }
    })

    const sgtGoal = monthlyVisitGoal * sortedPairs.length

    const sgtVisits = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('influencer_visit_reports')
            .select('influencer_code, visit_date, influencer_tier')
            .eq('mapped_isr_code', employeeId)
            .in('influencer_tier', ['Silver', 'Gold', 'Titanium'])
            .gte('visit_date', startDate)
            .lt('visit_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const uniqueDayVisitMap = new Map()
    sgtVisits.filter(v => pairMatch(v.visit_date)).forEach(v => {
      if (!v.influencer_code || !v.visit_date) return
      const d = parseDateSafe(v.visit_date)
      if (!d) return
      const key = `${v.influencer_code}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`
      if (!uniqueDayVisitMap.has(key)) uniqueDayVisitMap.set(key, v)
    })

    const monthlyVisitCounts = {}
    Array.from(uniqueDayVisitMap.values()).forEach(v => {
      const d = parseDateSafe(v.visit_date)
      if (!d) return
      const mk = `${v.influencer_code}_${d.getMonth() + 1}_${d.getFullYear()}`
      if (!monthlyVisitCounts[mk]) monthlyVisitCounts[mk] = { count: 0, tier: v.influencer_tier }
      monthlyVisitCounts[mk].count += 1
    })

    let sgtAchieved = 0
    const tierAchievedMap = { Silver: 0, Gold: 0, Titanium: 0 }
    Object.values(monthlyVisitCounts).forEach(({ count, tier }) => {
      const cap = tier === 'Silver' ? 1 : 2
      const capped = Math.min(count, cap)
      sgtAchieved += capped
      if (tierAchievedMap[tier] !== undefined) tierAchievedMap[tier] += capped
    })

    const sgtData = {
      visitGoal: sgtGoal,
      achievedVisits: sgtAchieved,
      sgtTierBreakdown: ['Silver', 'Gold', 'Titanium'].map(tier => ({
        tier,
        achievedVisits: tierAchievedMap[tier] || 0,
        goalVisits: (tierMonthlyGoalMap[tier] || 0) * sortedPairs.length,
      })),
    }

    // War Task Completion
    const warRows = await fetchPaged((from, to) =>
      supabase
        .from('telecalling_influencer_wartask')
        .select('task_date, status_as_on_today, status_change_date')
        .eq('mapped_isr_code', employeeId)
        .range(from, to)
    )

    const warFiltered = warRows.filter(r => pairMatch(r.task_date))
    const isClosureWithinAllowedWindow = (taskDateStr, statusDateStr) => {
      const taskDate = parseDateSafe(taskDateStr)
      const statusDate = parseDateSafe(statusDateStr)
      if (!taskDate || !statusDate) return false

      const taskMonthStart = new Date(taskDate.getFullYear(), taskDate.getMonth(), 1, 0, 0, 0, 0)
      const nextMonth7End = new Date(taskDate.getFullYear(), taskDate.getMonth() + 1, 7, 23, 59, 59, 999)
      return statusDate >= taskMonthStart && statusDate <= nextMonth7End
    }

    const warTaskData = {
      assigned: warFiltered.length,
      completed: warFiltered.filter(r =>
        normalizeStatus(r.status_as_on_today) === 'closure' &&
        isClosureWithinAllowedWindow(r.task_date, r.status_change_date)
      ).length,
    }

    // DMI + Site Visits
    const attendanceRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('monthly_attendance_report')
            .select('attendance_date, attendance_status')
            .eq('employee_code', employeeId)
            .gte('attendance_date', startDate)
            .lt('attendance_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const filteredAttendance = attendanceRows.filter(r => pairMatch(r.attendance_date))
    const workingDays = filteredAttendance.filter(r => {
      const s = String(r.attendance_status || '').trim()
      return s === 'P | P' || s === '- | -'
    }).length
    const dmiSiteGoal = workingDays * 10

    const existingDmiVisitRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('influencer_visit_reports')
            .select('influencer_code, visit_date')
            .eq('emp_login', employeeId)
            .gte('visit_date', startDate)
            .lt('visit_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const existingDmiVisitSet = new Set()
    existingDmiVisitRows.filter(v => pairMatch(v.visit_date)).forEach(v => {
      if (!v.influencer_code || !v.visit_date) return
      const d = parseDateSafe(v.visit_date)
      if (!d) return
      existingDmiVisitSet.add(`${v.influencer_code}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`)
    })

    const newDmiVisitRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('influencer_enrollment_details')
            .select('influencer_id, enrollment_date')
            .eq('enrolled_by_dso_code', employeeId)
            .gte('enrollment_date', startDate)
            .lt('enrollment_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const newDmiVisitSet = new Set()
    newDmiVisitRows.filter(v => pairMatch(v.enrollment_date)).forEach(v => {
      if (!v.influencer_id || !v.enrollment_date) return
      const d = parseDateSafe(v.enrollment_date)
      if (!d) return
      newDmiVisitSet.add(`${v.influencer_id}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`)
    })

    const leadDetailRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('lead_details_reports')
            .select('lead_created_by, created_date, lead_code')
            .ilike('lead_created_by', `${employeeId}%`)
            .gte('created_date', startDate)
            .lt('created_date', endDateExclusive)
            .range(from, to)
        )
      : []

    const newSiteSet = new Set()
    leadDetailRows.filter(v => pairMatch(v.created_date)).forEach(v => {
      if (!v.lead_code || !v.created_date) return
      const d = parseDateSafe(v.created_date)
      if (!d) return
      newSiteSet.add(`${v.lead_code}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`)
    })

    const leadTaskRows = (startDate && endDateExclusive)
      ? await fetchPaged((from, to) =>
          supabase
            .from('lead_task_reports')
            .select('id, task_created_on, lead_id')
            .eq('task_created_by_dso_code', employeeId)
            .gte('task_created_on', startDate)
            .lt('task_created_on', endDateExclusive)
            .range(from, to)
        )
      : []

    const existingSiteSet = new Set()
    leadTaskRows.filter(v => pairMatch(v.task_created_on)).forEach((v, idx) => {
      const d = parseDateSafe(v.task_created_on)
      if (!d) return

      if (v.lead_id) {
        existingSiteSet.add(`${v.lead_id}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`)
      } else {
        const rowToken = v.id || `row_${idx}`
        existingSiteSet.add(`nulllead_${rowToken}_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`)
      }
    })

    const existingDmiVisits = existingDmiVisitSet.size
    const newDmiVisits = newDmiVisitSet.size
    const dmiVisits = existingDmiVisits + newDmiVisits
    const newSiteVisits = newSiteSet.size
    const existingSiteVisits = existingSiteSet.size
    const siteVisits = newSiteVisits + existingSiteVisits

    const dmiSiteData = {
      visitGoal: dmiSiteGoal,
      achievedVisits: dmiVisits + siteVisits,
      dmiVisits,
      newDmiVisits,
      existingDmiVisits,
      siteVisits,
      newSiteVisits,
      existingSiteVisits,
    }

    // Behavior
    const behaviorGoal = Math.round(
      sortedPairs.reduce((sum, pair) => {
        const adjustedMonthlySheetGoal = monthlyGoal * getQuarterFactor(pair.month)
        const quarterlyEquivalentGoal = adjustedMonthlySheetGoal * 3
        const monthlyBehaviorGoal = quarterlyEquivalentGoal > 1800 ? adjustedMonthlySheetGoal * 0.2 : 120
        return sum + monthlyBehaviorGoal
      }, 0)
    )

    const sgtAchievedCapped = sgtData.visitGoal > 0 ? Math.min(sgtData.achievedVisits, sgtData.visitGoal) : 0
    const sgtPct = sgtData.visitGoal === 0 && sgtData.achievedVisits === 0
      ? 100
      : sgtData.visitGoal > 0
        ? Math.min((sgtAchievedCapped / sgtData.visitGoal) * 100, 100)
        : 0

    const dmiSiteAchievedCapped = dmiSiteData.visitGoal > 0 ? Math.min(dmiSiteData.achievedVisits, dmiSiteData.visitGoal) : 0
    const dmiSitePct = dmiSiteData.visitGoal === 0 && dmiSiteData.achievedVisits === 0
      ? 100
      : dmiSiteData.visitGoal > 0
        ? Math.min((dmiSiteAchievedCapped / dmiSiteData.visitGoal) * 100, 100)
        : 0

    const warCompletedCapped = warTaskData.assigned > 0 ? Math.min(warTaskData.completed, warTaskData.assigned) : 0
    const warPct = warTaskData.assigned === 0 && warTaskData.completed === 0
      ? 100
      : warTaskData.assigned > 0
        ? Math.min((warCompletedCapped / warTaskData.assigned) * 100, 100)
        : 0

    const behaviorCompletion = Math.min((sgtPct * 40 / 100) + (dmiSitePct * 35 / 100) + (warPct * 25 / 100), 100)
    const behaviorPoints = behaviorGoal > 0 ? Math.min(Math.round((behaviorCompletion / 100) * behaviorGoal), behaviorGoal) : 0

    const behaviorData = {
      achievedPoints: behaviorPoints,
      goal: behaviorGoal,
      completionPercentage: Number(behaviorCompletion.toFixed(1)),
      breakdown: [
        {
          label: 'S/G/T Coverage',
          weightage: 40,
          value: Math.round(sgtPct),
          visitGoal: sgtData.visitGoal,
          achievedVisits: sgtAchievedCapped,
          sgtTierBreakdown: sgtData.sgtTierBreakdown,
        },
        {
          label: 'DMI+Site Visits',
          weightage: 35,
          value: Math.round(dmiSitePct),
          visitGoal: dmiSiteData.visitGoal,
          achievedVisits: dmiSiteAchievedCapped,
          dmiVisits: dmiSiteData.dmiVisits,
          siteVisits: dmiSiteData.siteVisits,
          newSiteVisits: dmiSiteData.newSiteVisits,
          existingSiteVisits: dmiSiteData.existingSiteVisits,
        },
        {
          label: 'War Task Completion',
          weightage: 25,
          value: Math.round(warPct),
          assigned: warTaskData.assigned,
          completed: warCompletedCapped,
        },
      ],
    }

    const totalAchieved = toNumber(sheetData.points) + toNumber(dmiData.achievedPoints) + toNumber(behaviorData.achievedPoints)
    const totalGoal = toNumber(sheetData.goal) + toNumber(dmiGoal) + toNumber(behaviorData.goal)
    const totalPct = totalGoal > 0 ? Number(((totalAchieved / totalGoal) * 100).toFixed(1)) : 0

    return {
      employeeId,
      generatedAt: new Date().toISOString(),
      sheetData,
      dmiGoal,
      dmiData,
      behaviorData,
      totals: {
        achievedPoints: totalAchieved,
        goalPoints: totalGoal,
        percentage: totalPct,
      },
    }
  }, [])

  const loadDetail = useCallback(async (forceRefresh = false) => {
    if (!selectedUser?.employee_id) {
      setDetailData(null)
      return
    }

    try {
      setDetailLoading(true)
      setDetailError(null)

      const quarterKey = selectedQuarters.includes('All')
        ? 'all'
        : [...selectedQuarters].sort().join('-')
      const monthKey = selectedMonths.includes('All')
        ? 'all'
        : [...selectedMonths].sort((a, b) => Number(a) - Number(b)).join('-')

      const cacheKey = `perf_detail_${selectedUser.employee_id}_${selectedFYStart}_${quarterKey}_${monthKey}`

      const { data, fromCache } = await cachedFetch(
        cacheKey,
        () => computePerformance(selectedUser.employee_id, monthYearPairs, selectedFYStart),
        TTL.SHORT,
        forceRefresh
      )

      if (!mountedRef.current) return
      setDetailData(data)
      setFromCache(Boolean(fromCache))
    } catch (err) {
      if (mountedRef.current) setDetailError(err.message)
    } finally {
      if (mountedRef.current) setDetailLoading(false)
    }
  }, [selectedUser, selectedFYStart, selectedQuarters, selectedMonths, monthYearPairs, computePerformance])

  useEffect(() => {
    mountedRef.current = true
    loadUsers()
    return () => { mountedRef.current = false }
  }, [loadUsers])

  useEffect(() => {
    loadDetail(false)
  }, [loadDetail])

  const toggleQuarter = (q) => {
    if (q === 'All') {
      setSelectedQuarters(['All'])
      setSelectedMonths(['All'])
      return
    }
    let next = selectedQuarters.filter(x => x !== 'All')
    if (next.includes(q)) next = next.filter(x => x !== q)
    else next.push(q)

    if (next.length === 0 || next.length === 4) {
      setSelectedQuarters(['All'])
      setSelectedMonths(['All'])
      return
    }
    setSelectedQuarters(next)
    setSelectedMonths(['All'])
  }

  const toggleMonth = (m) => {
    if (m === 'All') {
      setSelectedMonths(['All'])
      return
    }
    let next = selectedMonths.filter(x => x !== 'All')
    if (next.includes(m)) next = next.filter(x => x !== m)
    else next.push(m)

    if (next.length === 0 || next.length === availableMonths.length) {
      setSelectedMonths(['All'])
      return
    }
    setSelectedMonths(next)
  }

  return (
    <main className="apdr-main">
      <section className="apdr-header">
        <div>
          <h2>Performance Dashboard Report</h2>
          <p>View all users and open detailed performance metrics for each user</p>
        </div>
        <button className="apdr-btn apdr-btn-secondary" onClick={loadUsers} disabled={usersLoading}>
          <i className={`fa-solid fa-rotate-right ${usersLoading ? 'fa-spin' : ''}`}></i>
          Refresh Users
        </button>
      </section>

      <section className="apdr-filter-row">
        <div className="apdr-filter-group">
          <label>Financial Year</label>
          <select value={selectedFYStart} onChange={(e) => setSelectedFYStart(Number(e.target.value))}>
            {fyOptions.map(opt => <option key={opt.start} value={opt.start}>{opt.label}</option>)}
          </select>
        </div>

        <div className="apdr-filter-group">
          <label>Quarter</label>
          <div className="apdr-chip-wrap">
            <button className={`apdr-chip ${selectedQuarters.includes('All') ? 'active' : ''}`} onClick={() => toggleQuarter('All')}>All</button>
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => (
              <button key={q} className={`apdr-chip ${selectedQuarters.includes(q) ? 'active' : ''}`} onClick={() => toggleQuarter(q)}>{q}</button>
            ))}
          </div>
        </div>

        <div className="apdr-filter-group">
          <label>Month</label>
          <div className="apdr-chip-wrap">
            <button className={`apdr-chip ${selectedMonths.includes('All') ? 'active' : ''}`} onClick={() => toggleMonth('All')}>All</button>
            {availableMonths.map(m => (
              <button key={m} className={`apdr-chip ${selectedMonths.includes(m) ? 'active' : ''}`} onClick={() => toggleMonth(m)}>{MONTH_LABELS[m]}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="apdr-layout">
        <section className="apdr-card apdr-list-card">
          <div className="apdr-list-header">
            <h3>Users</h3>
            <span>{filteredUsers.length}</span>
          </div>

          <div className="apdr-search">
            <i className="fa-solid fa-search"></i>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, email, employee ID"
            />
          </div>

          {usersLoading ? (
            <div className="apdr-loading"><i className="fa-solid fa-spinner fa-spin"></i><span>Loading users...</span></div>
          ) : usersError ? (
            <div className="apdr-error">{usersError}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="apdr-empty">No users found.</div>
          ) : (
            <div className="apdr-user-list">
              {filteredUsers.map(u => (
                <button
                  key={u.id}
                  className={`apdr-user-row ${selectedUserId === u.id ? 'selected' : ''}`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <div className="apdr-user-name">{u.full_name || 'Unknown User'}</div>
                  <div className="apdr-user-sub">{u.employee_id || '-'} | {u.email || '-'}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="apdr-card apdr-detail-card">
          {!selectedUser ? (
            <div className="apdr-empty">Select a user to view performance details.</div>
          ) : detailLoading ? (
            <div className="apdr-loading"><i className="fa-solid fa-spinner fa-spin"></i><span>Loading user performance...</span></div>
          ) : detailError ? (
            <div className="apdr-error">{detailError}</div>
          ) : !detailData ? (
            <div className="apdr-empty">No data available for this user.</div>
          ) : (
            <>
              <div className="apdr-detail-header">
                <div>
                  <h3>{selectedUser.full_name || 'User'}</h3>
                  <p>{selectedUser.employee_id || '-'} | {selectedUser.email || '-'}</p>
                </div>
                <div className="apdr-detail-actions">
                  <span className={`apdr-cache-pill ${fromCache ? 'cached' : 'fresh'}`}>{fromCache ? 'Cached' : 'Live'}</span>
                  <button className="apdr-btn apdr-btn-secondary" onClick={() => loadDetail(true)}>
                    <i className="fa-solid fa-rotate-right"></i>
                    Refresh Detail
                  </button>
                </div>
              </div>

              <div className="apdr-total-card">
                <div>
                  <p>Total Achieved</p>
                  <h2>{detailData.totals.achievedPoints.toLocaleString()}</h2>
                </div>
                <div>
                  <p>Total Goal</p>
                  <h4>{detailData.totals.goalPoints.toLocaleString()}</h4>
                </div>
                <div>
                  <p>Overall %</p>
                  <h4>{detailData.totals.percentage}%</h4>
                </div>
              </div>

              <div className="apdr-pillars">
                <div className="apdr-pillar">
                  <h4>Sheet Points</h4>
                  <div className="apdr-grid3">
                    <div><label>Claimed Sheets</label><strong>{detailData.sheetData.claimed.toLocaleString()}</strong></div>
                    <div><label>Approved Sheets</label><strong>{detailData.sheetData.approvedSummary.toLocaleString()}</strong></div>
                    <div><label>Goal</label><strong>{detailData.sheetData.goal.toLocaleString()}</strong></div>
                    <div><label>Points</label><strong>{detailData.sheetData.points.toLocaleString()}</strong></div>
                    <div><label>Achievement</label><strong>{detailData.sheetData.goal > 0 ? ((detailData.sheetData.points / detailData.sheetData.goal) * 100).toFixed(1) : '0.0'}%</strong></div>
                  </div>

                  <div className="apdr-subtable-wrap">
                    <h5>Brand Breakdown</h5>
                    {detailData.sheetData.brandBreakdown.length === 0 ? (
                      <p className="apdr-muted">No brand data.</p>
                    ) : (
                      <table className="apdr-subtable">
                        <thead><tr><th>Brand</th><th>Sheets</th><th>Multiplier</th><th>Points</th></tr></thead>
                        <tbody>
                          {detailData.sheetData.brandBreakdown.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.brandCategory}</td>
                              <td>{toNumber(row.qty).toLocaleString()}</td>
                              <td>{toNumber(row.pointsPerSheet).toLocaleString()}</td>
                              <td>{toNumber(row.totalPoints).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="apdr-pillar">
                  <h4>DMI Points</h4>
                  <div className="apdr-grid3">
                    <div><label>Claimed DMIs</label><strong>{detailData.dmiData.claimedDmiCount.toLocaleString()}</strong></div>
                    <div><label>Active DMIs</label><strong>{detailData.dmiData.activeDmiCount.toLocaleString()}</strong></div>
                    <div><label>Goal</label><strong>{detailData.dmiGoal.toLocaleString()}</strong></div>
                    <div><label>Achieved Points</label><strong>{detailData.dmiData.achievedPoints.toLocaleString()}</strong></div>
                    <div><label>New DMI Points</label><strong>{detailData.dmiData.newEnrolledPoints.toLocaleString()}</strong></div>
                    <div><label>Tier Upgrade Points</label><strong>{detailData.dmiData.dmiUpdatePoints.toLocaleString()}</strong></div>
                  </div>

                  <div className="apdr-subtable-wrap">
                    <h5>Tier Breakdown</h5>
                    <table className="apdr-subtable">
                      <thead><tr><th>Tier</th><th>Active Count</th><th>Multiplier</th><th>Points</th></tr></thead>
                      <tbody>
                        {detailData.dmiData.tierBreakdown.map((row, idx) => (
                          <tr key={idx}>
                            <td>{row.tier}</td>
                            <td>{toNumber(row.activeDmiCount).toLocaleString()}</td>
                            <td>{toNumber(row.pointsPerDmi).toLocaleString()}</td>
                            <td>{(toNumber(row.activeDmiCount) * toNumber(row.pointsPerDmi)).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="apdr-pillar">
                  <h4>Behavior Points</h4>
                  <div className="apdr-grid3">
                    <div><label>Achieved Points</label><strong>{detailData.behaviorData.achievedPoints.toLocaleString()}</strong></div>
                    <div><label>Goal</label><strong>{detailData.behaviorData.goal.toLocaleString()}</strong></div>
                    <div><label>Completion</label><strong>{detailData.behaviorData.completionPercentage.toFixed(1)}%</strong></div>
                  </div>

                  <div className="apdr-subtable-wrap">
                    <h5>Behavior Breakdown</h5>
                    <table className="apdr-subtable">
                      <thead><tr><th>Metric</th><th>Weightage</th><th>Value</th><th>Achieved</th><th>Goal</th></tr></thead>
                      <tbody>
                        {detailData.behaviorData.breakdown.map((row, idx) => (
                          <tr key={idx}>
                            <td>{row.label}</td>
                            <td>{row.weightage}%</td>
                            <td>{toNumber(row.value).toLocaleString()}%</td>
                            <td>{toNumber(row.achievedVisits ?? row.completed).toLocaleString()}</td>
                            <td>{toNumber(row.visitGoal ?? row.assigned).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
