export default {
  'src/**/*.{ts,tsx}': [
    'eslint --fix',
    'prettier --write',
  ],
  'electron/**/*.ts': [
    'eslint --fix',
    'prettier --write',
  ],
  'tests/**/*.{js,ts}': [
    'eslint --fix',
    'prettier --write',
  ],
}
