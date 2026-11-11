// The site's motion, in one place. Nothing picks a curve or a length of its own.
//   Photographs travel: from the page into the viewer and back, from a cover to the head of its series.
//   Everything else fades.
//   One curve (--ease) and four lengths, named in the stylesheet: --t-quick (a hover, a press), --t-base (a fade,
//   a small change), --t-move (something crossing the screen), --t-enter (content arriving).
//   Whatever arrives, arrives the same way: up by RISE pixels while fading in, one STEP after the other.
// Scripts read the stylesheet's values rather than keeping their own. With reduced motion nothing travels or
// slides; things still fade, so a change is never a jump.
export const RISE = 12, STEP = 50;
export const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let probe = null;
function read(length) {
  probe ??= document.documentElement.appendChild(Object.assign(document.createElement("i"), { hidden: true }));
  probe.style.transition = `opacity var(--t-${length}) var(--ease)`;
  return getComputedStyle(probe);
}
export const ms = (length) => parseFloat(read(length).transitionDuration) * 1000;
export const ease = () => read("base").transitionTimingFunction;

// The one way in.
export function arrive(el, delay = 0) {
  const from = calm() ? { opacity: 0 } : { opacity: 0, transform: `translateY(${RISE}px)` };
  return el.animate([from, { opacity: 1, transform: "none" }], { duration: ms("enter"), delay, easing: ease(), fill: "backwards" });
}
