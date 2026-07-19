/** Minimal zero-dependency test runner. */

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertThrows(fn, pattern, message = 'expected an error') {
  try {
    fn();
  } catch (error) {
    if (pattern && !String(error.message).includes(pattern)) {
      throw new Error(`${message} — error "${error.message}" does not match "${pattern}"`);
    }
    return;
  }
  throw new Error(message);
}

export async function runAll() {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  for (const { name, error } of failures) {
    console.error(`✗ ${name}\n  ${error.message}`);
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
  if (failures.length > 0) process.exit(1);
}
