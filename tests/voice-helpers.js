// Voice mode, driven through a fake SpeechRecognition installed before
// app.js runs. The queue logic behind "click ahead, grade behind" is the
// most intricate code in the game and the least testable by hand — you
// cannot say "brazil india" into a headless browser, and a human checking
// it has to talk to their laptop for every regression.
//
// The fake is deliberately shaped like the real thing: results arrive as
// a cumulative list with a resultIndex, interims precede finals, and
// start()/stop() throw when they're called in the wrong state, because
// the app relies on all three.

const { expect } = require('@playwright/test');

// Installed before any page script, so `window.SpeechRecognition` exists
// by the time app.js reads it. Everything the tests need to see is parked
// on window.__voice.
async function stubVoice(page) {
  await page.addInitScript(() => {
    const log = { streams: [], gum: 0 };

    class FakeRecognition {
      constructor() {
        this.running = false;
        window.__voice.rec = this;
      }
      start() {
        if (this.running) throw new Error('already started');
        this.running = true;
        log.starts = (log.starts || 0) + 1;
        this.onstart?.({});
      }
      stop() {
        if (!this.running) return;
        this.running = false;
        this.onend?.({});
      }
      abort() { this.stop(); }
    }

    window.SpeechRecognition = FakeRecognition;
    delete window.webkitSpeechRecognition;

    // A silent but genuine MediaStream, so the meter's capture/teardown
    // path is the real one — live tracks that something has to stop.
    // The delay matters: a real getUserMedia resolves well after the click
    // that asked for it, and that gap is the whole bug being guarded here.
    navigator.mediaDevices.getUserMedia = async () => {
      log.gum++;
      await new Promise(r => setTimeout(r, 60));
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.connect(dst);
      osc.start();
      log.streams.push(dst.stream);
      return dst.stream;
    };

    window.__voice = {
      rec: null,
      log,
      // Push one recognition result, the way the browser does: the whole
      // list so far, plus the index of what's new.
      say(text, isFinal = true) {
        const rec = window.__voice.rec;
        if (!rec || !rec.running) return false;   // nothing is listening
        const results = window.__voice._results || (window.__voice._results = []);
        const entry = [{ transcript: text, confidence: 0.9 }];
        entry.isFinal = isFinal;
        const idx = results.length;
        results.push(entry);
        results.length = results.length;
        rec.onresult?.({ resultIndex: idx, results });
        if (isFinal) window.__voice._results = [];
        return true;
      },
      // How many captures were handed out but never shut down.
      liveStreams() {
        return log.streams.filter(s => s.getTracks().some(t => t.readyState === 'live')).length;
      },
    };
  });
}

async function boot(page) {
  await stubVoice(page);
  await page.goto('/');
  await page.locator('#hello-close').click();
  await expect(page.locator('#map svg')).toBeAttached();
  await expect.poll(() => page.locator('#hit-layer path').count()).toBeGreaterThan(150);
}

// Same trick as smoke.spec.js: ask the page which country a click at a
// given point would actually hit, rather than trusting the bounding box.
async function clickCountry(page, code) {
  const pt = await page.evaluate((code) => {
    const r = document.querySelector(`#map svg path#${code}`).getBoundingClientRect();
    for (let fy = 0.25; fy <= 0.75; fy += 0.05) {
      for (let fx = 0.25; fx <= 0.75; fx += 0.05) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const t = document.elementFromPoint(x, y)?.closest?.('[data-code], path[id]');
        if ((t?.dataset?.code || t?.id) === code) return { x, y };
      }
    }
    return null;
  }, code);
  expect(pt, `no clickable point found inside ${code}`).not.toBeNull();
  await page.mouse.click(pt.x, pt.y);
}

module.exports = { stubVoice, boot, clickCountry };
