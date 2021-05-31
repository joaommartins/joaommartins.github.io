const React = require('react');
const siteConfig = require('../config.js');

// eslint-disable-next-line import/no-webpack-loader-syntax, import/no-unresolved
const katexStylesheet = require('!css-loader!../static/css/katex/katex.min.css');

const applyDarkModeFunc = `
(function() {
  const mode = localStorage.getItem('theme');
  if (mode !== null && ['light', 'dark'].includes(mode)) {
    document.documentElement.dataset.theme = mode;
    return;
  }

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const hasMediaQueryPreference = typeof mql.matches === 'boolean';
  if (hasMediaQueryPreference && mql.matches === true) {
    document.documentElement.dataset.theme = 'dark';
  } else {
    document.documentElement.dataset.theme = 'light'
  }
})();
`;

const onRenderBody = ({ setHeadComponents, setPreBodyComponents }) => {
  const { useKatex } = siteConfig;

  if (useKatex) {
    setHeadComponents([
      React.createElement('style', {
        key: 'katex-inline-stylesheet',
        dangerouslySetInnerHTML: { __html: katexStylesheet.toString() }
      }),
    ]);
  }
  setPreBodyComponents([
    React.createElement('script', {
      dangerouslySetInnerHTML: {
        __html: applyDarkModeFunc,
      },
    }),
  ]);
};

module.exports = onRenderBody;
