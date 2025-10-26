module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    // Laisse avancer le projet : pas de blocage sur les "any"
    '@typescript-eslint/no-explicit-any': 'off',

    // Préviens seulement, et tolère les placeholders préfixés par _
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],

    // Bon à avoir, mais en warning
    'react-hooks/exhaustive-deps': 'warn',
  },
};
