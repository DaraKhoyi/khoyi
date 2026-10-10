import { isSlug } from './tap';
test('only slugs are tracked, never content', () => {
  expect(isSlug('today.top3.verify')).toBe(true);
  expect(isSlug('Call Jane 813-555-0142')).toBe(false);
  expect(isSlug('jane@example.com')).toBe(false);
  expect(isSlug('')).toBe(false);
});
