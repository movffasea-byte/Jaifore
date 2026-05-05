/* ============================================
   JAIFORE — main.js
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- NAVBAR SCROLL EFFECT ---------- */
  const navbar = document.getElementById('navbar');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });


  /* ---------- HAMBURGER MENU ---------- */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinks.classList.toggle('open');
  });

  // Close menu when a link is clicked
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
    });
  });


  /* ---------- HERO ENTRANCE ANIMATIONS ---------- */
  // Trigger after a short delay so fonts are loaded
  setTimeout(() => {
    const badge  = document.querySelector('.badge');
    const title  = document.querySelector('.htitle');
    const desc   = document.querySelector('.hdesc');
    const btns   = document.querySelector('.hbtns');
    const heroImg = document.getElementById('heroImg');

    [badge, title, desc, btns, heroImg].forEach(el => {
      if (el) el.classList.add('visible');
    });
  }, 100);


  /* ---------- SCROLL-TRIGGERED FADE-IN ---------- */
  const fadeEls = document.querySelectorAll('.fcard');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el    = entry.target;
          const delay = parseInt(el.dataset.delay || '0', 10);
          setTimeout(() => el.classList.add('visible'), delay);
          observer.unobserve(el);
        }
      });
    },
    { threshold: 0.15 }
  );

  fadeEls.forEach(el => observer.observe(el));


  /* ---------- SMOOTH SCROLL FOR CTA BUTTONS ---------- */
  function scrollTo(targetId) {
    const target = document.querySelector(targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const heroStart = document.getElementById('heroStart');
  if (heroStart) {
    heroStart.addEventListener('click', () => scrollTo('#services'));
  }

  const heroLearn = document.getElementById('heroLearn');
  if (heroLearn) {
    heroLearn.addEventListener('click', () => scrollTo('#about'));
  }

  const ctaBtn = document.getElementById('ctaBtn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', () => scrollTo('#work'));
  }

  const ctaBannerBtn = document.getElementById('ctaBannerBtn');
  if (ctaBannerBtn) {
    ctaBannerBtn.addEventListener('click', () => {
      // Replace with your actual contact link or modal trigger
      alert('Contact form coming soon!');
    });
  }


  /* ---------- ACTIVE NAV LINK ON SCROLL ---------- */
  const sections  = document.querySelectorAll('section[id], footer');
  const navLinkEls = document.querySelectorAll('.nav-link');

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinkEls.forEach(link => {
            link.classList.toggle(
              'active',
              link.getAttribute('href') === `#${id}`
            );
          });
        }
      });
    },
    { threshold: 0.4 }
  );

  sections.forEach(sec => sectionObserver.observe(sec));

});