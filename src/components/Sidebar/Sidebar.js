// @flow strict
import React from 'react';
import Author from './Author';
import Contacts from './Contacts';
import Copyright from './Copyright';
import Menu from './Menu';
// import DarkModeToggler from '../DarkModeToggler';
import styles from './Sidebar.module.scss';
import { useSiteMetadata } from '../../hooks';
import DarkModeToggler from '../DarkModeToggler';

type Props = {
  isIndex?: boolean,
};

const Sidebar = ({ isIndex }: Props) => {
  const { author, copyright, menu } = useSiteMetadata();

  return (
    <div className={styles['sidebar']}>
      <div className={styles['sidebar__inner']}>
        <Author author={author} isIndex={isIndex} />
        <Menu menu={menu} />
      </div>
      <div>
        <DarkModeToggler className={styles['sidebar__toggler']}/>
        <Contacts contacts={author.contacts} />
        <Copyright copyright={copyright} />
      </div>
    </div>
  );
};

export default Sidebar;
