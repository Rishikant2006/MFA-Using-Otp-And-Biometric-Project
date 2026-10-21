const nodeGlobals = {
  Buffer: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const browserGlobals = {
  console: 'readonly',
  fetch: 'readonly',
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  FormData: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  alert: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  requestAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-console': 'off',
  'prefer-const': 'error',
  eqeqeq: 'error',
};

module.exports = [
  {
    ignores: ['backend/node_modules/**', 'backend/server.log', 'backend/coverage/**'],
  },
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules,
  },
  {
    files: ['frontend/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      ...rules,
      // Top-level functions in the browser bundle are invoked from inline
      // `onclick` handlers in index.html, so they look unused to ESLint.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', vars: 'local' }],
    },
  },
];
