/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2021
  },
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
  }
};