/* Dress Nation promotional banner — shows the live campaign on page load. */
(function () {
  var params = new URLSearchParams(location.search)
  var forcedPromo = params.get('promo')
  var url = '/api/campaign/live' + (forcedPromo ? '?id=' + encodeURIComponent(forcedPromo) : '')

  fetch(url, { headers: { accept: 'application/json' } })
    .then(function (r) { return r.json() })
    .then(function (c) {
      if (!c || !c.id) return
      if (new Date(c.endsAt).getTime() <= Date.now()) return
      // Show on every landing-page load while the campaign is live; closing only
      // dismisses it for this page view (it returns on the next reload).
      var forced = forcedPromo && String(c.id) === String(forcedPromo)
      showBanner(c, forced)
    })
    .catch(function () {})

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;') }

  function picture(c) {
    if (!c.desktop) return ''
    return '<picture>' +
      (c.mobile ? '<source media="(max-width:600px)" srcset="' + escAttr(c.mobile) + '">' : '') +
      '<img src="' + escAttr(c.desktop) + '" alt="' + escAttr(c.alt) + '">' +
      '</picture>'
  }

  function showBanner(c, forced) {
    var lastFocus = document.activeElement
    var back = document.createElement('div')
    back.className = 'dnb-backdrop'
    back.setAttribute('role', 'dialog')
    back.setAttribute('aria-modal', 'true')
    back.setAttribute('aria-label', c.headline || c.alt || 'Promotion')

    var card = document.createElement('div')
    card.className = 'dnb-card' + (c.type === 'photo' ? ' dnb-photo' : '')
    card.style.setProperty('--dnb-bg', c.bg || '#faf9f5')
    card.style.setProperty('--dnb-text', c.text || '#2b2724')

    var controls = '<div class="dnb-controls">' +
      '<button class="dnb-share" aria-label="Share on WhatsApp">Share</button>' +
      '<button class="dnb-close" aria-label="Close">✕</button>' +
      '</div>'

    if (c.type === 'photo') {
      var photo = c.buttonLink
        ? '<a class="dnb-photolink" href="' + escAttr(c.buttonLink) + '">' + picture(c) + '</a>'
        : picture(c)
      card.innerHTML = photo + controls
    } else {
      card.innerHTML = picture(c) +
        '<div class="dnb-body">' +
          (c.headline ? '<h2>' + esc(c.headline) + '</h2>' : '') +
          (c.subtext ? '<p>' + esc(c.subtext) + '</p>' : '') +
          (c.countdown ? '<div class="dnb-count" aria-live="polite"></div>' : '') +
          (c.buttonText && c.buttonLink ? '<a class="dnb-btn" href="' + escAttr(c.buttonLink) + '">' + esc(c.buttonText) + '</a>' : '') +
        '</div>' + controls
    }

    back.appendChild(card)
    document.body.appendChild(back)
    document.body.style.overflow = 'hidden'

    function close() {
      document.body.style.overflow = ''
      back.remove()
      document.removeEventListener('keydown', onKey)
      if (lastFocus && lastFocus.focus) lastFocus.focus()
    }
    function onKey(e) {
      if (e.key === 'Escape') close()
      if (e.key === 'Tab') { // simple focus trap
        var f = back.querySelectorAll('button, a[href]')
        if (!f.length) return
        var first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    back.addEventListener('click', function (e) { if (e.target === back) close() })
    var closeBtn = card.querySelector('.dnb-close')
    if (closeBtn) { closeBtn.addEventListener('click', close); closeBtn.focus() }
    var shareBtn = card.querySelector('.dnb-share')
    if (shareBtn) shareBtn.addEventListener('click', function () { share(c) })

    if (c.countdown) {
      var el = card.querySelector('.dnb-count')
      var iv
      var tick = function () {
        var ms = new Date(c.endsAt).getTime() - Date.now()
        if (ms <= 0) { clearInterval(iv); close(); return }
        var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
        el.textContent = 'Ends in ' + (d ? d + 'd ' : '') + h + 'h ' + mm + 'm'
      }
      tick()
      iv = setInterval(tick, 30000)
    }
  }

  function share(c) {
    var link = location.origin + '/?promo=' + c.id
    var text = (c.wa || c.headline || 'Dress Nation') + ' ' + link
    if (navigator.share) navigator.share({ text: text, url: link }).catch(function () {})
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
  }
})()
