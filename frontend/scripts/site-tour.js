/* ================================
   JAIFORE — SITE TOUR ENGINE
   scripts/site-tour.js

   One shared engine for every page. Each page defines its own step list
   as `window.JAIFORE_TOUR_STEPS` (an array) and its own storage key as
   `window.JAIFORE_TOUR_KEY` (a short string) BEFORE this script tag —
   see the small inline <script> block added near the bottom of each
   page's <body> for the actual step content.

   Each page's tour is tracked separately in localStorage (keyed by
   JAIFORE_TOUR_KEY), since a user might see the Home tour today and not
   reach the Dashboard tour until weeks later once their account exists.

   Step shape:
   {
     selector: '.some-css-selector',   // element to highlight
     title:    'Short heading',
     body:     'One or two sentences of explanation.'
   }
   A step whose selector isn't found on the page (e.g. an empty cart icon
   that doesn't exist for a logged-out user) is skipped automatically
   rather than breaking the tour.
   ================================ */

(function () {
  const STORAGE_PREFIX = 'jaifore_tour_seen_';

  function init() {
    const steps = Array.isArray(window.JAIFORE_TOUR_STEPS) ? window.JAIFORE_TOUR_STEPS : [];
    const tourKey = window.JAIFORE_TOUR_KEY || 'default';
    if (!steps.length) return;

    // Flags pages with a fixed bottom-left sidebar element (currently just
    // Dashboard) so site-tour.css can reposition the relaunch button clear
    // of whatever sits in that corner on this page, e.g. the Logout button.
    if (document.querySelector('.dash-sidebar')) {
      document.body.classList.add('tour-has-sidebar');
    }

    const storageKey = STORAGE_PREFIX + tourKey;
    const alreadySeen = localStorage.getItem(storageKey) === '1';

    // Build the DOM once; only auto-open if never seen before.
    const dom = buildTourDOM();
    injectRelaunchButton(dom, steps, storageKey);

    if (!alreadySeen) {
      // Small delay so the page's own layout/animations settle first —
      // avoids highlighting an element that's still animating into place.
      setTimeout(() => startTour(dom, steps, storageKey), 500);
    }
  }

  function buildTourDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'tourOverlay';

    const maskTop = document.createElement('div');
    const maskBottom = document.createElement('div');
    const maskLeft = document.createElement('div');
    const maskRight = document.createElement('div');
    [maskTop, maskBottom, maskLeft, maskRight].forEach(el => {
      el.className = 'tour-mask-piece';
      overlay.appendChild(el);
    });

    const ring = document.createElement('div');
    ring.className = 'tour-spotlight-ring';

    const tooltip = document.createElement('div');
    tooltip.className = 'tour-tooltip';
    tooltip.style.display = 'none';
    tooltip.innerHTML = `
      <div class="tour-tooltip-step" id="tourStepLabel"></div>
      <div class="tour-tooltip-title" id="tourTitle"></div>
      <div class="tour-tooltip-body" id="tourBody"></div>
      <div class="tour-tooltip-controls">
        <div class="tour-dots" id="tourDots"></div>
        <div class="tour-btn-row">
          <button type="button" class="tour-btn tour-btn-skip" id="tourSkipBtn">Skip</button>
          <button type="button" class="tour-btn tour-btn-back" id="tourBackBtn">Back</button>
          <button type="button" class="tour-btn tour-btn-next" id="tourNextBtn">Next</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(ring);
    document.body.appendChild(tooltip);

    return {
      overlay, ring, tooltip,
      maskTop, maskBottom, maskLeft, maskRight,
      stepLabel: tooltip.querySelector('#tourStepLabel'),
      title: tooltip.querySelector('#tourTitle'),
      body: tooltip.querySelector('#tourBody'),
      dots: tooltip.querySelector('#tourDots'),
      skipBtn: tooltip.querySelector('#tourSkipBtn'),
      backBtn: tooltip.querySelector('#tourBackBtn'),
      nextBtn: tooltip.querySelector('#tourNextBtn'),
    };
  }

  function injectRelaunchButton(dom, steps, storageKey) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tour-relaunch-btn';
    btn.id = 'tourRelaunchBtn';
    btn.textContent = '✨ Show me around';
    btn.style.display = 'none'; // shown only after the tour closes at least once
    document.body.appendChild(btn);

    btn.addEventListener('click', () => startTour(dom, steps, storageKey));

    // Reveal the relaunch button once we know whether this page's tour
    // has already been dismissed (so it doesn't flash before the
    // auto-start tour has had a chance to run).
    setTimeout(() => {
      btn.style.display = 'inline-block';
    }, 600);
  }

  function startTour(dom, steps, storageKey) {
    let index = 0;
    const validSteps = steps.filter(s => document.querySelector(s.selector));
    if (!validSteps.length) return;

    dom.overlay.classList.add('open');
    dom.tooltip.style.display = 'block';
    dom.ring.style.display = 'block';
    document.getElementById('tourRelaunchBtn').style.display = 'none';

    renderStep();

    dom.skipBtn.onclick = () => endTour();
    dom.backBtn.onclick = () => { if (index > 0) { index--; renderStep(); } };
    dom.nextBtn.onclick = () => {
      if (index < validSteps.length - 1) { index++; renderStep(); }
      else { endTour(); }
    };

    window.addEventListener('resize', repositionOnResize, { passive: true });

    function repositionOnResize() {
      if (dom.overlay.classList.contains('open')) positionOn(validSteps[index]);
    }

    function renderStep() {
      const step = validSteps[index];
      dom.stepLabel.textContent = `Step ${index + 1} of ${validSteps.length}`;
      dom.title.textContent = step.title;
      dom.body.textContent = step.body;
      dom.backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
      dom.nextBtn.textContent = index === validSteps.length - 1 ? 'Finish' : 'Next';

      dom.dots.innerHTML = '';
      validSteps.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'tour-dot' + (i === index ? ' active' : '');
        dom.dots.appendChild(dot);
      });

      positionOn(step);
      const el = document.querySelector(step.selector);
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function positionOn(step) {
      const el = document.querySelector(step.selector);
      if (!el) return;
      // Slight delay lets scrollIntoView finish before measuring position
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const pad = 8;

        dom.ring.style.top = `${rect.top - pad}px`;
        dom.ring.style.left = `${rect.left - pad}px`;
        dom.ring.style.width = `${rect.width + pad * 2}px`;
        dom.ring.style.height = `${rect.height + pad * 2}px`;

        // Four mask pieces surround the cutout, leaving the ring's exact
        // rectangle (plus padding) fully visible and un-dimmed.
        const top = rect.top - pad, left = rect.left - pad;
        const bottom = rect.bottom + pad, right = rect.right + pad;
        const vw = window.innerWidth, vh = window.innerHeight;

        dom.maskTop.style.cssText    = `top:0; left:0; width:${vw}px; height:${Math.max(top,0)}px;`;
        dom.maskBottom.style.cssText = `top:${Math.max(bottom,0)}px; left:0; width:${vw}px; height:${Math.max(vh-bottom,0)}px;`;
        dom.maskLeft.style.cssText   = `top:${Math.max(top,0)}px; left:0; width:${Math.max(left,0)}px; height:${Math.max(bottom-top,0)}px;`;
        dom.maskRight.style.cssText  = `top:${Math.max(top,0)}px; left:${Math.max(right,0)}px; width:${Math.max(vw-right,0)}px; height:${Math.max(bottom-top,0)}px;`;

        // Tooltip: prefer below the element; flip above if there's no room.
        const tooltipHeight = dom.tooltip.offsetHeight || 180;
        const spaceBelow = vh - bottom;
        let tooltipTop = spaceBelow > tooltipHeight + 24 ? bottom + 16 : top - tooltipHeight - 16;
        tooltipTop = Math.max(12, Math.min(tooltipTop, vh - tooltipHeight - 12));

        const tooltipWidth = dom.tooltip.offsetWidth || 300;
        let tooltipLeft = rect.left;
        tooltipLeft = Math.max(12, Math.min(tooltipLeft, vw - tooltipWidth - 12));

        dom.tooltip.style.top = `${tooltipTop}px`;
        dom.tooltip.style.left = `${tooltipLeft}px`;
      });
    }

    function endTour() {
      dom.overlay.classList.remove('open');
      dom.tooltip.style.display = 'none';
      dom.ring.style.display = 'none';
      dom.ring.style.width = '0px';
      dom.ring.style.height = '0px';
      dom.ring.style.top = '-9999px';
      dom.ring.style.left = '-9999px';
      localStorage.setItem(storageKey, '1');
      document.getElementById('tourRelaunchBtn').style.display = 'inline-block';
      window.removeEventListener('resize', repositionOnResize);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})()