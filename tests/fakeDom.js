/**
 * A minimal DOM, just large enough to drive menuSelect.js in Node.
 *
 * The dropdown's bugs live in event propagation — which handler runs first,
 * what a listener sees on the event — so the parts modelled faithfully are
 * the tree, bubbling from a target up to the document, and composedPath.
 * Layout is stubbed: menuSelect only measures to position the panel, and
 * position is not what these tests are about.
 */

/** Matches the simple selectors menuSelect.js uses: .class, [attr="v"], tag. */
function matches(element, selector) {
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  const attribute = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attribute) return element.getAttribute(attribute[1]) === attribute[2];
  return element.tagName === selector.toUpperCase();
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.id = '';
    this.hidden = false;
    this.title = '';
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.ownText = '';

    // Layout stubs. Fixed values keep reposition() deterministic.
    this.offsetHeight = 200;
    this.offsetWidth = 160;
    this.scrollHeight = 200;

    // Observability for assertions.
    this.focusCount = 0;
    this.scrollIntoViewCount = 0;
  }

  /* --------------------------------------------------------------- tree */

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  get children() {
    return this.childNodes;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.isDocument === true;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  /** Self, then every ancestor, up to and including the document. */
  path() {
    const nodes = [];
    let node = this;
    while (node) {
      nodes.push(node);
      node = node.parentNode;
    }
    return nodes;
  }

  /* ---------------------------------------------------------- selectors */

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const found = [];
    for (const child of this.childNodes) {
      if (child.nodeType === 3) continue;
      if (matches(child, selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }

  closest(selector) {
    let node = this;
    while (node && node.nodeType !== 9) {
      if (node.tagName && matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* --------------------------------------------------------- attributes */

  setAttribute(name, value) {
    if (name === 'class') { this.className = value; return; }
    if (name === 'id') { this.id = String(value); return; }
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get className() {
    return [...this.classes].join(' ');
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    return {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (next) this.classes.add(name);
        else this.classes.delete(name);
        return next;
      },
    };
  }

  /* -------------------------------------------------------------- text */

  get textContent() {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this.ownText = String(value);
  }

  /* ------------------------------------------------------------ layout */

  getBoundingClientRect() {
    return {
      top: 100, left: 40, width: 160, height: 32, bottom: 132, right: 200,
    };
  }

  scrollIntoView() {
    this.scrollIntoViewCount += 1;
  }

  focus() {
    this.focusCount += 1;
    const root = this.path().at(-1);
    if (root.isDocument) root.activeElement = this;
  }

  /* ------------------------------------------------------------ events */

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.isDocument = true;
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

/**
 * Build an event carrying only what menuSelect.js reads.
 *
 * @param {string} type
 * @param {object} [init] - pointerType, button, key, modifier flags.
 */
export function makeEvent(type, init = {}) {
  const event = {
    type, button: 0, defaultPrevented: false, propagationStopped: false, ...init,
  };
  event.preventDefault = () => { event.defaultPrevented = true; };
  event.stopPropagation = () => { event.propagationStopped = true; };
  return event;
}

/**
 * Dispatch `event` at `node` and bubble it to the document.
 *
 * @param {FakeElement} node - where the event is dispatched.
 * @param {object} event
 * @param {{ retargetTo?: FakeElement }} [options] - retargetTo sets
 *   event.target to something other than `node` while leaving the composed
 *   path built from `node`. That is the shape of the Safari bug: the path is
 *   truthful about what was pressed, event.target is not.
 */
export function dispatch(node, event, { retargetTo } = {}) {
  const path = node.path();
  event.target = retargetTo ?? node;
  event.composedPath = () => path;

  for (const current of path) {
    if (event.propagationStopped) break;
    event.currentTarget = current;
    for (const handler of [...(current.listeners.get(event.type) ?? [])]) {
      handler.call(current, event);
    }
  }
  return event;
}

/**
 * Install a fresh document plus the globals menuSelect.js touches.
 *
 * requestAnimationFrame records callbacks without running them: the module's
 * anchor tracker re-arms itself every frame, so running them would spin.
 *
 * @returns {FakeDocument}
 */
export function installFakeDom() {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return document;
}
