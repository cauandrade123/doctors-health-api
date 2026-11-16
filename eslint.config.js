import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
        rules: {
            eqeqeq: 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-console': ['error', { allow: ['error', 'log'] }],
        },
    },
    { files: ['src/**'], rules: { 'no-console': 'error' } },
];
