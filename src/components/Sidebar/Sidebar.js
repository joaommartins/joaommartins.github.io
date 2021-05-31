import React from 'react';
import Author from './Author';
import Contacts from './Contacts';
import Copyright from './Copyright';
import Menu from './Menu';
import styles from './Sidebar.module.scss';
import { useSiteMetadata } from '../../hooks';
// import DarkModeToggler from '../DarkModeToggler';

type Props = {
  isIndex?: boolean,
};

const DarkModeToggler = React.lazy(() => import('../DarkModeToggler'));

const Sidebar = ({ isIndex }: Props) => {
  const { author, copyright, menu } = useSiteMetadata();
  const isSSR = typeof window === 'undefined';

  return (
    <div className={styles['sidebar']}>
      <div className={styles['sidebar__inner']}>
        <Author author={author} isIndex={isIndex} />
        <Menu menu={menu} />
        {!isSSR && (
          <React.Suspense fallback={<div />}>
            <DarkModeToggler className={styles['sidebar__toggler']}/>
          </React.Suspense>
        )}
        <Contacts contacts={author.contacts} />
        <Copyright copyright={copyright} />
      </div>
    </div>
  );
};

export default Sidebar;
