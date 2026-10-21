module.exports = [
  {
    ignores: ['node_modules/**', 'server.log', 'coverage/**'],
  },
  {
    files: ['**/*.js', '../frontend/app.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FileReader: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'error',
      eqeqeq: 'error',
    },
  },
];
