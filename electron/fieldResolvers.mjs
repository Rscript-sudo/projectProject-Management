const WEATHER_CODES = new Map([
  [0, '晴'], [1, '大部晴朗'], [2, '多云'], [3, '阴'], [45, '雾'], [48, '雾凇'],
  [51, '小毛毛雨'], [53, '毛毛雨'], [55, '强毛毛雨'], [56, '冻毛毛雨'], [57, '强冻毛毛雨'],
  [61, '小雨'], [63, '中雨'], [65, '大雨'], [66, '冻雨'], [67, '强冻雨'],
  [71, '小雪'], [73, '中雪'], [75, '大雪'], [77, '雪粒'],
  [80, '小阵雨'], [81, '阵雨'], [82, '强阵雨'], [85, '小阵雪'], [86, '强阵雪'],
  [95, '雷阵雨'], [96, '雷阵雨伴小冰雹'], [99, '雷阵雨伴大冰雹'],
])

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveBusinessDate(input = '') {
  const text = String(input || '')
  const exact = text.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/)
  if (exact) return `${exact[1]}-${String(exact[2]).padStart(2, '0')}-${String(exact[3]).padStart(2, '0')}`
  const today = new Date()
  if (/昨天|昨日/.test(text)) today.setDate(today.getDate() - 1)
  else if (/前天/.test(text)) today.setDate(today.getDate() - 2)
  return localIsoDate(today)
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export function buildLocationCandidates(location = '') {
  const source = String(location || '').trim()
  if (!source) return []
  const candidates = [source]
  const divisions = source.match(/[^省市区县]+?(?:特别行政区|自治区|自治州|省|市|地区|盟|县|区|旗)/g) || []
  // 城市级名称通常比完整中文行政区串更容易命中，也比区县同名结果更稳定。
  const ranked = [
    ...divisions.filter(item => /(?:市|自治州|地区|盟)$/.test(item)),
    ...divisions.filter(item => /(?:县|区|旗)$/.test(item)),
    ...divisions.filter(item => /(?:省|自治区|特别行政区)$/.test(item)),
  ]
  for (const item of ranked) {
    candidates.push(item, item.replace(/特别行政区|自治区|自治州|地区|省|市|县|区|盟|旗$/u, ''))
  }
  candidates.push(source.replace(/特别行政区|自治区|自治州|地区|省|市|县|区|盟|旗$/u, ''))
  return [...new Set(candidates.map(item => item.trim()).filter(item => item.length >= 2))]
}

async function geocode(location) {
  for (const candidate of buildLocationCandidates(location)) {
    const params = new URLSearchParams({ name: candidate, count: '1', language: 'zh', format: 'json' })
    const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
    const match = data?.results?.[0]
    if (!match) continue
    return {
      latitude: match.latitude,
      longitude: match.longitude,
      label: [match.name, match.admin2, match.admin1, match.country].filter(Boolean).join('，'),
      timezone: match.timezone || 'auto',
      matchedBy: candidate,
    }
  }
  return null
}

async function queryDailyWeather(coordinates, businessDate) {
  const today = localIsoDate()
  const historical = businessDate < today
  const baseUrl = historical
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast'
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    start_date: businessDate,
    end_date: businessDate,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: coordinates.timezone || 'auto',
  })
  const data = await fetchJson(`${baseUrl}?${params}`)
  const code = data?.daily?.weather_code?.[0]
  const max = data?.daily?.temperature_2m_max?.[0]
  const min = data?.daily?.temperature_2m_min?.[0]
  if (code == null && max == null && min == null) return null
  return {
    weather: WEATHER_CODES.get(Number(code)) || `天气代码${code}`,
    temperature: Number.isFinite(Number(min)) && Number.isFinite(Number(max)) ? `${min}～${max}℃` : '',
    kind: historical ? '历史再分析数据' : businessDate === today ? '当日气象数据' : '天气预报',
    modelTimezone: data?.timezone || coordinates.timezone || 'auto',
  }
}

export async function resolveAutomaticTemplateFields({ input = '', project = {}, fields = [] } = {}) {
  const requested = new Set((fields || []).map(value => String(value || '').trim()))
  const values = {}
  const provenance = {}
  const warnings = []
  const businessDate = resolveBusinessDate(input)

  if (requested.has('日期')) {
    values.日期 = businessDate.replace(/-(\d{2})-(\d{2})$/, '年$1月$2日')
    provenance.日期 = { source: /今天|昨日|昨天|前天|20\d{2}[年/-]/.test(input) ? 'user-input' : 'system-date', businessDate }
  }
  if (requested.has('星期几')) {
    const date = new Date(`${businessDate}T12:00:00`)
    values.星期几 = `星期${'日一二三四五六'[date.getDay()]}`
    provenance.星期几 = { source: 'computed', businessDate }
  }

  const weatherFields = [...requested].filter(field => /天气/.test(field))
  const temperatureFields = [...requested].filter(field => /气温|温度/.test(field))
  const needsWeather = weatherFields.length > 0 || temperatureFields.length > 0
  const userAlreadyProvidedWeather = /(?:天气|气象)[为：:]?\s*(晴|多云|阴|雨|雪|雾|霾)|-?\d+(?:\.\d+)?\s*℃/.test(input)
  const location = String(project.implementationArea || project.projectAddress || '').trim()
  if (needsWeather && !userAlreadyProvidedWeather) {
    if (!location) {
      warnings.push('项目未配置实施区域，天气和气温无法自动查询')
    } else {
      try {
        const coordinates = await geocode(location)
        if (!coordinates) {
          warnings.push(`未能定位项目实施区域“${location}”`)
        } else {
          const weather = await queryDailyWeather(coordinates, businessDate)
          if (!weather) {
            warnings.push(`未取得 ${businessDate} 的天气数据`)
          } else {
            for (const field of weatherFields) values[field] = weather.weather
            for (const field of temperatureFields) values[field] = weather.temperature
            const source = {
              source: 'Open-Meteo', businessDate, location: coordinates.label,
              latitude: coordinates.latitude, longitude: coordinates.longitude, dataKind: weather.kind,
              matchedBy: coordinates.matchedBy,
              queriedAt: new Date().toISOString(),
            }
            for (const field of [...weatherFields, ...temperatureFields]) {
              if (values[field]) provenance[field] = source
            }
          }
        }
      } catch (error) {
        warnings.push(`天气自动查询失败：${error?.name === 'AbortError' ? '请求超时' : error?.message || String(error)}`)
      }
    }
  }
  return { success: true, businessDate, values, provenance, warnings }
}
