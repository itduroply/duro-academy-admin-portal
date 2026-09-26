import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { cachedFetch, TTL } from '../utils/cacheDB'
import './CombinedPerformanceDashboard.css'

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

function asText(value) {
  return String(value || '').trim()
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
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

function getCurrentQuarterKey() {
  const month = new Date().getMonth() + 1
  if (month >= 4 && month <= 6) return 'Q1'
  if (month >= 7 && month <= 9) return 'Q2'
  if (month >= 10 && month <= 12) return 'Q3'
  return 'Q4'
}

async function fetchPaged(getQuery, pageSize = 1000) {
  let from = 0
  let allRows = []

  while (true) {
    const { data, error } = await getQuery(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows = allRows.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }

  return allRows
}

function parseDateSafe(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const text = String(value).trim()
  if (!text) return null

  const direct = new Date(text)
  if (!Number.isNaN(direct.getTime())) return direct

  const dmy = text.match(/^([0-9]{1,2})\s+([A-Za-z]{3})\s+([0-9]{4})$/)
  if (!dmy) return null

  const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const monthIndex = monthMap[dmy[2]]
  if (monthIndex == null) return null

  const parsed = new Date(Number(dmy[3]), monthIndex, Number(dmy[1]))
  return Number.isNaN(parsed.getTime()) ? null : parsed
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
  const nextYear = last.month === 12 ? last.year + 1 : last.year
  const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  return { startDate, endDateExclusive }
}

function getMonthYearFromValue(value) {
  if (!value) return null
  const text = String(value).trim()
  const isoMatch = text.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})/)
  if (isoMatch) return { year: Number(isoMatch[1]), month: Number(isoMatch[2]) }
  const parsed = parseDateSafe(text)
  if (!parsed) return null
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 }
}

function normalizeAccount(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '')
  if (/^[0-9]+$/.test(compact)) return compact.replace(/^0+/, '') || '0'
  return compact.toUpperCase()
}

function normalizeTierLabel(value) {
  const raw = String(value || '').trim()
  const normalized = raw.toLowerCase()
  if (normalized === 'base' || normalized === 'base tier') return 'Base Tier'
  return raw || 'Unknown'
}

function buildSelectionLabel(selectedQuarters, selectedMonths) {
  const quarterLabel = selectedQuarters.includes('All') ? 'AllQuarters' : selectedQuarters.join('-')
  const monthLabel = selectedMonths.includes('All')
    ? 'AllMonths'
    : selectedMonths.map(month => MONTH_LABELS[Number(month)] || month).join('-')
  return `${quarterLabel}_${monthLabel}`
}

function buildCodeAliases(value) {
  const raw = String(value || '').trim()
  if (!raw) return []

  const upper = raw.toUpperCase()
  const aliases = new Set([raw, upper, raw.toLowerCase()])

  if (/^[0-9]+$/.test(upper)) {
    const noLeading = upper.replace(/^0+/, '') || '0'
    aliases.add(noLeading)
    aliases.add(`D${noLeading.padStart(5, '0')}`)
    aliases.add(`D${noLeading.padStart(6, '0')}`)
  }

  if (/^D[0-9]+$/.test(upper)) {
    const numeric = upper.slice(1)
    aliases.add(numeric)
    aliases.add(numeric.replace(/^0+/, '') || '0')
  }

  return [...aliases]
}

function buildPrefixOrFilter(column, codes) {
  const uniqueCodes = [...new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean))]
  if (uniqueCodes.length === 0) return ''
  return uniqueCodes.map(code => `${column}.ilike.${code}%`).join(',')
}

async function loadAccessUsers(accessTypes) {
  const requestedAccessTypes = [...new Set((accessTypes || []).map(type => String(type || '').trim()).filter(Boolean))]
  const accessQueries = requestedAccessTypes.map(accessType => (
    supabase
      .from('user_performance_dashboard')
      .select('users:user_id(id, full_name, email, employee_id, branch_id, status, leaving_date, reporting_manager), access_type, assigned_at')
      .contains('access_type', [accessType])
      .order('assigned_at', { ascending: false })
  ))

  const [branchRes, ...accessResults] = await Promise.all([
    supabase.from('branches').select('id, branch_name'),
    ...accessQueries,
  ])

  if (branchRes.error) throw branchRes.error
  const firstError = accessResults.find(result => result.error)
  if (firstError?.error) throw firstError.error

  const branchMap = new Map((branchRes.data || []).map(branch => [branch.id, branch.branch_name]))
  const map = new Map()

  const ingest = (rows, accessType) => {
    ;(rows || []).forEach(row => {
      const user = row?.users
      if (!user?.id) return

      const existing = map.get(user.id) || {
        id: user.id,
        full_name: asText(user.full_name),
        email: asText(user.email),
        employee_id: asText(user.employee_id),
        branch_id: user.branch_id || null,
        branch_name: branchMap.get(user.branch_id) || '',
        status: user.status || '',
        leaving_date: user.leaving_date || null,
        reporting_manager: asText(user.reporting_manager),
        access_types: [],
      }

      existing.branch_name = branchMap.get(user.branch_id) || existing.branch_name || ''
      existing.access_types = [...new Set([...(existing.access_types || []), accessType])]
      map.set(user.id, existing)
    })
  }

  accessResults.forEach((result, index) => {
    ingest(result.data, requestedAccessTypes[index])
  })

  return [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
}

async function computeDgoDetail(employeeId, monthYearPairs, fyStart) {
  const sortedPairs = [...monthYearPairs].sort((a, b) => (a.year - b.year) || (a.month - b.month))
  const selectedPairKeySet = new Set(sortedPairs.map(pair => monthYearKey(pair.month, pair.year)))
  const { startDate, endDateExclusive } = buildDateWindow(sortedPairs)
  const twoFyStart = `${fyStart - 1}-04-01`
  const twoFyEnd = `${fyStart + 1}-04-01`
  const employeeAliases = Array.from(new Set([String(employeeId), `D${String(employeeId).slice(-5)}`]))

  const applyAliasFilter = (query, column) => {
    if (employeeAliases.length === 1) return query.ilike(column, `${employeeAliases[0]}%`)
    const orClause = employeeAliases.map(code => `${column}.ilike.${code}%`).join(',')
    return query.or(orClause)
  }

  const pairMatch = (dateStr) => {
    const parsed = getMonthYearFromValue(dateStr)
    if (!parsed) return false
    return selectedPairKeySet.has(monthYearKey(parsed.month, parsed.year))
  }

  const [claimDateClaims, allStatusDateClaims, goalRow, pointsMasterData] = await Promise.all([
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => applyAliasFilter(
        supabase
          .from('influencer_claim_details')
          .select('claimed_qty_sheets, claim_date')
          .gte('claim_date', startDate)
          .lt('claim_date', endDateExclusive)
          .range(from, to),
        'mapped_isr_code'
      ))
      : Promise.resolve([]),
    fetchPaged((from, to) => applyAliasFilter(
      supabase
        .from('influencer_claim_details')
        .select('account_number, approved_qty, product_code, status_date')
        .gte('status_date', twoFyStart)
        .lt('status_date', twoFyEnd)
        .range(from, to),
      'mapped_isr_code'
    )),
    supabase
      .from('goals_master')
      .select('monthly_sheet_goal')
      .eq('employee_code', employeeId)
      .maybeSingle()
      .then(({ data }) => data),
    supabase
      .from('sheet_point_master')
      .select('brand_name, points_per_sheet')
      .then(({ data }) => data || []),
  ])

  const [enrollmentRowsSGT, warRows, attendanceRows, existingDmiVisitRows, newDmiVisitRows, tierUpgradeRows] = await Promise.all([
    fetchPaged((from, to) => {
      let query = supabase
        .from('m_enrollment_details')
        .select('account_no, tier, is_active, created_at, mapped_isr')
        .in('tier', ['Silver', 'Gold', 'Titanium'])
        .gte('created_at', twoFyStart)
        .order('created_at', { ascending: false, nullsFirst: false })
        .range(from, to)
      return applyAliasFilter(query, 'mapped_isr')
    }),
    fetchPaged((from, to) => {
      let query = supabase
        .from('telecalling_influencer_wartask')
        .select('task_date, status_as_on_today, status_change_date')
        .range(from, to)
      return applyAliasFilter(query, 'mapped_isr_code')
    }),
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => supabase
        .from('monthly_attendance_report')
        .select('attendance_date, attendance_status')
        .eq('employee_code', employeeId)
        .gte('attendance_date', startDate)
        .lt('attendance_date', endDateExclusive)
        .range(from, to)
      )
      : Promise.resolve([]),
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => supabase
        .from('influencer_visit_reports')
        .select('influencer_code, visit_date')
        .eq('emp_login', employeeId)
        .gte('visit_date', startDate)
        .lt('visit_date', endDateExclusive)
        .range(from, to)
      )
      : Promise.resolve([]),
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => supabase
        .from('influencer_enrollment_details')
        .select('influencer_id, enrollment_date')
        .eq('enrolled_by_dso_code', employeeId)
        .gte('enrollment_date', startDate)
        .lt('enrollment_date', endDateExclusive)
        .range(from, to)
      )
      : Promise.resolve([]),
    fetchPaged((from, to) => {
      let query = supabase
        .from('tier_upgrade_performance_report')
        .select('mapped_isr, change_type, previous_tier, new_tier, tier_change_date')
        .range(from, to)
      return applyAliasFilter(query, 'mapped_isr')
    }),
  ])

  const [leadDetailRows, leadTaskRows, sgtVisits] = await Promise.all([
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => supabase
        .from('lead_details_reports')
        .select('lead_created_by, created_date, lead_code')
        .ilike('lead_created_by', `${employeeId}%`)
        .gte('created_date', startDate)
        .lt('created_date', endDateExclusive)
        .range(from, to)
      )
      : Promise.resolve([]),
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => supabase
        .from('lead_task_reports')
        .select('id, task_created_on, lead_id')
        .eq('task_created_by_dso_code', employeeId)
        .gte('task_created_on', startDate)
        .lt('task_created_on', endDateExclusive)
        .range(from, to)
      )
      : Promise.resolve([]),
    (startDate && endDateExclusive)
      ? fetchPaged((from, to) => {
        let query = supabase
          .from('influencer_visit_reports')
          .select('influencer_code, visit_date, influencer_tier')
          .in('influencer_tier', ['Silver', 'Gold', 'Titanium'])
          .gte('visit_date', startDate)
          .lt('visit_date', endDateExclusive)
          .range(from, to)
        return applyAliasFilter(query, 'mapped_isr_code')
      })
      : Promise.resolve([]),
  ])

  const filteredClaimDateClaims = claimDateClaims.filter(c => pairMatch(c.claim_date))
  const filteredStatusDateClaims = allStatusDateClaims.filter(c => pairMatch(c.status_date))
  const monthlyGoal = toNumber(goalRow?.monthly_sheet_goal)
  const sheetGoal = sortedPairs.reduce((sum, pair) => sum + (monthlyGoal * getQuarterFactor(pair.month)), 0)
  const dmiGoal = sortedPairs.reduce((sum, pair) => {
    const spg = monthlyGoal * getQuarterFactor(pair.month)
    const a = spg / 55
    const b = Math.round(a)
    const c = b > 8 ? b : 8
    return sum + (c * 40)
  }, 0)

  const totalClaimedSheets = filteredClaimDateClaims.reduce((sum, item) => sum + toNumber(item.claimed_qty_sheets), 0)
  const totalApprovedSheets = filteredStatusDateClaims.reduce((sum, item) => sum + toNumber(item.approved_qty), 0)

  const productQtyMap = {}
  filteredStatusDateClaims.forEach(item => {
    if (!item.product_code) return
    productQtyMap[item.product_code] = (productQtyMap[item.product_code] || 0) + toNumber(item.approved_qty)
  })
  const uniqueProductCodes = Object.keys(productQtyMap)
  const brandMaster = uniqueProductCodes.length
    ? await supabase.from('brand_category_master').select('brand_name, brand_category').in('brand_name', uniqueProductCodes).then(({ data }) => data || [])
    : []

  const productToCategoryMap = {}
  brandMaster.forEach(item => {
    productToCategoryMap[item.brand_name] = item.brand_category
  })
  const categoryQtyMap = {}
  Object.entries(productQtyMap).forEach(([productCode, qty]) => {
    const category = productToCategoryMap[productCode] || 'Other'
    categoryQtyMap[category] = (categoryQtyMap[category] || 0) + qty
  })
  const categoryPointsMap = {}
  pointsMasterData.forEach(item => {
    categoryPointsMap[item.brand_name] = toNumber(item.points_per_sheet)
  })
  let sheetPoints = 0
  const allCategories = [...new Set([...(pointsMasterData || []).map(item => item.brand_name).filter(Boolean), ...Object.keys(categoryQtyMap)])]
  const brandBreakdown = allCategories.map(category => {
    const qty = toNumber(categoryQtyMap[category])
    const pointsPerSheet = toNumber(categoryPointsMap[category])
    const totalPoints = qty * pointsPerSheet
    sheetPoints += totalPoints
    return { brandCategory: category, qty, pointsPerSheet, totalPoints }
  })

  const selectedMonthlyTotals = {}
  filteredStatusDateClaims.forEach(claim => {
    const parsed = getMonthYearFromValue(claim.status_date)
    if (!parsed) return
    const mk = monthYearKey(parsed.month, parsed.year)
    if (!selectedPairKeySet.has(mk)) return
    const account = normalizeAccount(claim.account_number)
    if (!account) return
    const key = `${account}_${mk}`
    selectedMonthlyTotals[key] = (selectedMonthlyTotals[key] || 0) + toNumber(claim.approved_qty)
  })

  const activeAccountMonthRows = Object.entries(selectedMonthlyTotals)
    .filter(([, qty]) => toNumber(qty) >= 10)
    .map(([key, qty]) => {
      const lastUnderscore = key.lastIndexOf('_')
      const account = key.substring(0, lastUnderscore)
      const mk = key.substring(lastUnderscore + 1)
      const [yearText, monthText] = mk.split('-')
      return { account, year: Number(yearText), month: Number(monthText), totalSheets: toNumber(qty) }
    })

  const activeAccountsForHistory = [...new Set(activeAccountMonthRows.map(row => row.account))]
  const approvedSheetsByAccountMonth = new Map()
  if (activeAccountsForHistory.length > 0) {
    const CHUNK = 200
    for (let i = 0; i < activeAccountsForHistory.length; i += CHUNK) {
      const chunk = activeAccountsForHistory.slice(i, i + CHUNK)
      const historyRows = await fetchPaged((from, to) => supabase
        .from('influencer_claim_details')
        .select('account_number, approved_qty, status_date, claim_date')
        .in('account_number', chunk)
        .order('status_date', { ascending: false })
        .order('account_number', { ascending: true })
        .range(from, to)
      )

      historyRows.forEach(row => {
        const account = normalizeAccount(row.account_number)
        const parsed = getMonthYearFromValue(row.status_date || row.claim_date)
        if (!account || !parsed) return
        const mk = monthYearKey(parsed.month, parsed.year)
        if (!approvedSheetsByAccountMonth.has(account)) approvedSheetsByAccountMonth.set(account, new Map())
        const monthMap = approvedSheetsByAccountMonth.get(account)
        monthMap.set(mk, (monthMap.get(mk) || 0) + toNumber(row.approved_qty))
      })
    }
  }

  const twoFyMonthKeySet = new Set()
  for (let month = 4; month <= 12; month += 1) twoFyMonthKeySet.add(monthYearKey(month, fyStart - 1))
  for (let month = 1; month <= 3; month += 1) twoFyMonthKeySet.add(monthYearKey(month, fyStart))
  for (let month = 4; month <= 12; month += 1) twoFyMonthKeySet.add(monthYearKey(month, fyStart))
  for (let month = 1; month <= 3; month += 1) twoFyMonthKeySet.add(monthYearKey(month, fyStart + 1))

  const newDmiEntries = []
  const activeDmiEntries = []
  activeAccountMonthRows.forEach(({ account, month, year, totalSheets }) => {
    const selectedIdx = monthYearIndex(month, year)
    const monthMap = approvedSheetsByAccountMonth.get(account) || new Map()
    let hasPriorActive = false
    monthMap.forEach((qty, mk) => {
      if (hasPriorActive || toNumber(qty) < 10) return
      const [mkYear, mkMonth] = mk.split('-').map(Number)
      const idx = monthYearIndex(mkMonth, mkYear)
      if (idx < selectedIdx) hasPriorActive = true
    })

    if (hasPriorActive) activeDmiEntries.push({ account, month, year, totalSheets })
    else newDmiEntries.push({ account, month, year, totalSheets })
  })

  const enrollmentTierByAccountMonth = new Map()
  enrollmentRowsSGT.forEach(row => {
    const account = normalizeAccount(row.account_no)
    const tier = normalizeTierLabel(row.tier)
    const parsed = getMonthYearFromValue(row.created_at)
    if (!account || !tier || !parsed) return
    const key = `${account}_${monthYearKey(parsed.month, parsed.year)}`
    const time = parseDateSafe(row.created_at)?.getTime() || 0
    const prev = enrollmentTierByAccountMonth.get(key)
    if (!prev || time > prev.ts) enrollmentTierByAccountMonth.set(key, { tier, ts: time })
  })

  const influencerEnrollmentTierById = new Map()
  const extraFallbackRows = await (async () => {
    const requiredFallbackAccounts = [...new Set(activeDmiEntries.map(row => row.account).filter(Boolean))]
    if (requiredFallbackAccounts.length === 0) return []
    const CHUNK = 100
    const collected = []
    for (let i = 0; i < requiredFallbackAccounts.length; i += CHUNK) {
      const chunk = requiredFallbackAccounts.slice(i, i + CHUNK)
      const rows = await fetchPaged((from, to) => supabase
        .from('influencer_enrollment_details')
        .select('influencer_id, influencer_tier, enrollment_date')
        .in('influencer_id', chunk)
        .order('enrollment_date', { ascending: false })
        .order('influencer_id', { ascending: true })
        .order('influencer_tier', { ascending: true })
        .range(from, to)
      , 300)
      collected.push(...rows)
    }
    return collected
  })()
  extraFallbackRows.forEach(row => {
    const account = normalizeAccount(row.influencer_id)
    const tier = normalizeTierLabel(row.influencer_tier)
    if (!account || !tier) return
    const time = parseDateSafe(row.enrollment_date)?.getTime() || 0
    const prev = influencerEnrollmentTierById.get(account)
    if (!prev || time > prev.ts) influencerEnrollmentTierById.set(account, { tier, ts: time })
  })

  const selectedActiveEntries = activeDmiEntries.map(entry => {
    const mk = monthYearKey(entry.month, entry.year)
    const primaryTierData = enrollmentTierByAccountMonth.get(`${entry.account}_${mk}`)
    const fallbackTierData = influencerEnrollmentTierById.get(entry.account)
    return {
      account: entry.account,
      month: entry.month,
      year: entry.year,
      tier: primaryTierData?.tier || fallbackTierData?.tier || 'Unknown',
    }
  })

  const allKnownTiers = ['Titanium', 'Gold', 'Silver', 'Bronze', 'Base Tier']
  const uniqueTiers = [...new Set([
    ...allKnownTiers,
    ...selectedActiveEntries.map(item => normalizeTierLabel(item.tier)).filter(Boolean),
  ])]

  const tierPoints = uniqueTiers.length
    ? await supabase.from('dmi_raw_points_master').select('tier, points_per_dmi').in('tier', uniqueTiers).then(({ data }) => data || [])
    : []
  const tierPointsMap = {}
  tierPoints.forEach(item => {
    tierPointsMap[normalizeTierLabel(item.tier)] = toNumber(item.points_per_dmi)
  })

  const tierCountMap = {}
  selectedActiveEntries.forEach(entry => {
    const tier = normalizeTierLabel(entry.tier) || 'Unknown'
    tierCountMap[tier] = (tierCountMap[tier] || 0) + 1
  })

  let totalRawPoints = 0
  Object.entries(tierCountMap).forEach(([tier, count]) => {
    totalRawPoints += toNumber(count) * toNumber(tierPointsMap[tier])
  })
  const activeDmiCount = selectedActiveEntries.length
  const newDmiCount = newDmiEntries.length
  const approvedSheetsForAverage = activeAccountMonthRows.reduce((sum, row) => sum + toNumber(row.totalSheets), 0)
  const averageSheetsPerDmi = activeDmiCount + newDmiCount > 0 ? Number((approvedSheetsForAverage / (activeDmiCount + newDmiCount)).toFixed(1)) : 0
  let rawPointsMultiplier = 1
  if (averageSheetsPerDmi < 15) rawPointsMultiplier = 0.15
  else if (averageSheetsPerDmi < 40) rawPointsMultiplier = 0.5
  const finalRawPoints = Math.round(totalRawPoints * rawPointsMultiplier)
  const newEnrolledPoints = newDmiCount * 10

  const tierMap = { 'Base Tier': 1, Bronze: 2, Silver: 3, Gold: 4, Titanium: 5 }
  const normalizeChangeType = (value) => String(value || '').trim().toLowerCase()
  const fyStartDt = new Date(`${fyStart}-04-01`)
  const fyEndDt = new Date(`${fyStart + 1}-04-01`)
  const parseTierChangeDate = (dateStr) => {
    if (!dateStr) return null
    const date = new Date(dateStr)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const allUpgradeRecords = await fetchPaged((from, to) => {
    let query = supabase
      .from('tier_upgrade_performance_report')
      .select('mapped_isr, change_type, previous_tier, new_tier, tier_change_date')
      .order('tier_change_date', { ascending: false })
      .order('mapped_isr', { ascending: true })
      .order('previous_tier', { ascending: true })
      .range(from, to)
    query = query.or(buildPrefixOrFilter('mapped_isr', buildCodeAliases(employeeId)))
    return query
  })
  const tierUpgradeRecordsInFY = allUpgradeRecords.filter(row => {
    const changeDate = parseTierChangeDate(row.tier_change_date)
    return changeDate && changeDate >= fyStartDt && changeDate < fyEndDt
  })
  const qualifyingUpgrades = tierUpgradeRecordsInFY.filter(row => {
    if (normalizeChangeType(row.change_type) !== 'tier upgrade') return false
    const previousTier = normalizeTierLabel(row.previous_tier)
    const newTier = normalizeTierLabel(row.new_tier)
    const previousTierValue = tierMap[previousTier]
    const newTierValue = tierMap[newTier]
    if (previousTierValue == null || newTierValue == null) return false
    const parsed = getMonthYearFromValue(row.tier_change_date)
    return ['Silver', 'Gold', 'Titanium'].includes(newTier) && newTierValue > previousTierValue && parsed && selectedPairKeySet.has(monthYearKey(parsed.month, parsed.year))
  })
  const dmiUpdatePoints = qualifyingUpgrades.reduce((sum, row) => {
    const previousTierValue = tierMap[normalizeTierLabel(row.previous_tier)]
    const newTierValue = tierMap[normalizeTierLabel(row.new_tier)]
    return sum + ((newTierValue - previousTierValue) * 25)
  }, 0)

  const dmiData = {
    achievedPoints: finalRawPoints + newEnrolledPoints + dmiUpdatePoints,
    finalRawPoints,
    newEnrolledPoints,
    dmiUpdatePoints,
    claimedDmiCount: new Set(filteredStatusDateClaims.map(item => normalizeAccount(item.account_number)).filter(Boolean)).size,
    activeDmiCount,
    newDmiCount,
    tierUpgradedDmiCount: qualifyingUpgrades.length,
    averageSheetsPerDmi,
    rawPointsMultiplier,
    tierBreakdown: Object.entries(tierCountMap).map(([tier, count]) => ({ tier, activeDmiCount: count, pointsPerDmi: toNumber(tierPointsMap[tier]) })),
  }

  let monthlyVisitGoal = 0
  const tierMonthlyGoalMap = { Silver: 0, Gold: 0, Titanium: 0 }
  const activeSgtAccounts = new Set(selectedActiveEntries.map(entry => entry.account))
  const sgtGoalRows = enrollmentRowsSGT.filter(row => activeSgtAccounts.has(normalizeAccount(row.account_no)))
  sgtGoalRows.forEach(row => {
    const tier = normalizeTierLabel(row.tier)
    if (tier === 'Silver') {
      monthlyVisitGoal += 1
      tierMonthlyGoalMap.Silver += 1
    } else if (tier === 'Gold' || tier === 'Titanium') {
      monthlyVisitGoal += 2
      tierMonthlyGoalMap[tier] += 2
    }
  })
  const sgtGoal = monthlyVisitGoal * sortedPairs.length
  const uniqueDayVisitMap = new Map()
  sgtVisits.filter(v => pairMatch(v.visit_date) && activeSgtAccounts.has(normalizeAccount(v.influencer_code))).forEach(v => {
    const date = parseDateSafe(v.visit_date)
    if (!date) return
    const key = `${normalizeAccount(v.influencer_code)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`
    if (!uniqueDayVisitMap.has(key)) uniqueDayVisitMap.set(key, v)
  })
  const monthlyVisitCounts = {}
  Array.from(uniqueDayVisitMap.values()).forEach(v => {
    const date = parseDateSafe(v.visit_date)
    if (!date) return
    const mk = `${normalizeAccount(v.influencer_code)}_${date.getMonth() + 1}_${date.getFullYear()}`
    if (!monthlyVisitCounts[mk]) monthlyVisitCounts[mk] = { count: 0, tier: normalizeTierLabel(v.influencer_tier) }
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
    sgtTierBreakdown: ['Silver', 'Gold', 'Titanium'].map(tier => ({ tier, achievedVisits: tierAchievedMap[tier] || 0, goalVisits: (tierMonthlyGoalMap[tier] || 0) * sortedPairs.length })),
  }

  const warFiltered = warRows.filter(row => pairMatch(row.task_date))
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
    completed: warFiltered.filter(row => normalizeTierLabel(row.status_as_on_today) === 'closure' && isClosureWithinAllowedWindow(row.task_date, row.status_change_date)).length,
  }

  const filteredAttendance = attendanceRows.filter(row => pairMatch(row.attendance_date))
  const workingDays = filteredAttendance.filter(row => {
    const status = String(row.attendance_status || '').trim()
    return status === 'P | P' || status === '- | -'
  }).length
  const dmiSiteGoal = Math.max(workingDays - 1, 0) * 10
  const existingDmiVisitSet = new Set()
  existingDmiVisitRows.filter(v => pairMatch(v.visit_date)).forEach(v => {
    const date = parseDateSafe(v.visit_date)
    if (!date || !v.influencer_code) return
    existingDmiVisitSet.add(`${normalizeAccount(v.influencer_code)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
  })
  const newDmiVisitSet = new Set()
  newDmiVisitRows.filter(v => pairMatch(v.enrollment_date)).forEach(v => {
    const date = parseDateSafe(v.enrollment_date)
    if (!date || !v.influencer_id) return
    newDmiVisitSet.add(`${normalizeAccount(v.influencer_id)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
  })
  const newSiteSet = new Set()
  leadDetailRows.filter(v => pairMatch(v.created_date)).forEach(v => {
    const date = parseDateSafe(v.created_date)
    if (!date || !v.lead_code) return
    newSiteSet.add(`${v.lead_code}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
  })
  const existingSiteSet = new Set()
  leadTaskRows.forEach((v, idx) => {
    const date = parseDateSafe(v.task_created_on)
    if (!date) return
    if (v.lead_id) existingSiteSet.add(`${v.lead_id}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
    else existingSiteSet.add(`nulllead_${v.id || idx}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
  })
  const dmiVisits = existingDmiVisitSet.size + newDmiVisitSet.size
  const siteVisits = newSiteSet.size + existingSiteSet.size
  const dmiSiteData = {
    visitGoal: dmiSiteGoal,
    achievedVisits: dmiVisits + siteVisits,
    dmiVisits,
    newDmiVisits: newDmiVisitSet.size,
    existingDmiVisits: existingDmiVisitSet.size,
    siteVisits,
    newSiteVisits: newSiteSet.size,
    existingSiteVisits: existingSiteSet.size,
  }

  const behaviorGoal = Math.round(sortedPairs.reduce((sum, pair) => {
    const adjustedMonthlySheetGoal = monthlyGoal * getQuarterFactor(pair.month)
    const quarterlyEquivalentGoal = adjustedMonthlySheetGoal * 3
    const monthlyBehaviorGoal = quarterlyEquivalentGoal > 1800 ? adjustedMonthlySheetGoal * 0.2 : 120
    return sum + monthlyBehaviorGoal
  }, 0))

  const sgtAchievedCapped = sgtData.visitGoal > 0 ? Math.min(sgtData.achievedVisits, sgtData.visitGoal) : 0
  const sgtPct = sgtData.visitGoal === 0 && sgtData.achievedVisits === 0 ? 100 : sgtData.visitGoal > 0 ? Math.min((sgtAchievedCapped / sgtData.visitGoal) * 100, 100) : 0
  const dmiSiteAchievedCapped = dmiSiteData.visitGoal > 0 ? Math.min(dmiSiteData.achievedVisits, dmiSiteData.visitGoal) : 0
  const dmiSitePct = dmiSiteData.visitGoal === 0 && dmiSiteData.achievedVisits === 0 ? 100 : dmiSiteData.visitGoal > 0 ? Math.min((dmiSiteAchievedCapped / dmiSiteData.visitGoal) * 100, 100) : 0
  const warCompletedCapped = warTaskData.assigned > 0 ? Math.min(warTaskData.completed, warTaskData.assigned) : 0
  const warPct = warTaskData.assigned === 0 && warTaskData.completed === 0 ? 100 : warTaskData.assigned > 0 ? Math.min((warCompletedCapped / warTaskData.assigned) * 100, 100) : 0
  const behaviorCompletion = Math.min((sgtPct * 40 / 100) + (dmiSitePct * 35 / 100) + (warPct * 25 / 100), 100)
  const behaviorPoints = behaviorGoal > 0 ? Math.min(Math.round((behaviorCompletion / 100) * behaviorGoal), behaviorGoal) : 0

  const behaviorData = {
    achievedPoints: behaviorPoints,
    goal: behaviorGoal,
    completionPercentage: Number(behaviorCompletion.toFixed(1)),
    breakdown: [
      { label: 'S/G/T Coverage', weightage: 40, value: Math.round(sgtPct), visitGoal: sgtData.visitGoal, achievedVisits: sgtAchievedCapped, actualAchievedVisits: sgtData.achievedVisits, sgtTierBreakdown: sgtData.sgtTierBreakdown },
      { label: 'DMI+Site Visits', weightage: 35, value: Math.round(dmiSitePct), visitGoal: dmiSiteData.visitGoal, achievedVisits: dmiSiteAchievedCapped, actualAchievedVisits: dmiSiteData.achievedVisits, dmiVisits: dmiSiteData.dmiVisits, newDmiVisits: dmiSiteData.newDmiVisits, existingDmiVisits: dmiSiteData.existingDmiVisits, siteVisits: dmiSiteData.siteVisits, newSiteVisits: dmiSiteData.newSiteVisits, existingSiteVisits: dmiSiteData.existingSiteVisits },
      { label: 'War Task Completion', weightage: 25, value: Math.round(warPct), assigned: warTaskData.assigned, completed: warCompletedCapped, actualCompleted: warTaskData.completed },
    ],
  }

  const totalAchieved = toNumber(sheetPoints) + toNumber(dmiData.achievedPoints) + toNumber(behaviorData.achievedPoints)
  const totalGoal = toNumber(sheetGoal) + toNumber(dmiGoal) + toNumber(behaviorData.goal)
  const totalPct = totalGoal > 0 ? Number(((totalAchieved / totalGoal) * 100).toFixed(1)) : 0

  return {
    employeeId,
    sheetData: {
      achieved: totalApprovedSheets,
      claimed: totalClaimedSheets,
      approvedSummary: totalApprovedSheets,
      points: sheetPoints,
      goal: sheetGoal,
      baseMonthlyGoal: monthlyGoal,
      brandBreakdown,
    },
    dmiGoal,
    dmiData,
    behaviorData,
    totals: { achievedPoints: totalAchieved, goalPoints: totalGoal, percentage: totalPct },
  }
}

async function computeAsmDetail(employeeId, monthYearPairs, fyStart) {
  const sortedPairs = [...monthYearPairs].sort((a, b) => (a.year - b.year) || (a.month - b.month))
  const exactEmployeeId = String(employeeId || '').trim()
  if (!exactEmployeeId) return null

  const selectedDateWindow = buildDateWindow(sortedPairs)
  const selectedMonthKeySet = new Set(sortedPairs.map(pair => `${pair.month}_${pair.year}`))
  const managerAliases = buildCodeAliases(exactEmployeeId)

  const [dgoUsersExact, dgoUsersFallback] = await Promise.all([
    supabase.from('users').select('id, full_name, employee_id').eq('reporting_manager', exactEmployeeId).order('full_name', { ascending: true }),
    supabase.from('users').select('id, full_name, employee_id').in('reporting_manager', managerAliases).order('full_name', { ascending: true }),
  ])

  if (dgoUsersExact.error) throw dgoUsersExact.error
  if (dgoUsersFallback.error) throw dgoUsersFallback.error

  const exactTeam = Array.isArray(dgoUsersExact.data) ? dgoUsersExact.data : []
  const fallbackTeam = Array.isArray(dgoUsersFallback.data) ? dgoUsersFallback.data : []
  const dgoTeam = exactTeam.length > 0 ? exactTeam : fallbackTeam
  const baseCodes = [exactEmployeeId, ...dgoTeam.map(item => String(item.employee_id || '').trim())].filter(Boolean)
  const allCodes = [...new Set(baseCodes.flatMap(buildCodeAliases))]

  const fetchTotalMonthlyGoal = async (codes) => {
    const uniqueCodes = [...new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean))]
    if (uniqueCodes.length === 0) return 0
    const { data, error } = await supabase.from('goals_master').select('employee_code, monthly_sheet_goal').in('employee_code', uniqueCodes)
    if (error || !data) return 0
    return data.reduce((sum, row) => sum + toNumber(row.monthly_sheet_goal), 0)
  }

  const fetchSheetPoints = async ({ codes, monthYearPairs, sheetGoalCodeList, dmiGoalCodeList, claimCodeExact = null }) => {
    if (!monthYearPairs || monthYearPairs.length === 0) return null
    const exactIds = claimCodeExact ? [String(claimCodeExact).trim()] : [...new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean))]
    if (exactIds.length === 0) return null

    const chunkSize = 50
    const idChunks = []
    for (let index = 0; index < exactIds.length; index += chunkSize) idChunks.push(exactIds.slice(index, index + chunkSize))

    const fetchClaims = async (dateColumn) => {
      const collected = []
      for (const chunk of idChunks) {
        let from = 0
        while (true) {
          let query = supabase
            .from('influencer_claim_details')
            .select('claimed_qty_sheets, approved_qty, product_code, claim_date, status_date, mapped_isr_code, account_number')
            .in('mapped_isr_code', chunk)
            .order(dateColumn, { ascending: false })
            .order('mapped_isr_code', { ascending: true })
            .order('account_number', { ascending: true })
            .order('product_code', { ascending: true })
            .range(from, from + 999)

          if (selectedDateWindow.startDate && selectedDateWindow.endDateExclusive) {
            query = query.gte(dateColumn, selectedDateWindow.startDate).lt(dateColumn, selectedDateWindow.endDateExclusive)
          }

          const { data, error } = await query
          if (error || !data || data.length === 0) break
          collected.push(...data)
          if (data.length < 1000) break
          from += 1000
        }
      }
      return collected
    }

    const [claimedRows, statusRows, totalMonthlyGoal, sheetGoalMonthlyBase, pointsMasterRes] = await Promise.all([
      fetchClaims('claim_date'),
      fetchClaims('status_date'),
      fetchTotalMonthlyGoal(dmiGoalCodeList),
      fetchTotalMonthlyGoal(sheetGoalCodeList),
      supabase.from('sheet_point_master').select('brand_name, points_per_sheet'),
    ])

    const sheetRowsForCalc = statusRows.length > 0 ? statusRows : claimedRows
    const totalClaimedSheets = sheetRowsForCalc.reduce((sum, row) => sum + toNumber(row.claimed_qty_sheets), 0)
    const totalApprovedSheets = sheetRowsForCalc.reduce((sum, row) => sum + toNumber(row.approved_qty), 0)

    const productQtyMap = {}
    sheetRowsForCalc.forEach(row => {
      if (!row.product_code) return
      productQtyMap[row.product_code] = (productQtyMap[row.product_code] || 0) + toNumber(row.approved_qty)
    })

    const uniqueProductCodes = Object.keys(productQtyMap)
    const { data: brandMaster } = uniqueProductCodes.length > 0
      ? await supabase.from('brand_category_master').select('brand_name, brand_category').in('brand_name', uniqueProductCodes)
      : { data: [] }

    const productToCategoryMap = {}
    ;(brandMaster || []).forEach(item => {
      productToCategoryMap[item.brand_name] = item.brand_category
    })

    const categoryQtyMap = {}
    Object.entries(productQtyMap).forEach(([productCode, qty]) => {
      const category = productToCategoryMap[productCode] || 'Other'
      categoryQtyMap[category] = (categoryQtyMap[category] || 0) + qty
    })

    const categoryPointsMap = {}
    ;(pointsMasterRes.data || []).forEach(item => {
      categoryPointsMap[item.brand_name] = toNumber(item.points_per_sheet)
    })

    let totalPoints = 0
    const allCategories = [...new Set([...(pointsMasterRes.data || []).map(item => item.brand_name).filter(Boolean), ...Object.keys(categoryQtyMap)])]
    const brandBreakdown = allCategories.map(category => {
      const qty = toNumber(categoryQtyMap[category])
      const pointsPerSheet = toNumber(categoryPointsMap[category])
      const totalCategoryPoints = qty * pointsPerSheet
      totalPoints += totalCategoryPoints
      return { brandCategory: category, qty, pointsPerSheet, totalPoints: totalCategoryPoints }
    })

    const filteredGoal = monthYearPairs.reduce((sum, pair) => sum + (sheetGoalMonthlyBase * getQuarterFactor(pair.month)), 0)
    const computedDmiGoal = monthYearPairs.reduce((sum, pair) => {
      const adjusted = totalMonthlyGoal * getQuarterFactor(pair.month)
      const rounded = Math.round(adjusted / 55)
      const floorValue = rounded > 8 ? rounded : 8
      return sum + (floorValue * 40)
    }, 0)

    return {
      sheetData: {
        achieved: totalApprovedSheets,
        claimed: totalClaimedSheets,
        approvedSummary: totalApprovedSheets,
        points: totalPoints,
        goal: filteredGoal,
        baseMonthlyGoal: totalMonthlyGoal,
        brandBreakdown,
      },
      dmiGoal: computedDmiGoal,
    }
  }

  const fetchDmiPoints = async ({ codes, monthYearPairs, claimCodeExact = null, disableAliasFallback = false }) => {
    if (!codes || codes.length === 0 || monthYearPairs.length === 0) {
      return { achievedPoints: 0, finalRawPoints: 0, newEnrolledPoints: 0, dmiUpdatePoints: 0, claimedDmiCount: 0, activeDmiCount: 0, newDmiCount: 0, tierUpgradedDmiCount: 0, averageSheetsPerDmi: 0, tierBreakdown: [] }
    }

    const pageSize = 1000
    const codeChunkSize = 20
    const normalizedCodes = [...new Set((codes || []).map(code => String(code || '').trim()).filter(Boolean))]
    const codeChunks = []
    for (let index = 0; index < normalizedCodes.length; index += codeChunkSize) codeChunks.push(normalizedCodes.slice(index, index + codeChunkSize))

    const allDmiClaims = []
    const allDmiClaimsHistory = []

    const fetchChunk = async (codeChunk, exactCode = null, dateWindow = selectedDateWindow, target = allDmiClaims) => {
      if (!exactCode && (!Array.isArray(codeChunk) || codeChunk.length === 0)) return

      let from = 0
      while (true) {
        let query = supabase
          .from('influencer_claim_details')
          .select('account_number, approved_qty, status_date')
          .order('status_date', { ascending: false })
          .order('account_number', { ascending: true })
          .range(from, from + pageSize - 1)

        if (dateWindow.startDate && dateWindow.endDateExclusive) {
          query = query.gte('status_date', dateWindow.startDate).lt('status_date', dateWindow.endDateExclusive)
        }

        if (exactCode) query = query.eq('mapped_isr_code', exactCode)
        else query = query.in('mapped_isr_code', codeChunk)

        const { data, error } = await query
        if (error || !data || data.length === 0) break
        target.push(...data)
        if (data.length < pageSize) break
        from += pageSize
      }
    }

    if (claimCodeExact) {
      await fetchChunk([], claimCodeExact, selectedDateWindow, allDmiClaims)
      if (!disableAliasFallback && allDmiClaims.length === 0) {
        for (const chunk of codeChunks) await fetchChunk(chunk, null, selectedDateWindow, allDmiClaims)
      }
    } else {
      for (const chunk of codeChunks) await fetchChunk(chunk, null, selectedDateWindow, allDmiClaims)
    }

    const currentPeriodAccounts = [...new Set(allDmiClaims.map(row => normalizeAccount(row.account_number)).filter(Boolean))]
    if (currentPeriodAccounts.length > 0) {
      const accountHistoryChunkSize = 200
      for (let i = 0; i < currentPeriodAccounts.length; i += accountHistoryChunkSize) {
        const chunk = currentPeriodAccounts.slice(i, i + accountHistoryChunkSize)
        let from = 0
        while (true) {
          let query = supabase
            .from('influencer_claim_details')
            .select('account_number, approved_qty, status_date')
            .in('account_number', chunk)
            .order('status_date', { ascending: false })
            .order('account_number', { ascending: true })
            .range(from, from + pageSize - 1)
          if (selectedDateWindow.startDate && selectedDateWindow.endDateExclusive) {
            query = query.gte('status_date', selectedDateWindow.startDate).lt('status_date', selectedDateWindow.endDateExclusive)
          }
          const { data, error } = await query
          if (error || !data || data.length === 0) break
          allDmiClaimsHistory.push(...data)
          if (data.length < pageSize) break
          from += pageSize
        }
      }
    }

    const dmiClaims = allDmiClaims.filter(claim => {
      const parsed = getMonthYearFromValue(claim.status_date)
      return parsed ? selectedMonthKeySet.has(`${parsed.month}_${parsed.year}`) : false
    })

    const uniqueClaimAccounts = [...new Set(dmiClaims.map(claim => normalizeAccount(claim.account_number)).filter(Boolean))]
    const enrollmentRows = []
    if (uniqueClaimAccounts.length > 0) {
      const chunkSize = 80
      for (let index = 0; index < uniqueClaimAccounts.length; index += chunkSize) {
        const chunk = uniqueClaimAccounts.slice(index, index + chunkSize)
        const rows = await fetchPaged((from, to) => supabase
          .from('m_enrollment_details')
          .select('account_no, tier, created_at')
          .in('account_no', chunk)
          .gte('created_at', selectedDateWindow.startDate)
          .lt('created_at', selectedDateWindow.endDateExclusive)
          .order('created_at', { ascending: false })
          .order('account_no', { ascending: true })
          .order('tier', { ascending: true })
          .range(from, to)
        , 300)
        enrollmentRows.push(...rows)
      }
    }

    const enrollTierByAccountMonth = {}
    enrollmentRows.forEach(row => {
      const account = normalizeAccount(row.account_no)
      const parsed = getMonthYearFromValue(row.created_at)
      if (!account || !parsed) return
      const key = `${account}_${parsed.month}_${parsed.year}`
      const time = parseDateSafe(row.created_at)?.getTime() || 0
      if (!enrollTierByAccountMonth[key] || time > enrollTierByAccountMonth[key].createdAtMs) {
        enrollTierByAccountMonth[key] = { tier: row.tier, createdAtMs: time }
      }
    })

    const requiredFallbackAccounts = [...new Set(dmiClaims
      .map(claim => {
        const account = normalizeAccount(claim.account_number)
        const parsed = getMonthYearFromValue(claim.status_date)
        if (!account || !parsed) return ''
        const key = `${account}_${parsed.month}_${parsed.year}`
        return enrollTierByAccountMonth[key] ? '' : account
      })
      .filter(Boolean))]

    const influencerEnrollTier = {}
    if (requiredFallbackAccounts.length > 0) {
      const chunkSize = 100
      for (let index = 0; index < requiredFallbackAccounts.length; index += chunkSize) {
        const chunk = requiredFallbackAccounts.slice(index, index + chunkSize)
        const rows = await fetchPaged((from, to) => supabase
          .from('influencer_enrollment_details')
          .select('influencer_id, influencer_tier, enrollment_date')
          .in('influencer_id', chunk)
          .order('enrollment_date', { ascending: false })
          .order('influencer_id', { ascending: true })
          .order('influencer_tier', { ascending: true })
          .range(from, to)
        , 300)
        rows.forEach(row => {
          const account = normalizeAccount(row.influencer_id)
          if (!account || !row.influencer_tier) return
          const time = parseDateSafe(row.enrollment_date)?.getTime() || 0
          if (!influencerEnrollTier[account] || time > influencerEnrollTier[account].enrollmentTimeMs) {
            influencerEnrollTier[account] = { tier: row.influencer_tier, enrollmentTimeMs: time }
          }
        })
      }
    }

    const claimsByMonth = {}
    dmiClaims.forEach(claim => {
      const parsed = getMonthYearFromValue(claim.status_date)
      if (!parsed) return
      const key = `${parsed.month}_${parsed.year}`
      if (!selectedMonthKeySet.has(key)) return
      if (!claimsByMonth[key]) claimsByMonth[key] = []
      claimsByMonth[key].push(claim)
    })

    const approvedSheetsByAccountMonth = {}
    allDmiClaimsHistory.forEach(claim => {
      const account = normalizeAccount(claim.account_number)
      const parsed = getMonthYearFromValue(claim.status_date)
      if (!account || !parsed) return
      const key = `${parsed.month}_${parsed.year}`
      if (!approvedSheetsByAccountMonth[account]) approvedSheetsByAccountMonth[account] = {}
      approvedSheetsByAccountMonth[account][key] = (approvedSheetsByAccountMonth[account][key] || 0) + toNumber(claim.approved_qty)
    })

    const historyMonthIndexes = new Set()
    for (let month = 4; month <= 12; month += 1) historyMonthIndexes.add(monthYearIndex(month, fyStart - 1))
    for (let month = 1; month <= 3; month += 1) historyMonthIndexes.add(monthYearIndex(month, fyStart))
    for (let month = 4; month <= 12; month += 1) historyMonthIndexes.add(monthYearIndex(month, fyStart))
    for (let month = 1; month <= 3; month += 1) historyMonthIndexes.add(monthYearIndex(month, fyStart + 1))

    const newDmiByMonth = {}
    const activeByMonth = {}
    let newDmiCount = 0

    Object.keys(claimsByMonth).forEach(key => {
      const [monthText, yearText] = key.split('_')
      const month = Number(monthText)
      const year = Number(yearText)
      const currentIndex = monthYearIndex(month, year)
      newDmiByMonth[key] = []
      activeByMonth[key] = []

      const accountSheets = {}
      claimsByMonth[key].forEach(claim => {
        const account = normalizeAccount(claim.account_number)
        if (!account) return
        accountSheets[account] = (accountSheets[account] || 0) + toNumber(claim.approved_qty)
      })

      Object.entries(accountSheets).forEach(([account, sheets]) => {
        if (sheets < 10) return
        const history = approvedSheetsByAccountMonth[account] || {}
        const hasPrior = Object.keys(history).some(historyKey => {
          const [historyMonth, historyYear] = historyKey.split('_').map(Number)
          const historyIndex = monthYearIndex(historyMonth, historyYear)
          return historyIndex < currentIndex && historyMonthIndexes.has(historyIndex) && toNumber(history[historyKey]) >= 10
        })

        if (hasPrior) activeByMonth[key].push(account)
        else {
          newDmiByMonth[key].push(account)
          newDmiCount += 1
        }
      })
    })

    const uniqueTiers = [...new Set(['Titanium', 'Gold', 'Silver', 'Bronze', 'Base Tier', ...Object.values(enrollTierByAccountMonth).map(item => normalizeTierLabel(item.tier)).filter(Boolean)])]
    const tierPointsMaster = uniqueTiers.length > 0
      ? await supabase.from('dmi_raw_points_master').select('tier, points_per_dmi').in('tier', uniqueTiers).then(({ data }) => data || [])
      : []

    const tierPointsMap = {}
    tierPointsMaster.forEach(row => {
      tierPointsMap[normalizeTierLabel(row.tier)] = toNumber(row.points_per_dmi)
    })

    const tierCountMap = {}
    const activeDmiEntries = []
    sortedPairs.forEach(pair => {
      const key = `${pair.month}_${pair.year}`
      const accountSheets = {}
      ;(claimsByMonth[key] || []).forEach(claim => {
        const account = normalizeAccount(claim.account_number)
        if (!account) return
        accountSheets[account] = (accountSheets[account] || 0) + toNumber(claim.approved_qty)
      })

      ;(activeByMonth[key] || []).forEach(account => {
        const lookupKey = `${account}_${key}`
        const tier = enrollTierByAccountMonth[lookupKey]?.tier || influencerEnrollTier[account]?.tier || 'Unknown'
        activeDmiEntries.push({ account, month: pair.month, year: pair.year, tier, totalSheets: accountSheets[account] || 0 })
        const normalizedTier = normalizeTierLabel(tier)
        tierCountMap[normalizedTier] = (tierCountMap[normalizedTier] || 0) + 1
      })
    })

    Object.keys(tierPointsMap).forEach(tier => {
      if (tierCountMap[tier] == null) tierCountMap[tier] = 0
    })

    const totalRawPoints = Object.entries(tierCountMap).reduce((sum, [tier, count]) => sum + (toNumber(count) * toNumber(tierPointsMap[tier])), 0)
    const activeDmiCount = activeDmiEntries.length
    const claimedDmiCount = [...new Set(dmiClaims.map(claim => normalizeAccount(claim.account_number)).filter(Boolean))].length
    const achievedSheetsInPeriod = dmiClaims.reduce((sum, claim) => sum + toNumber(claim.approved_qty), 0)
    const averageSheetsPerDmi = activeDmiCount + newDmiCount > 0 ? parseFloat((achievedSheetsInPeriod / (activeDmiCount + newDmiCount)).toFixed(1)) : 0
    let rawPointsMultiplier = 1
    if (averageSheetsPerDmi < 15) rawPointsMultiplier = 0.15
    else if (averageSheetsPerDmi < 40) rawPointsMultiplier = 0.5
    const finalRawPoints = Math.round(totalRawPoints * rawPointsMultiplier)
    const newEnrolledPoints = newDmiCount * 10

    const tierMap = { 'Base Tier': 1, Bronze: 2, Silver: 3, Gold: 4, Titanium: 5 }
    const normalizeChangeType = (value) => String(value || '').trim().toLowerCase()
    const fyStartDt = new Date(`${fyStart}-04-01`)
    const fyEndDt = new Date(`${fyStart + 1}-04-01`)
    const parseTierChangeDate = (dateStr) => {
      if (!dateStr) return null
      const date = new Date(dateStr)
      return Number.isNaN(date.getTime()) ? null : date
    }

    const allUpgradeRecords = await fetchPaged((from, to) => {
      let query = supabase
        .from('tier_upgrade_performance_report')
        .select('mapped_isr, change_type, previous_tier, new_tier, tier_change_date')
        .order('tier_change_date', { ascending: false })
        .order('mapped_isr', { ascending: true })
        .order('previous_tier', { ascending: true })
        .range(from, to)
      query = query.or(buildPrefixOrFilter('mapped_isr', buildCodeAliases(employeeId)))
      return query
    })
    const tierUpgradeRecordsInFY = allUpgradeRecords.filter(row => {
      const changeDate = parseTierChangeDate(row.tier_change_date)
      return changeDate && changeDate >= fyStartDt && changeDate < fyEndDt
    })
    const qualifyingUpgrades = tierUpgradeRecordsInFY.filter(row => {
      if (normalizeChangeType(row.change_type) !== 'tier upgrade') return false
      const previousTier = normalizeTierLabel(row.previous_tier)
      const newTier = normalizeTierLabel(row.new_tier)
      const previousTierValue = tierMap[previousTier]
      const newTierValue = tierMap[newTier]
      if (previousTierValue == null || newTierValue == null) return false
      const parsed = getMonthYearFromValue(row.tier_change_date)
      return ['Silver', 'Gold', 'Titanium'].includes(newTier) && newTierValue > previousTierValue && parsed && selectedMonthKeySet.has(`${parsed.month}_${parsed.year}`)
    })
    const dmiUpdatePoints = qualifyingUpgrades.reduce((sum, row) => {
      const previousTierValue = tierMap[normalizeTierLabel(row.previous_tier)]
      const newTierValue = tierMap[normalizeTierLabel(row.new_tier)]
      return sum + ((newTierValue - previousTierValue) * 25)
    }, 0)

    const dmiData = {
      achievedPoints: finalRawPoints + newEnrolledPoints + dmiUpdatePoints,
      finalRawPoints,
      newEnrolledPoints,
      dmiUpdatePoints,
      claimedDmiCount,
      activeDmiCount,
      newDmiCount,
      tierUpgradedDmiCount: qualifyingUpgrades.length,
      averageSheetsPerDmi,
      rawPointsMultiplier,
      tierBreakdown: Object.entries(tierCountMap).map(([tier, count]) => ({ tier, activeDmiCount: count, pointsPerDmi: toNumber(tierPointsMap[tier]) })),
    }

    let monthlyVisitGoal = 0
    const tierMonthlyGoalMap = { Silver: 0, Gold: 0, Titanium: 0 }
    const activeSgtAccounts = new Set(selectedActiveEntries.map(entry => entry.account))
    const sgtGoalRows = enrollmentRowsSGT.filter(row => activeSgtAccounts.has(normalizeAccount(row.account_no)))
    sgtGoalRows.forEach(row => {
      const tier = normalizeTierLabel(row.tier)
      if (tier === 'Silver') {
        monthlyVisitGoal += 1
        tierMonthlyGoalMap.Silver += 1
      } else if (tier === 'Gold' || tier === 'Titanium') {
        monthlyVisitGoal += 2
        tierMonthlyGoalMap[tier] += 2
      }
    })
    const sgtGoal = monthlyVisitGoal * sortedPairs.length
    const uniqueDayVisitMap = new Map()
    sgtVisits.filter(v => pairMatch(v.visit_date) && activeSgtAccounts.has(normalizeAccount(v.influencer_code))).forEach(v => {
      const date = parseDateSafe(v.visit_date)
      if (!date) return
      const key = `${normalizeAccount(v.influencer_code)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`
      if (!uniqueDayVisitMap.has(key)) uniqueDayVisitMap.set(key, v)
    })
    const monthlyVisitCounts = {}
    Array.from(uniqueDayVisitMap.values()).forEach(v => {
      const date = parseDateSafe(v.visit_date)
      if (!date) return
      const mk = `${normalizeAccount(v.influencer_code)}_${date.getMonth() + 1}_${date.getFullYear()}`
      if (!monthlyVisitCounts[mk]) monthlyVisitCounts[mk] = { count: 0, tier: normalizeTierLabel(v.influencer_tier) }
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
      sgtTierBreakdown: ['Silver', 'Gold', 'Titanium'].map(tier => ({ tier, achievedVisits: tierAchievedMap[tier] || 0, goalVisits: (tierMonthlyGoalMap[tier] || 0) * sortedPairs.length })),
    }

    const warFiltered = warRows.filter(row => pairMatch(row.task_date))
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
      completed: warFiltered.filter(row => normalizeTierLabel(row.status_as_on_today) === 'closure' && isClosureWithinAllowedWindow(row.task_date, row.status_change_date)).length,
    }

    const filteredAttendance = attendanceRows.filter(row => pairMatch(row.attendance_date))
    const workingDays = filteredAttendance.filter(row => {
      const status = String(row.attendance_status || '').trim()
      return status === 'P | P' || status === '- | -'
    }).length
    const dmiSiteGoal = Math.max(workingDays - 1, 0) * 10
    const existingDmiVisitSet = new Set()
    existingDmiVisitRows.filter(v => pairMatch(v.visit_date)).forEach(v => {
      const date = parseDateSafe(v.visit_date)
      if (!date || !v.influencer_code) return
      existingDmiVisitSet.add(`${normalizeAccount(v.influencer_code)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
    })
    const newDmiVisitSet = new Set()
    newDmiVisitRows.filter(v => pairMatch(v.enrollment_date)).forEach(v => {
      const date = parseDateSafe(v.enrollment_date)
      if (!date || !v.influencer_id) return
      newDmiVisitSet.add(`${normalizeAccount(v.influencer_id)}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
    })
    const newSiteSet = new Set()
    leadDetailRows.filter(v => pairMatch(v.created_date)).forEach(v => {
      const date = parseDateSafe(v.created_date)
      if (!date || !v.lead_code) return
      newSiteSet.add(`${v.lead_code}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
    })
    const existingSiteSet = new Set()
    leadTaskRows.forEach((v, idx) => {
      const date = parseDateSafe(v.task_created_on)
      if (!date) return
      if (v.lead_id) existingSiteSet.add(`${v.lead_id}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
      else existingSiteSet.add(`nulllead_${v.id || idx}_${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`)
    })
    const dmiVisits = existingDmiVisitSet.size + newDmiVisitSet.size
    const siteVisits = newSiteSet.size + existingSiteSet.size
    const dmiSiteData = {
      visitGoal: dmiSiteGoal,
      achievedVisits: dmiVisits + siteVisits,
      dmiVisits,
      newDmiVisits: newDmiVisitSet.size,
      existingDmiVisits: existingDmiVisitSet.size,
      siteVisits,
      newSiteVisits: newSiteSet.size,
      existingSiteVisits: existingSiteSet.size,
    }

    const behaviorGoal = Math.round(sortedPairs.reduce((sum, pair) => {
      const adjustedMonthlySheetGoal = monthlyGoal * getQuarterFactor(pair.month)
      const quarterlyEquivalentGoal = adjustedMonthlySheetGoal * 3
      const monthlyBehaviorGoal = quarterlyEquivalentGoal > 1800 ? adjustedMonthlySheetGoal * 0.2 : 120
      return sum + monthlyBehaviorGoal
    }, 0))

    const sgtAchievedCapped = sgtData.visitGoal > 0 ? Math.min(sgtData.achievedVisits, sgtData.visitGoal) : 0
    const sgtPct = sgtData.visitGoal === 0 && sgtData.achievedVisits === 0 ? 100 : sgtData.visitGoal > 0 ? Math.min((sgtAchievedCapped / sgtData.visitGoal) * 100, 100) : 0
    const dmiSiteAchievedCapped = dmiSiteData.visitGoal > 0 ? Math.min(dmiSiteData.achievedVisits, dmiSiteData.visitGoal) : 0
    const dmiSitePct = dmiSiteData.visitGoal === 0 && dmiSiteData.achievedVisits === 0 ? 100 : dmiSiteData.visitGoal > 0 ? Math.min((dmiSiteAchievedCapped / dmiSiteData.visitGoal) * 100, 100) : 0
    const warCompletedCapped = warTaskData.assigned > 0 ? Math.min(warTaskData.completed, warTaskData.assigned) : 0
    const warPct = warTaskData.assigned === 0 && warTaskData.completed === 0 ? 100 : warTaskData.assigned > 0 ? Math.min((warCompletedCapped / warTaskData.assigned) * 100, 100) : 0
    const behaviorCompletion = Math.min((sgtPct * 40 / 100) + (dmiSitePct * 35 / 100) + (warPct * 25 / 100), 100)
    const behaviorPoints = behaviorGoal > 0 ? Math.min(Math.round((behaviorCompletion / 100) * behaviorGoal), behaviorGoal) : 0

    const behaviorData = {
      achievedPoints: behaviorPoints,
      goal: behaviorGoal,
      completionPercentage: Number(behaviorCompletion.toFixed(1)),
      breakdown: [
        { label: 'S/G/T Coverage', weightage: 40, value: Math.round(sgtPct), visitGoal: sgtData.visitGoal, achievedVisits: sgtAchievedCapped, actualAchievedVisits: sgtData.achievedVisits, sgtTierBreakdown: sgtData.sgtTierBreakdown },
        { label: 'DMI+Site Visits', weightage: 35, value: Math.round(dmiSitePct), visitGoal: dmiSiteData.visitGoal, achievedVisits: dmiSiteAchievedCapped, actualAchievedVisits: dmiSiteData.achievedVisits, dmiVisits: dmiSiteData.dmiVisits, newDmiVisits: dmiSiteData.newDmiVisits, existingDmiVisits: dmiSiteData.existingDmiVisits, siteVisits: dmiSiteData.siteVisits, newSiteVisits: dmiSiteData.newSiteVisits, existingSiteVisits: dmiSiteData.existingSiteVisits },
        { label: 'War Task Completion', weightage: 25, value: Math.round(warPct), assigned: warTaskData.assigned, completed: warCompletedCapped, actualCompleted: warTaskData.completed },
      ],
    }

    const totalAchieved = toNumber(sheetPoints) + toNumber(dmiData.achievedPoints) + toNumber(behaviorData.achievedPoints)
    const totalGoal = toNumber(sheetGoal) + toNumber(dmiGoal) + toNumber(behaviorData.goal)
    const totalPct = totalGoal > 0 ? Number(((totalAchieved / totalGoal) * 100).toFixed(1)) : 0

    const dgoTeam = await Promise.all(dgoTeam.map(async (dgo, index) => {
      const employeeCode = asText(dgo.employee_id)
      if (!employeeCode) {
        return { id: dgo.id || `dgo-${index}`, name: dgo.full_name || `DGO ${index + 1}`, employeeId: '', earned: 0, goal: 0, pct: 0, status: 'NOT RATED', sheetPoints: 0, sheetGoal: 0, dmiPoints: 0, dmiGoal: 0, behaviorPoints: 0, behaviorGoal: 0 }
      }
      const summary = await computeDgoDetail(employeeCode, monthYearPairs, fyStart)
      return {
        id: dgo.id || employeeCode,
        name: dgo.full_name || employeeCode,
        employeeId: employeeCode,
        earned: summary.totals.achievedPoints,
        goal: summary.totals.goalPoints,
        pct: summary.totals.percentage,
        status: summary.totals.percentage >= 100 ? 'EXCELLENT' : summary.totals.percentage >= 80 ? 'ON TRACK' : 'NOT RATED',
        sheetPoints: summary.sheetData.points,
        sheetGoal: summary.sheetData.goal,
        dmiPoints: summary.dmiData.achievedPoints,
        dmiGoal: summary.dmiGoal,
        behaviorPoints: summary.behaviorData.achievedPoints,
        behaviorGoal: summary.behaviorData.goal,
      }
    }))

    return {
      sheetData: {
        achieved: totalApprovedSheets,
        claimed: totalClaimedSheets,
        approvedSummary: totalApprovedSheets,
        points: sheetPoints,
        goal: sheetGoal,
        baseMonthlyGoal: monthlyGoal,
        brandBreakdown,
      },
      dmiGoal,
      dmiData,
      behaviorData,
      totals: { achievedPoints: totalAchieved, goalPoints: totalGoal, percentage: totalPct },
      dgoTeam,
      buddyWorkingData: { assigned: 0, completed: 0, percentage: 100 },
      teamPerformanceData: {
        achievedPoints: dgoTeam.reduce((sum, row) => sum + toNumber(row.behaviorPoints), 0),
        goalPoints: dgoTeam.reduce((sum, row) => sum + toNumber(row.behaviorGoal), 0),
      },
      sgtData,
      warTaskData,
    }
  }

  return null
}

function Badge({ children, active = false, onClick, title }) {
  return (
    <button type="button" className={`cpd-badge ${active ? 'active' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="cpd-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  )
}

function RatioGauge({ value, label, sublabel }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="cpd-ratio-gauge" style={{ background: `conic-gradient(#2563eb 0deg ${safeValue * 3.6}deg, rgba(148, 163, 184, 0.22) ${safeValue * 3.6}deg 360deg)` }}>
      <div className="cpd-ratio-gauge-inner">
        <strong>{safeValue.toFixed(1)}%</strong>
        <span>{label}</span>
        {sublabel ? <small>{sublabel}</small> : null}
      </div>
    </div>
  )
}

export default function CombinedPerformanceDashboard({
  allowedAccessTypes = ['DGO', 'ASM'],
  defaultSelectedAccessType,
  directoryTitle,
  directorySubtitle,
  cacheKey = 'combined_performance_users_v4',
}) {
  const normalizedAllowedAccessTypes = useMemo(
    () => [...new Set((allowedAccessTypes || []).map(type => String(type || '').trim()).filter(Boolean))],
    [allowedAccessTypes]
  )
  const primaryAccessType = normalizedAllowedAccessTypes[0] || 'DGO'
  const secondaryAccessType = normalizedAllowedAccessTypes[1] || normalizedAllowedAccessTypes[0] || 'ASM'
  const initialSelectedAccessType = defaultSelectedAccessType || primaryAccessType
  const currentFYStart = getCurrentFYStart()
  const fyOptions = [
    { label: `FY ${currentFYStart}-${String(currentFYStart + 1).slice(-2)}`, start: currentFYStart },
    { label: `FY ${currentFYStart - 1}-${String(currentFYStart).slice(-2)}`, start: currentFYStart - 1 },
  ]

  const [loadingUsers, setLoadingUsers] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [directoryMode, setDirectoryMode] = useState('all')
  const [selectedFYStart, setSelectedFYStart] = useState(currentFYStart)
  const [selectedQuarters, setSelectedQuarters] = useState([getCurrentQuarterKey()])
  const [selectedMonths, setSelectedMonths] = useState(['All'])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedAccessType, setSelectedAccessType] = useState(initialSelectedAccessType)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailData, setDetailData] = useState(null)
  const selectedUserRef = useRef('')
  const selectedAccessRef = useRef('DGO')

  const availableMonths = useMemo(() => {
    if (selectedQuarters.includes('All')) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    return [...new Set(selectedQuarters.flatMap(quarter => QUARTER_MONTHS[quarter] || []))].sort((a, b) => a - b)
  }, [selectedQuarters])

  const monthYearPairs = useMemo(() => {
    const months = selectedMonths.includes('All') ? availableMonths : selectedMonths.map(Number)
    return months.map(month => ({ month, year: month >= 4 ? selectedFYStart : selectedFYStart + 1 }))
  }, [selectedFYStart, availableMonths, selectedMonths])

  const selectedUser = useMemo(() => rows.find(row => row.id === selectedUserId) || null, [rows, selectedUserId])

  useEffect(() => {
    selectedUserRef.current = selectedUserId
  }, [selectedUserId])

  useEffect(() => {
    selectedAccessRef.current = selectedAccessType
  }, [selectedAccessType])

  const directoryModeOptions = useMemo(() => {
    if (normalizedAllowedAccessTypes.includes('DBM') || normalizedAllowedAccessTypes.includes('SM')) {
      return [
        { key: 'all', label: 'All', countKey: 'all' },
        { key: 'dbm', label: 'DBM', countKey: 'dgo' },
        { key: 'sm', label: 'SM', countKey: 'asm' },
        { key: 'both', label: 'Both', countKey: 'both' },
      ]
    }

    return [
      { key: 'all', label: 'All', countKey: 'all' },
      { key: 'dgo', label: 'DGO', countKey: 'dgo' },
      { key: 'asm', label: 'ASM', countKey: 'asm' },
      { key: 'both', label: 'Both', countKey: 'both' },
    ]
  }, [normalizedAllowedAccessTypes])

  const directoryStats = useMemo(() => {
    const stats = { all: rows.length, dgo: 0, asm: 0, both: 0 }
    rows.forEach(row => {
      const first = row.access_types?.includes(primaryAccessType)
      const second = row.access_types?.includes(secondaryAccessType)
      if (first) stats.dgo += 1
      if (second) stats.asm += 1
      if (first && second) stats.both += 1
    })
    return stats
  }, [rows, primaryAccessType, secondaryAccessType])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const mode = directoryMode
    return rows.filter(row => {
      const hasDgo = row.access_types?.includes(primaryAccessType)
      const hasAsm = row.access_types?.includes(secondaryAccessType)
      const matchesMode = mode === 'all'
        || (mode === 'dgo' && hasDgo)
        || (mode === 'asm' && hasAsm)
        || (mode === 'both' && hasDgo && hasAsm)
      if (!matchesMode) return false
      if (!query) return true
      return [row.full_name, row.email, row.employee_id, row.branch_name, row.access_types?.join(' ')].some(value => asText(value).toLowerCase().includes(query))
    })
  }, [rows, search, directoryMode, primaryAccessType, secondaryAccessType])

  const loadUsers = useCallback(async () => {
    try {
      setLoadingUsers(true)
      setUsersError('')
      const result = await cachedFetch(
        `${cacheKey}_${normalizedAllowedAccessTypes.join('_')}`,
        () => loadAccessUsers(normalizedAllowedAccessTypes),
        TTL.SHORT
      )
      const nextRows = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : [])
      setRows(nextRows)
      if (nextRows.length > 0) {
        const first = nextRows[0]
        const existingSelection = nextRows.find(row => row.id === selectedUserRef.current) || first
        const nextAccess = existingSelection?.access_types?.includes(selectedAccessRef.current)
          ? selectedAccessRef.current
          : (existingSelection?.access_types?.find(type => normalizedAllowedAccessTypes.includes(type)) || existingSelection?.access_types?.[0] || initialSelectedAccessType)
        setSelectedUserId(existingSelection.id)
        setSelectedAccessType(nextAccess)
      } else {
        setSelectedUserId('')
      }
    } catch (error) {
      setUsersError(error.message || 'Failed to load users')
    } finally {
      setLoadingUsers(false)
    }
  }, [cacheKey, normalizedAllowedAccessTypes, initialSelectedAccessType])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    if (!selectedUser) return
    if (!selectedUser.access_types?.includes(selectedAccessType)) {
      setSelectedAccessType(selectedUser.access_types?.find(type => normalizedAllowedAccessTypes.includes(type)) || selectedUser.access_types?.[0] || initialSelectedAccessType)
    }
  }, [selectedUser, selectedAccessType, normalizedAllowedAccessTypes, initialSelectedAccessType])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!selectedUser?.employee_id || !selectedAccessType) {
        setDetailData(null)
        return
      }

      try {
        setDetailLoading(true)
        setDetailError('')
        const useHierarchyDetail = ['ASM', 'SM', 'DBM'].includes(selectedAccessType)
        const result = useHierarchyDetail
          ? await computeAsmDetail(selectedUser.employee_id, monthYearPairs, selectedFYStart)
          : await computeDgoDetail(selectedUser.employee_id, monthYearPairs, selectedFYStart)
        if (!cancelled) setDetailData(result)
      } catch (error) {
        if (!cancelled) setDetailError(error.message || 'Failed to load performance details')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [selectedUser, selectedAccessType, selectedFYStart, monthYearPairs])

  const exportCurrentSummary = useCallback(() => {
    if (!detailData || !selectedUser) return
    const selectionLabel = buildSelectionLabel(selectedQuarters, selectedMonths)
    const fyLabel = `FY_${selectedFYStart}-${String(selectedFYStart + 1).slice(-2)}`
    const safeName = String(selectedUser.full_name || selectedUser.employee_id || 'User').replace(/[^a-z0-9]+/gi, '_')
    const fileName = `Combined_Performance_${selectedAccessType}_${safeName}_${fyLabel}_${selectionLabel}.xlsx`

    const summaryRows = [
      {
        Employee: selectedUser.employee_id || '',
        Employee_Name: selectedUser.full_name || '',
        Access_Type: selectedAccessType,
        FY: fyLabel,
        Selection: selectionLabel,
        Total_Goal_Points: detailData.totals?.goalPoints || 0,
        Total_Achieved_Points: detailData.totals?.achievedPoints || 0,
        Overall_Achievement_Percentage: detailData.totals?.percentage || 0,
      },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
    XLSX.writeFile(workbook, fileName)
  }, [detailData, selectedUser, selectedAccessType, selectedFYStart, selectedQuarters, selectedMonths])

  const accessOptions = selectedUser?.access_types || []
  const activeDirectoryPill = directoryMode === 'all' ? 'All' : directoryMode.toUpperCase()
  const userSummaryCards = [
    { label: 'All Users', value: directoryStats.all, tone: 'neutral' },
    { label: 'DGO Users', value: directoryStats.dgo, tone: 'dgo' },
    { label: 'ASM Users', value: directoryStats.asm, tone: 'asm' },
    { label: 'Both Roles', value: directoryStats.both, tone: 'both' },
  ]

  const renderDetail = () => {
    if (!selectedUser) return <div className="cpd-empty">Select a user to view DGO or ASM details.</div>
    if (detailLoading) return <div className="cpd-loading"><i className="fa-solid fa-spinner fa-spin"></i> Loading details...</div>
    if (detailError) return <div className="cpd-error">{detailError}</div>
    if (!detailData) return <div className="cpd-empty">No data available for this user.</div>

    const isHierarchyView = ['ASM', 'SM', 'DBM'].includes(selectedAccessType)
    const teamLabel = selectedAccessType === 'ASM' ? 'DGO' : selectedAccessType
    const totalSummaryRows = isHierarchyView
      ? [
          { label: 'Sheets', achieved: toNumber(detailData.sheetData?.approvedSummary), goal: toNumber(detailData.sheetData?.goal) },
          { label: 'Active DMIs', achieved: toNumber(detailData.dmiData?.activeDmiCount) + toNumber(detailData.dmiData?.newDmiCount), goal: toNumber(detailData.dmiGoal / 40) },
          { label: 'Direct Reports', achieved: detailData.dgoTeam?.length || 0, goal: detailData.dgoTeam?.length || 0 },
        ]
      : []

    const totalGoalPoints = toNumber(detailData.totals?.goalPoints)
    const totalAchievedPoints = toNumber(detailData.totals?.achievedPoints)
    const totalAchievement = totalGoalPoints > 0 ? (totalAchievedPoints / totalGoalPoints) * 100 : 0
    const teamGoalPoints = toNumber(detailData.teamPerformanceData?.goalPoints)
    const teamAchievedPoints = toNumber(detailData.teamPerformanceData?.achievedPoints)
    const teamRatio = teamGoalPoints > 0 ? (teamAchievedPoints / teamGoalPoints) * 100 : 100

    if (isHierarchyView) {
      return (
        <>
          <div className="cpd-detail-toolbar cpd-mobile-toolbar">
            <span className={`cpd-cache-pill ${detailLoading ? 'live' : 'cached'}`}>{detailLoading ? 'Live' : 'Ready'}</span>
            <button className="cpd-btn cpd-btn-secondary" onClick={loadUsers}>
              <i className="fa-solid fa-rotate-right"></i> Refresh Directory
            </button>
            <button className="cpd-btn cpd-btn-primary" onClick={exportCurrentSummary}>
              <i className="fa-solid fa-download"></i> Download Report
            </button>
          </div>

          <div className="cpd-mobile-hero">
            <div className="cpd-mobile-hero-copy">
              <p>DBM & SM performance</p>
              <h3>{selectedUser.full_name || selectedUser.employee_id}</h3>
              <span>{selectedUser.employee_id || '-'} · {selectedUser.branch_name || 'No branch'} · {teamLabel} access</span>
            </div>
            <RatioGauge
              value={teamRatio}
              label="Team ratio"
              sublabel={`${toNumber(teamAchievedPoints).toLocaleString()} / ${toNumber(teamGoalPoints).toLocaleString()}`}
            />
          </div>

          <div className="cpd-mobile-kpi-grid">
            <div className="cpd-mobile-kpi-card">
              <span>Total Achieved</span>
              <strong>{totalAchievedPoints.toLocaleString()}</strong>
            </div>
            <div className="cpd-mobile-kpi-card">
              <span>Total Goal</span>
              <strong>{totalGoalPoints.toLocaleString()}</strong>
            </div>
            <div className="cpd-mobile-kpi-card">
              <span>Overall %</span>
              <strong>{totalAchievement.toFixed(1)}%</strong>
            </div>
          </div>

          <div className="cpd-mobile-period-row">
            <div className="cpd-mobile-period-card">
              <span>Financial Year</span>
              <strong>{fyOptions.find(option => option.start === selectedFYStart)?.label || selectedFYStart}</strong>
            </div>
            <div className="cpd-mobile-period-card">
              <span>Quarter / Month</span>
              <strong>{buildSelectionLabel(selectedQuarters, selectedMonths)}</strong>
            </div>
            <div className="cpd-mobile-period-card">
              <span>Direct Reports</span>
              <strong>{detailData.dgoTeam?.length || 0}</strong>
            </div>
          </div>

          <div className="cpd-mobile-sections">
            <section className="cpd-mobile-section">
              <div className="cpd-mobile-section-header">
                <h4>Summary</h4>
                <span>{selectedAccessType}</span>
              </div>
              <div className="cpd-overview-grid">
                {totalSummaryRows.map(row => (
                  <div key={row.label} className="cpd-stat-card">
                    <span>{row.label}</span>
                    <strong>{toNumber(row.achieved).toLocaleString()}</strong>
                    <small>Goal: {toNumber(row.goal).toLocaleString()}</small>
                  </div>
                ))}
                <div className="cpd-stat-card">
                  <span>Team Performance</span>
                  <strong>{toNumber(detailData.teamPerformanceData?.achievedPoints).toLocaleString()}</strong>
                  <small>Goal: {toNumber(detailData.teamPerformanceData?.goalPoints).toLocaleString()}</small>
                </div>
              </div>
            </section>

            <section className="cpd-mobile-section">
              <div className="cpd-mobile-section-header">
                <h4>Team Snapshot</h4>
                <span>{detailData.dgoTeam?.length || 0} users</span>
              </div>
              {Array.isArray(detailData.dgoTeam) && detailData.dgoTeam.length === 0 ? (
                <div className="cpd-empty">No direct reports are mapped to this user.</div>
              ) : (
                <div className="cpd-mobile-team-list">
                  {(detailData.dgoTeam || []).map(row => (
                    <div key={row.id} className="cpd-mobile-team-card">
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.employeeId || '-'}</span>
                      </div>
                      <div>
                        <strong>{toNumber(row.pct).toFixed(1)}%</strong>
                        <span>{row.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="cpd-detail-toolbar">
          <span className={`cpd-cache-pill ${detailLoading ? 'live' : 'cached'}`}>{detailLoading ? 'Live' : 'Ready'}</span>
          <button className="cpd-btn cpd-btn-secondary" onClick={loadUsers}>
            <i className="fa-solid fa-rotate-right"></i> Refresh Directory
          </button>
          <button className="cpd-btn cpd-btn-primary" onClick={exportCurrentSummary}>
            <i className="fa-solid fa-download"></i> Download Report
          </button>
        </div>

        <div className="cpd-total-card">
          <div>
            <p>Total Achieved</p>
            <h2>{totalAchievedPoints.toLocaleString()}</h2>
          </div>
          <div>
            <p>Total Goal</p>
            <h4>{totalGoalPoints.toLocaleString()}</h4>
          </div>
          <div>
            <p>Overall %</p>
            <h4>{totalAchievement.toFixed(1)}%</h4>
          </div>
        </div>

        {isHierarchyView && (
          <div className="cpd-overview-grid">
            {totalSummaryRows.map(row => (
              <div key={row.label} className="cpd-stat-card">
                <span>{row.label}</span>
                <strong>{toNumber(row.achieved).toLocaleString()}</strong>
                <small>Goal: {toNumber(row.goal).toLocaleString()}</small>
              </div>
            ))}
            <div className="cpd-stat-card">
              <span>Team Performance</span>
              <strong>{toNumber(detailData.teamPerformanceData?.achievedPoints).toLocaleString()}</strong>
              <small>Goal: {toNumber(detailData.teamPerformanceData?.goalPoints).toLocaleString()}</small>
            </div>
          </div>
        )}

        <div className="cpd-pillars">
          <section className="cpd-pillar">
            <h4>Sheet Points</h4>
            <div className="cpd-grid3">
              <MetricCard label="Claimed Sheets" value={toNumber(detailData.sheetData?.claimed).toLocaleString()} />
              <MetricCard label="Approved Sheets" value={toNumber(detailData.sheetData?.approvedSummary).toLocaleString()} />
              <MetricCard label="Goal" value={toNumber(detailData.sheetData?.goal).toLocaleString()} />
              <MetricCard label="Points" value={toNumber(detailData.sheetData?.points).toLocaleString()} />
              <MetricCard label="Achievement" value={detailData.sheetData?.goal > 0 ? `${((detailData.sheetData.points / detailData.sheetData.goal) * 100).toFixed(1)}%` : '0.0%'} />
              {isHierarchyView && <MetricCard label="Base Monthly Goal" value={toNumber(detailData.sheetData?.baseMonthlyGoal).toLocaleString()} />}
            </div>

            <div className="cpd-subtable-wrap">
              <h5>Brand Breakdown</h5>
              {Array.isArray(detailData.sheetData?.brandBreakdown) && detailData.sheetData.brandBreakdown.length > 0 ? (
                <table className="cpd-subtable">
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
              ) : <p className="cpd-muted">No brand data.</p>}
            </div>
          </section>

          <section className="cpd-pillar">
            <h4>DMI Points</h4>
            <div className="cpd-grid3">
              <MetricCard label="Claimed DMIs" value={toNumber(detailData.dmiData?.claimedDmiCount).toLocaleString()} />
              <MetricCard label="Active DMIs" value={toNumber(detailData.dmiData?.activeDmiCount).toLocaleString()} />
              <MetricCard label="Goal" value={toNumber(detailData.dmiGoal).toLocaleString()} />
              <MetricCard label="Achieved Points" value={toNumber(detailData.dmiData?.achievedPoints).toLocaleString()} />
              <MetricCard label="New DMI Points" value={toNumber(detailData.dmiData?.newEnrolledPoints).toLocaleString()} />
              <MetricCard label="Tier Upgrade Points" value={toNumber(detailData.dmiData?.dmiUpdatePoints).toLocaleString()} />
            </div>

            <div className="cpd-subtable-wrap">
              <h5>Tier Breakdown</h5>
              {Array.isArray(detailData.dmiData?.tierBreakdown) ? (
                <table className="cpd-subtable">
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
              ) : null}
            </div>
          </section>

          <section className="cpd-pillar">
            <h4>Behavior Points</h4>
            <div className="cpd-grid3">
              <MetricCard label="Achieved Points" value={toNumber(detailData.behaviorData?.achievedPoints).toLocaleString()} />
              <MetricCard label="Goal" value={toNumber(detailData.behaviorData?.goal).toLocaleString()} />
              <MetricCard label="Completion" value={`${toNumber(detailData.behaviorData?.completionPercentage).toFixed(1)}%`} />
              {isHierarchyView && <MetricCard label="SGT Achieved / Goal" value={`${toNumber(detailData.sgtData?.achievedVisits)} / ${toNumber(detailData.sgtData?.visitGoal)}`} />}
              {isHierarchyView && <MetricCard label="WAR Completed / Assigned" value={`${toNumber(detailData.warTaskData?.completed)} / ${toNumber(detailData.warTaskData?.assigned)}`} />}
              {isHierarchyView && <MetricCard label="Team Perf Points" value={`${toNumber(detailData.teamPerformanceData?.achievedPoints)} / ${toNumber(detailData.teamPerformanceData?.goalPoints)}`} />}
            </div>

            <div className="cpd-subtable-wrap">
              <h5>Behavior Breakdown</h5>
              <table className="cpd-subtable">
                <thead><tr><th>Metric</th><th>Weightage</th><th>Value</th><th>Achieved</th><th>Goal</th></tr></thead>
                <tbody>
                  {(detailData.behaviorData?.breakdown || []).map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.label}</td>
                      <td>{row.weightage}%</td>
                      <td>{toNumber(row.value).toLocaleString()}%</td>
                      <td>{toNumber(row.actualAchievedVisits ?? row.achievedVisits ?? row.completed ?? row.achievedPoints).toLocaleString()}</td>
                      <td>{toNumber(row.visitGoal ?? row.assigned ?? row.goalPoints).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(detailData.behaviorData?.breakdown || []).filter(row => row.label === 'S/G/T Coverage' && Array.isArray(row.sgtTierBreakdown) && row.sgtTierBreakdown.length > 0).map((row, idx) => (
                <div key={`sgt-${idx}`} className="cpd-subtable-wrap cpd-nested">
                  <h5>S/G/T Tier-wise Breakdown</h5>
                  <table className="cpd-subtable">
                    <thead><tr><th>Tier</th><th>Achieved</th><th>Goal</th></tr></thead>
                    <tbody>
                      {row.sgtTierBreakdown.map((tierRow, tierIdx) => (
                        <tr key={tierIdx}>
                          <td>{tierRow.tier}</td>
                          <td>{toNumber(tierRow.achievedVisits).toLocaleString()}</td>
                          <td>{toNumber(tierRow.goalVisits).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              {(detailData.behaviorData?.breakdown || []).filter(row => row.label === 'DMI+Site Visits').map((row, idx) => (
                <div key={`dmisite-${idx}`} className="cpd-subtable-wrap cpd-nested">
                  <h5>DMI + Site Visits Bifurcation</h5>
                  <table className="cpd-subtable">
                    <thead><tr><th>Type</th><th>New</th><th>Existing</th><th>Total</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>DMI Visits</td>
                        <td>{toNumber(row.newDmiVisits).toLocaleString()}</td>
                        <td>{toNumber(row.existingDmiVisits).toLocaleString()}</td>
                        <td>{toNumber(row.dmiVisits).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td>Site Visits</td>
                        <td>{toNumber(row.newSiteVisits).toLocaleString()}</td>
                        <td>{toNumber(row.existingSiteVisits).toLocaleString()}</td>
                        <td>{toNumber(row.siteVisits).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td><strong>Total Visits</strong></td>
                        <td>{(toNumber(row.newDmiVisits) + toNumber(row.newSiteVisits)).toLocaleString()}</td>
                        <td>{(toNumber(row.existingDmiVisits) + toNumber(row.existingSiteVisits)).toLocaleString()}</td>
                        <td><strong>{(toNumber(row.newDmiVisits) + toNumber(row.newSiteVisits) + toNumber(row.existingDmiVisits) + toNumber(row.existingSiteVisits)).toLocaleString()}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        </div>

        {isHierarchyView && (
          <section className="cpd-pillar cpd-team-card">
            <div className="cpd-team-header">
              <div>
                <h4>{teamLabel} Team Snapshot</h4>
                <p>{detailData.dgoTeam?.length || 0} direct reports found under this user</p>
              </div>
              <div className="cpd-team-total">
                <span>Team Behavior</span>
                <strong>{toNumber(detailData.teamPerformanceData?.achievedPoints).toLocaleString()} / {toNumber(detailData.teamPerformanceData?.goalPoints).toLocaleString()}</strong>
              </div>
            </div>

            {Array.isArray(detailData.dgoTeam) && detailData.dgoTeam.length === 0 ? (
              <div className="cpd-empty">No direct reports are mapped to this user in the hierarchy.</div>
            ) : (
              <div className="cpd-table-wrap">
                <table className="cpd-subtable cpd-team-table">
                  <thead>
                    <tr>
                      <th>{teamLabel}</th>
                      <th>Employee ID</th>
                      <th>Total Earned</th>
                      <th>Total Goal</th>
                      <th>Achievement %</th>
                      <th>Status</th>
                      <th>Sheet</th>
                      <th>DMI</th>
                      <th>Behavior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailData.dgoTeam || []).map(row => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.employeeId || '-'}</td>
                        <td>{toNumber(row.earned).toLocaleString()}</td>
                        <td>{toNumber(row.goal).toLocaleString()}</td>
                        <td>{toNumber(row.pct).toFixed(1)}%</td>
                        <td>{row.status}</td>
                        <td>{toNumber(row.sheetPoints).toLocaleString()}</td>
                        <td>{toNumber(row.dmiPoints).toLocaleString()}</td>
                        <td>{toNumber(row.behaviorPoints).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </>
    )
  }

  const currentSelectionLabel = selectedUser ? selectedUser.full_name : 'Select a user'
  const directoryAccessLabel = directorySubtitle || `users with ${normalizedAllowedAccessTypes.join('/')} access`
  const directoryHeaderTitle = directoryTitle || 'Users'

  return (
    <main className="cpd-main">
      <div className="cpd-scroll">
        <section className="cpd-header">
          <div className="cpd-header-copy">
            <div className="cpd-header-stats">
              {userSummaryCards.map(card => (
                <div key={card.label} className={`cpd-stat-chip ${card.tone}`}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
          </div>
          <button className="cpd-refresh" onClick={loadUsers} disabled={loadingUsers}>
            <i className={`fa-solid fa-rotate-right ${loadingUsers ? 'fa-spin' : ''}`}></i>
            Refresh Directory
          </button>
        </section>

        <section className="cpd-filter-row">
          <div className="cpd-filter-group cpd-filter-group-inline">
            <label>Financial Year</label>
            <select value={selectedFYStart} onChange={e => setSelectedFYStart(Number(e.target.value))}>
              {fyOptions.map(option => <option key={option.start} value={option.start}>{option.label}</option>)}
            </select>
          </div>

          <div className="cpd-filter-group cpd-filter-group-inline cpd-quarter-group">
            <label>Quarter / Month</label>
            <div className="cpd-inline-filters cpd-quarter-month">
              <select value={selectedQuarters.includes('All') ? 'All' : selectedQuarters[0] || 'All'} onChange={e => {
                const value = e.target.value
                if (value === 'All') {
                  setSelectedQuarters(['All'])
                  setSelectedMonths(['All'])
                  return
                }
                setSelectedQuarters([value])
                setSelectedMonths(['All'])
              }}>
                <option value="All">All Quarters</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>

              <select value={selectedMonths.includes('All') ? 'All' : String(selectedMonths[0] || 'All')} onChange={e => {
                const value = e.target.value
                if (value === 'All') {
                  setSelectedMonths(['All'])
                  return
                }
                setSelectedMonths([value])
              }}>
                <option value="All">All Months</option>
                {availableMonths.map(month => <option key={month} value={String(month)}>{MONTH_LABELS[month]}</option>)}
              </select>
            </div>
          </div>

          <div className="cpd-filter-group cpd-filter-group-inline cpd-filter-action">
            <label>Report</label>
            <button className="cpd-btn cpd-btn-secondary" onClick={() => detailData && exportCurrentSummary()} disabled={!detailData}>
              <i className="fa-solid fa-file-arrow-down"></i>
              Download Report
            </button>
          </div>
        </section>

        {usersError && <div className="cpd-error-banner"><i className="fa-solid fa-triangle-exclamation"></i>{usersError}</div>}

        <section className="cpd-shell">
          <aside className="cpd-directory">
            <div className="cpd-directory-header">
              <div>
                <h3>{directoryHeaderTitle}</h3>
                <p>{filteredRows.length} {directoryAccessLabel}</p>
              </div>
              <div className="cpd-directory-count">{filteredRows.length}</div>
            </div>

            <div className="cpd-filter-chips">
              {directoryModeOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  className={`cpd-filter-chip ${directoryMode === option.key ? 'active' : ''}`}
                  onClick={() => setDirectoryMode(option.key)}
                >
                  {option.label} <span>{directoryStats[option.countKey] ?? directoryStats.all}</span>
                </button>
              ))}
            </div>

            <div className="cpd-search">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email, employee ID, branch" />
            </div>

            {loadingUsers ? (
              <div className="cpd-state"><i className="fa-solid fa-spinner fa-spin"></i> Loading users...</div>
            ) : filteredRows.length === 0 ? (
              <div className="cpd-state">No users found.</div>
            ) : (
              <div className="cpd-list">
                {filteredRows.map(row => {
                  const selected = row.id === selectedUserId
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`cpd-row ${selected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedUserId(row.id)
                        setSelectedAccessType(row.access_types?.includes(selectedAccessType) ? selectedAccessType : (row.access_types?.[0] || 'DGO'))
                      }}
                    >
                      <div className="cpd-row-top">
                        <div>
                          <div className="cpd-row-name">{row.full_name || 'Unknown User'}</div>
                          <div className="cpd-row-sub">{row.employee_id || '-'} | {row.email || '-'}</div>
                        </div>
                        <div className="cpd-row-badges">
                          {(row.access_types || []).map(type => (
                            <span key={type} className={`cpd-chip ${type.toLowerCase()}`}>{type}</span>
                          ))}
                        </div>
                      </div>
                      <div className="cpd-row-footer">
                        <span>{row.branch_name || 'No branch assigned'}</span>
                        <span>{row.access_types?.length || 0} access type(s)</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </aside>

          <section className="cpd-detail">
            <div className="cpd-detail-header">
              <div>
                <h3>{currentSelectionLabel}</h3>
                <p>{selectedUser ? `${selectedUser.employee_id || '-'} | ${selectedUser.email || '-'} | ${selectedUser.branch_name || 'No branch'}` : 'Select a user from the list.'}</p>
                {selectedUser && (
                  <div className="cpd-detail-meta">
                    <span>{selectedUser.branch_name || 'No branch assigned'}</span>
                    <span>{activeDirectoryPill}</span>
                    <span>{accessOptions.length} access type(s)</span>
                  </div>
                )}
              </div>

              {selectedUser && accessOptions.length > 0 && (
                <div className="cpd-access-switcher" role="tablist" aria-label="Access type selector">
                  {accessOptions.map(type => (
                    <Badge key={type} active={selectedAccessType === type} onClick={() => setSelectedAccessType(type)} title={`View ${type} performance`}>
                      {type}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {renderDetail()}
          </section>
        </section>
      </div>
    </main>
  )
}
