import React, { useState, useEffect } from 'react';

function ThemeToggler(props) {
  const initTheme = document.documentElement.getAttribute('theme');
  const [theme, setTheme] = useState(initTheme);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('theme', theme);
  },
  [theme]);

  function toggleTheme() {
    const oldTheme = document.documentElement.getAttribute('theme');
    const newTheme = oldTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  }

  return (
    <div className={props.className}>
      <label>
        <input
          type="checkbox"
          onClick={() => toggleTheme()
          }
          hidden={true}
        />{' '}
        {`${theme} mode`}
      </label>
    </div>
  );
}

export default ThemeToggler;