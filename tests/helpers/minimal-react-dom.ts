type Listener = { callback: EventListenerOrEventListenerObject; capture: boolean };

export class TestEvent {
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  defaultPrevented = false;
  currentTarget: TestNode | null = null;
  target: TestNode | null = null;
  cancelBubble = false;

  constructor(readonly type: string, init: EventInit = {}) {
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.cancelBubble = true;
  }

  stopImmediatePropagation(): void {
    this.cancelBubble = true;
  }
}

export class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument;
  readonly listeners = new Map<string, Listener[]>();

  constructor(readonly nodeType: number, ownerDocument?: TestDocument) {
    this.ownerDocument = ownerDocument ?? (this as unknown as TestDocument);
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): TestNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get previousSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index > 0 ? this.parentNode.childNodes[index - 1] : null;
  }

  appendChild<T extends TestNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends TestNode>(child: T, before: TestNode | null): T {
    if (before === null) return this.appendChild(child);
    const index = this.childNodes.indexOf(before);
    if (index < 0) throw new Error("test_dom_reference_node_missing");
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild<T extends TestNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error("test_dom_child_missing");
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!callback) return;
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture });
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (!callback) return;
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((listener) => listener.callback !== callback || listener.capture !== capture));
  }

  dispatchEvent(event: TestEvent): boolean {
    event.target ??= this;
    const path: TestNode[] = [];
    for (let node: TestNode | null = this; node; node = node.parentNode) path.push(node);
    const invoke = (node: TestNode, capture: boolean) => {
      event.currentTarget = node;
      for (const listener of node.listeners.get(event.type) ?? []) {
        if (listener.capture !== capture) continue;
        if (typeof listener.callback === "function") {
          listener.callback.call(node, event as unknown as Event);
        } else {
          listener.callback.handleEvent(event as unknown as Event);
        }
        if (event.cancelBubble) return;
      }
    };
    for (const node of [...path].reverse()) {
      invoke(node, true);
      if (event.cancelBubble) return !event.defaultPrevented;
    }
    for (const node of path) {
      invoke(node, false);
      if (event.cancelBubble || !event.bubbles) break;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
}

export class TestText extends TestNode {
  constructor(public data: string, ownerDocument: TestDocument) {
    super(3, ownerDocument);
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = value;
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

export class TestComment extends TestText {
  constructor(data: string, ownerDocument: TestDocument) {
    super(data, ownerDocument);
    Object.defineProperty(this, "nodeType", { value: 8 });
  }
}

export class TestStyle {
  [key: string]: unknown;

  setProperty(name: string, value: string): void {
    this[name] = value;
  }

  removeProperty(name: string): void {
    delete this[name];
  }
}

export class TestElement extends TestNode {
  readonly attributes = new Map<string, string>();
  readonly style = new TestStyle();
  readonly namespaceURI: string;
  readonly tagName: string;
  readonly nodeName: string;
  readonly localName: string;
  disabled = false;
  selected = false;
  multiple = false;
  download = "";
  href = "";
  src = "";
  alt = "";
  name = "";
  type = "";
  clickCount = 0;
  private currentValue = "";
  private currentChecked = false;

  constructor(tagName: string, ownerDocument: TestDocument, namespaceURI = "http://www.w3.org/1999/xhtml") {
    super(1, ownerDocument);
    this.localName = tagName.toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this.namespaceURI = namespaceURI;
  }

  get value(): string {
    return this.currentValue;
  }

  set value(value: string) {
    this.currentValue = String(value);
  }

  get checked(): boolean {
    return this.currentChecked;
  }

  set checked(value: boolean) {
    this.currentChecked = Boolean(value);
  }

  get options(): TestElement[] {
    if (this.localName !== "select") return [];
    const options: TestElement[] = [];
    const visit = (node: TestNode) => {
      for (const child of node.childNodes) {
        if (child instanceof TestElement && child.localName === "option") options.push(child);
        visit(child);
      }
    };
    visit(this);
    return options;
  }

  setAttribute(name: string, value: string): void {
    const normalized = name.toLowerCase();
    this.attributes.set(normalized, String(value));
    if (normalized === "href") this.href = String(value);
    if (normalized === "download") this.download = String(value);
    if (normalized === "src") this.src = String(value);
    if (normalized === "alt") this.alt = String(value);
    if (normalized === "name") this.name = String(value);
    if (normalized === "type") this.type = String(value);
  }

  setAttributeNS(_namespace: string | null, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  removeAttributeNS(_namespace: string | null, name: string): void {
    this.removeAttribute(name);
  }

  click(): void {
    if (this.disabled) return;
    this.clickCount += 1;
    if (this.localName === "input" && this.type === "checkbox") {
      const descriptor = Object.getOwnPropertyDescriptor(TestElement.prototype, "checked");
      descriptor?.set?.call(this, !this.checked);
    }
    const event = new TestEvent("click");
    this.dispatchEvent(event);
    if (
      !event.defaultPrevented
      && this.localName === "summary"
      && this.parentNode instanceof TestElement
      && this.parentNode.localName === "details"
    ) {
      if (this.parentNode.hasAttribute("open")) this.parentNode.removeAttribute("open");
      else this.parentNode.setAttribute("open", "");
    }
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
}

export class TestDocument extends TestNode {
  readonly nodeName = "#document";
  readonly documentElement: TestElement;
  readonly body: TestElement;
  readonly defaultView: typeof globalThis;
  activeElement: TestElement;
  readonly createdElements: TestElement[] = [];
  oninput: null = null;

  constructor() {
    super(9);
    this.ownerDocument = this;
    this.defaultView = globalThis;
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tagName: string): TestElement {
    const element = new TestElement(tagName, this);
    this.createdElements.push(element);
    return element;
  }

  createElementNS(namespaceURI: string, tagName: string): TestElement {
    const element = new TestElement(tagName, this, namespaceURI);
    this.createdElements.push(element);
    return element;
  }

  createTextNode(data: string): TestText {
    return new TestText(data, this);
  }

  createComment(data: string): TestComment {
    return new TestComment(data, this);
  }

  getSelection(): null {
    return null;
  }
}

export class TestStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

export interface TestDom {
  document: TestDocument;
  localStorage: TestStorage;
  sessionStorage: TestStorage;
  restore(): void;
}

export function installTestDom(): TestDom {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const document = new TestDocument();
  const localStorage = new TestStorage();
  const sessionStorage = new TestStorage();
  const globals: Record<string, unknown> = {
    window: globalThis,
    self: globalThis,
    document,
    localStorage,
    sessionStorage,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLInputElement: TestElement,
    HTMLTextAreaElement: TestElement,
    HTMLIFrameElement: TestElement,
    SVGElement: TestElement,
    Document: TestDocument,
    Event: TestEvent,
    MouseEvent: TestEvent,
    InputEvent: TestEvent,
    getComputedStyle: () => ({ display: "block" }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  previous.set("navigator", Object.getOwnPropertyDescriptor(globalThis, "navigator"));
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "portable-test-dom", sendBeacon: () => true },
  });
  return {
    document,
    localStorage,
    sessionStorage,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

export function findAll(
  root: TestNode,
  predicate: (element: TestElement) => boolean,
): TestElement[] {
  const result: TestElement[] = [];
  const visit = (node: TestNode) => {
    if (node instanceof TestElement && predicate(node)) result.push(node);
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return result;
}

export function findByText(root: TestNode, tagName: string, text: string): TestElement {
  const match = findAll(root, (element) => element.localName === tagName && element.textContent.trim() === text)[0];
  if (!match) throw new Error(`test_dom_element_not_found:${tagName}:${text}`);
  return match;
}

export function setNativeValue(element: TestElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(TestElement.prototype, "value");
  descriptor?.set?.call(element, value);
}
