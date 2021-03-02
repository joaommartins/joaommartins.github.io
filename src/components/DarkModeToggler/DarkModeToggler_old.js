// @flow strict
import React from 'react';

class DarkModeToggler extends React.Component {
  constructor(props) {
    super(props);
    // this.checkTheme = this.checkTheme.bind(this);
    this.state = {
      theme: null,
    };
    this.checkTheme();
  }

  checkTheme() {
    const currentTheme = document.documentElement.getAttribute('theme', 'light');
    console.log(currentTheme);
    return currentTheme;
  }

  toggleTheme() {
    console.log('doing theme change');
    const oldTheme = document.documentElement.getAttribute('theme');
    const newTheme = oldTheme === 'dark' ? 'light' : 'dark';
    console.log(`From ${oldTheme} to ${newTheme}`);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('theme', newTheme);
    this.checkTheme();
    return newTheme;
  }

  render() {
    if (this.state.theme === null) {
      return null;
    }
    return (
      <div className={this.props.className}>
        <label>
          <input
            type="checkbox"
            onClick={() => this.toggleTheme()
            }
            hidden={true}
          />{' '}
          {`${this.state.theme} mode`}
        </label>
      </div>
    );
  }
}

export default DarkModeToggler;
