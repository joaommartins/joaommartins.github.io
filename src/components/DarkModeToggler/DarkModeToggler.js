import React, { useState, useEffect } from 'react';
import styles from './DarkModeToggler.module.scss';

function ThemeToggler() {
  const initTheme = document.documentElement.dataset.theme;
  const [theme, setTheme] = useState(initTheme);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.dataset.theme = theme;
  },
  [theme]);

  function toggleTheme() {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  }

  return (
    <div className={styles['toggler']}>
      <label>
        <input
          type="checkbox"
          onClick={() => toggleTheme()}
          hidden={true}
        />{`${theme} mode`}
      </label>
    </div>
  );
}

export default ThemeToggler;