import '@testing-library/jest-dom'

// jsdom lacks these browser APIs used by radix-ui primitives and the settings
// scroll-spy. Provide inert polyfills so component tests can render.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

const g = globalThis as unknown as Record<string, unknown>
if (!('IntersectionObserver' in globalThis)) {
  g.IntersectionObserver = MockObserver
}
if (!('ResizeObserver' in globalThis)) {
  g.ResizeObserver = MockObserver
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
