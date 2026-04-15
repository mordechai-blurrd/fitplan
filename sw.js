// FitPlan Service Worker — handles caching, scheduled notifications, snooze

const CACHE = 'fitplan-v1';
const CACHE_URLS = ['./fitplan.html', './manifest.json', './icon-192.png', './icon-512.png'];

// ── INSTALL: cache assets ──────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CACHE_URLS).catch(() => {})));
  self.skipWaiting();
});

// ── ACTIVATE: claim clients ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── FETCH: serve from cache, fallback to network ───────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});

// ── NOTIFICATION TIMERS ────────────────────────────────────────────────────
let timers = {};
let currentSchedule = null;

// ── MESSAGE from main thread ───────────────────────────────────────────────
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'SCHEDULE')  { currentSchedule = payload; scheduleAll(payload); }
  if (type === 'CANCEL')    { cancelAll(); }
  if (type === 'TEST')      { fireNotif(payload.kind, payload.workoutDesc, payload.snoozeMin); }
  if (type === 'PING')      { /* keepalive — no-op */ }
});

// ── NOTIFICATION CLICK ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { kind, workoutDesc, snoozeMin = 10 } = e.notification.data || {};

  if (e.action === 'snooze') {
    // Re-fire after snooze delay
    setTimeout(() => fireNotif(kind, workoutDesc, snoozeMin), snoozeMin * 60 * 1000);
    return;
  }

  // Open / focus the app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('fitplan.html'));
      if (existing) return existing.focus();
      return clients.openWindow('./fitplan.html');
    })
  );
});

// ── SCHEDULE HELPERS ───────────────────────────────────────────────────────
function msUntil(h, m) {
  const now = new Date();
  const t = new Date();
  t.setHours(h, m, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1); // next occurrence
  return t.getTime() - now.getTime();
}

function scheduleAll(s) {
  cancelAll();
  if (!s) return;

  function arm(kind, h, m, enabled) {
    if (!enabled) return;
    const delay = msUntil(h, m);
    timers[kind] = setTimeout(() => {
      fireNotif(kind, s.workoutDesc, s.snoozeMin);
      // Reschedule for next day
      if (currentSchedule) arm(kind, h, m, enabled);
    }, delay);
  }

  arm('morning', s.morning.h, s.morning.m, s.morning.enabled);
  arm('evening', s.evening.h, s.evening.m, s.evening.enabled);
}

function cancelAll() {
  Object.values(timers).forEach(t => clearTimeout(t));
  timers = {};
}

function fireNotif(kind, workoutDesc, snoozeMin = 10) {
  const isMorning = kind === 'morning';
  const title = isMorning ? '💪 Workout time, Mordechai!' : '🌙 Evening check-in';
  const body = isMorning
    ? `Today: ${workoutDesc || 'Check your plan'}. Open FitPlan and get it done!`
    : `Did you complete today's workout? Mark it done in FitPlan before bed!`;

  return self.registration.showNotification(title, {
    body,
    icon:  './icon-192.png',
    badge: './icon-192.png',
    tag:   `fitplan-${kind}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { kind, workoutDesc, snoozeMin },
    actions: [
      { action: 'snooze', title: `💤 Snooze ${snoozeMin}m` },
      { action: 'open',   title: '▶ Open App' }
    ]
  });
}
