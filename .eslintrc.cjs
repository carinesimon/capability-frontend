module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',      // autorise "any"
    '@typescript-eslint/no-unused-vars': ['warn', {   // simples warnings
      argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true,
    }],
    'react-hooks/exhaustive-deps': 'warn',
  },
  
};
