module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: ["node_modules/", "client/"],
  rules: {
    "no-console": "off",
  },
  overrides: [
    {
      files: ["server/http/routes/**/*.js", "server/ws/handlers/**/*.js", "server/game/**/*.js", "server/common/**/*.js", "server/bot/**/*.js"],
      rules: {
        "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }],
        "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
      },
    },
  ],
};
