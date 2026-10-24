// Installed in the page (by driver.cjs and packaged.mjs): find elements the way a user would, by visible text
// or field label, and fire the events React listens to.
module.exports = `
  window.__e2e = {
    hasText: (t) => document.body.textContent.includes(t),
    clickText: (t) => {
      const els = [...document.querySelectorAll('button, [role=button], [role=tab], li, div, span, p, h5, h6')]
        .filter((e) => e.textContent.trim() === t);
      const el = els[els.length - 1];
      if (!el) return false;
      el.click();
      return true;
    },
    fill: (label, value) => {
      const clean = (s) => s.replace(/[\\s*\\u2009]+$/u, '').trim();
      const labels = [...document.querySelectorAll('label')];
      const l = labels.find((x) => clean(x.textContent) === label) ||
        labels.find((x) => x.textContent.includes(label));
      const input = l && document.getElementById(l.htmlFor);
      if (!input) return false;
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    submit: () => {
      const b = [...document.querySelectorAll('button[type=submit]')].pop();
      if (!b) return false;
      b.click();
      return true;
    },
  };
  true;`;
