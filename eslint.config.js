const js = require('@eslint/js')
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/',
      'dist-electron/',
      'release/',
      'node_modules/',
      '.vite/',
      '.omo/',
      'scripts/',
    ],
  },

  // Base recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Main config
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
    },
  },

  // electron/ overrides — CJS environment
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // tests/ overrides — node:test
  //
  // 说明：测试用例里会直接用到 Web/Node 全局对象（Response、URL、document …），
  // 原先未在此声明，导致 lint 一旦被真正执行就会误报 `no-undef`。
  // 历史上 `npm run lint` 的 glob 被引号包裹而在 Windows 下永不匹配，
  // 因此这些误报长期被掩盖。
  {
    files: ['tests/**/*.{js,ts}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        /* 注意：不要在此声明 URL / URLSearchParams —— 多个测试文件会
           `const { URL } = require('node:url')`，声明为全局会触发 no-redeclare。
           需要 URL 的用例请显式从 node:url 导入。 */
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Blob: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
        queueMicrotask: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },

  // tests/e2e-ui — 在浏览器上下文（Playwright/CDP）中执行，需要 DOM 全局
  {
    files: ['tests/e2e-ui/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        HTMLElement: 'readonly',
        Node: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        MutationObserver: 'readonly',
        getComputedStyle: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
      },
    },
  },
)
