// 在当前文档里找到卡号 / 有效期 / CVV / 持卡人输入框并填值。
// 不依赖扩展 API，所以可以单独测试：window.__fanboxFill(data) -> { number, expiry, cvv, holder }
;(() => {
  const visible = (el) =>
    el.type !== 'hidden' && !el.disabled && el.getClientRects().length > 0

  const labelText = (el) =>
    [...(el.labels || [])].map((l) => l.textContent).join(' ')

  const hint = (el) =>
    [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      labelText(el),
    ]
      .join(' ')
      .toLowerCase()

  // 受控组件（React 等）要走原生 setter，再派发事件，否则值会被还原
  const setValue = (el, value) => {
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    for (const type of ['input', 'change', 'blur'])
      el.dispatchEvent(new Event(type, { bubbles: true }))
  }

  const PATTERNS = {
    number: /card.?(number|num|no)\b|cardnumber|カード番号|卡号/,
    // 注意不要单独匹配 mm / yy：占位符 "MM/YY" 属于合并的有效期框
    month: /exp.?month|expiry.?month|有効期限.*月|有效期.*月/,
    year: /exp.?year|expiry.?year|有効期限.*年|有效期.*年/,
    expiry: /exp|有効期限|有效期|mm\s*\/\s*yy/,
    cvv: /cvc|cvv|csc|security.?code|セキュリティコード|安全码/,
    holder: /holder|name.?on.?card|名義|持卡人/,
  }
  const AUTOCOMPLETE = {
    number: 'cc-number',
    month: 'cc-exp-month',
    year: 'cc-exp-year',
    expiry: 'cc-exp',
    cvv: 'cc-csc',
    holder: 'cc-name',
  }

  function fill(data) {
    const inputs = [...document.querySelectorAll('input, select')].filter(
      visible
    )
    const used = new Set()
    const find = (kind) => {
      const el =
        inputs.find(
          (e) =>
            !used.has(e) &&
            (e.autocomplete || '').split(/\s+/).includes(AUTOCOMPLETE[kind])
        ) ||
        inputs.find((e) => !used.has(e) && PATTERNS[kind].test(hint(e)))
      if (el) used.add(el)
      return el
    }

    const [mm = '', yy = ''] = String(data.expiry || '').split('/')
    const year2 = yy.slice(-2)
    const year4 = yy.length === 2 ? `20${yy}` : yy
    const report = { number: false, expiry: false, cvv: false, holder: false }

    const number = find('number')
    if (number) {
      setValue(number, data.number)
      report.number = true
    }

    const month = find('month')
    const year = find('year')
    if (month && year) {
      const put = (el, candidates) => {
        if (el instanceof HTMLSelectElement) {
          const opt = [...el.options].find((o) =>
            candidates.some(
              (c) => o.value === c || o.textContent.trim() === c
            )
          )
          if (opt) setValue(el, opt.value)
          return !!opt
        }
        setValue(el, candidates[0])
        return true
      }
      const a = put(month, [mm.padStart(2, '0'), String(Number(mm))])
      const b = put(year, [year4, year2])
      report.expiry = a && b
    } else {
      const expiry = find('expiry')
      if (expiry) {
        const compact = expiry.maxLength === 4
        setValue(expiry, compact ? `${mm}${year2}` : `${mm}/${year2}`)
        report.expiry = true
      }
    }

    const cvv = find('cvv')
    if (cvv) {
      setValue(cvv, data.cvv)
      report.cvv = true
    }
    const holder = find('holder')
    if (holder && data.holder) {
      setValue(holder, data.holder)
      report.holder = true
    }
    return report
  }

  window.__fanboxFill = fill
})()
